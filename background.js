import { buildApiHeaderRules } from './api-header-rules.js';
import { CONFIG } from './config.js';
import { isAllowedApiUrl, SharedRequestGate, withTimeout } from './request-policy.js';

const requestGate = new SharedRequestGate();
const pendingGets = new Map();
let apiRuleInstalled = false;
const API_USER_AGENT_RULE_ID = 1001;
let apiRulePromise = null;
let apiRuleError = "";

function buildApiUserAgent() {
  const version = chrome.runtime.getManifest()?.version || 'unknown';
  return `VRChatFriendsGroupInstanceViewer/${version} (contact @mos_vrc)`;
}

async function ensureApiUserAgentRule() {
  if (!chrome.declarativeNetRequest?.updateSessionRules) { apiRuleError="Chrome declarativeNetRequest API is unavailable"; return false; }
  if (apiRuleInstalled) return true;
  if (apiRulePromise) return apiRulePromise;

  apiRulePromise = (async () => {
    try {
      await withTimeout(chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [API_USER_AGENT_RULE_ID, 1002, 1003, 1004, 1005],
        addRules: buildApiHeaderRules(chrome.runtime.id, buildApiUserAgent()),
      }), CONFIG.API_SETUP_TIMEOUT_MS || 5000);
      apiRuleError = "";
      apiRuleInstalled = true;
      return true;
    } catch (error) {
      apiRuleError=String(error?.message || error).slice(0,500);
      console.warn('Could not install VRChat API header rules:', apiRuleError);
      return false;
    } finally {
      apiRulePromise = null;
    }
  })();

  return apiRulePromise;
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureApiUserAgentRule();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureApiUserAgentRule();
});

async function handleApiFetch(message, tabId) {
  if (!isAllowedApiUrl(message?.url)) return { ok: false, status: 400, text: '' };
  const method = String(message.method || 'GET').toUpperCase();
  // Only methods used by this extension; no arbitrary header forwarding.
  if (!['GET', 'POST', 'DELETE', 'PUT'].includes(method)) return { ok: false, status: 400, text: '' };
  const requestUrl=new URL(message.url);
  // Keep exact write routes enforced even though declarative filters are broad.
  if (method !== 'GET' && requestUrl.search) return { ok:false,status:400,text:'' };
  if (method === 'POST' && requestUrl.pathname !== '/api/1/favorites'
    && !/^\/api\/1\/invite\/myself\/to\/[^?#]+$/.test(requestUrl.pathname)) return { ok:false,status:400,text:'' };
  if (method === 'DELETE' && !/^\/api\/1\/favorites\/fvrt_[A-Za-z0-9_-]+$/.test(requestUrl.pathname)) return { ok:false,status:400,text:'' };
  if (method === 'PUT') {
    const url = new URL(message.url);
    let body;
    try { body = JSON.parse(message.body); } catch { return { ok: false, status: 400, text: '' }; }
    if (url.search || !/^\/api\/1\/favorite\/group\/(?:friend\/group_[012]|world\/worlds(?:0|[1-9]\d*)|vrcPlusWorld\/vrcPlusWorlds[1-9]\d*)\/usr_[A-Za-z0-9_-]+$/.test(url.pathname)
      || !body || Object.keys(body).length !== 1 || typeof body.displayName !== 'string'
      || !body.displayName.trim() || body.displayName.trim().length > CONFIG.FAVORITE_GROUP_NAME_MAX_LENGTH || /[\r\n\u0000]/.test(body.displayName)) return { ok: false, status: 400, text: '' };
  }
  const key = method === 'GET' ? message.url : '';
  if (key && pendingGets.has(key)) {
    const entry = pendingGets.get(key);
    if (Number.isInteger(tabId)) entry.owners.add(tabId);
    else entry.unowned = true;
    return entry.task;
  }
  const entry = { controller: new AbortController(), owners: new Set(Number.isInteger(tabId) ? [tabId] : []), unowned: !Number.isInteger(tabId) };
  entry.task = performApiFetch(message, method, entry.controller);
  if (key) pendingGets.set(key, entry);
  try { return await entry.task; }
  finally { if (key && pendingGets.get(key) === entry) pendingGets.delete(key); }
}

// Closing the last reader cancels only GETs. Writes may already have reached
// VRChat and must never be canceled/replayed as a tab-lifecycle side effect.
chrome.tabs?.onRemoved?.addListener(tabId => {
  for (const [key, entry] of pendingGets) {
    entry.owners.delete(tabId);
    if (!entry.unowned && !entry.owners.size) {
      pendingGets.delete(key);
      entry.controller.abort();
    }
  }
});

async function performApiFetch(message, method, controller) {
  let claimed = false, timedOut = false, onAbort;
  const stopped = new Promise((_, reject) => {
    onAbort = () => reject(new Error('Request stopped'));
    controller.signal.addEventListener('abort', onAbort, { once: true });
  });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, CONFIG.API_TIMEOUT_MS);
  const work = async () => {
  const headersInstalled = await ensureApiUserAgentRule();
  if (controller.signal.aborted) throw new Error('Request stopped');
  if (method !== 'GET' && !headersInstalled) {
    return { ok: false, status: 0, text: '', code: 'API_HEADERS_UNAVAILABLE', diagnostic: apiRuleError || 'Header rules unavailable', outcomeUnknown: false };
  }
  const slot = await requestGate.claim();
  if (controller.signal.aborted) {
    if (slot.granted) requestGate.release();
    throw new Error('Request stopped');
  }
  // Wait in the page, not inside a sleeping MV3 worker. Recheck on every retry.
  if (!slot.granted) return { ok: false, status: 0, deferred: true, retryAt: slot.retryAt, text: '' };
  claimed = true;
    const headers = { Accept: 'application/json' };
    if (typeof message.body === 'string') headers['Content-Type'] = 'application/json';
    const response = await fetch(message.url, {
      method, headers,
      body: method === 'GET' ? undefined : (typeof message.body === 'string' ? message.body : undefined),
      credentials: 'include', cache: 'no-store', redirect: 'error', signal: controller.signal,
    });
    const retryAfter = response.headers.get('Retry-After') || '';
    if (controller.signal.aborted) throw new Error('Request stopped');
    let retryAt = 0;
    if (response.status === 429 || response.status >= 500) {
      retryAt = response.status === 429 ? await requestGate.rateLimited(retryAfter) : await requestGate.pause(retryAfter, 1000);
    }
    const text = await response.text();
    if (controller.signal.aborted) throw new Error('Request stopped');
    return { ok: response.ok, status: response.status, retryAfter, retryAt, text };
  };
  try {
    return await Promise.race([work(), stopped]);
  } catch (error) {
    return { ok: false, status: 0, text: '', code: timedOut ? 'TIMEOUT' : controller.signal.aborted ? 'READ_CANCELLED' : 'NETWORK_ERROR',
      outcomeUnknown: method !== 'GET' };
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener('abort', onAbort);
    if (claimed) requestGate.release();
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender?.id !== chrome.runtime.id) return undefined;

  if (message?.type === 'VRCHAT_API_FETCH') {
    handleApiFetch(message, sender?.tab?.id ?? message.viewerTabId).then(sendResponse).catch(() => sendResponse({ ok: false, status: 0, text: '', code: 'NETWORK_ERROR' }));
    return true;
  }

  if (message?.type === 'ENSURE_API_USER_AGENT_RULE') {
    ensureApiUserAgentRule().then((installed) => sendResponse({ installed, diagnostic: apiRuleError }));
    return true;
  }

  return undefined;
});

chrome.action.onClicked.addListener(() => {
  const url = chrome.runtime.getURL('index.html#/');
  chrome.tabs.query({ url }, (tabs) => {
    const existing = tabs?.find((tab) => Number.isInteger(tab.id));
    if (existing) {
      chrome.tabs.update(existing.id, { active: true });
      if (Number.isInteger(existing.windowId)) {
        chrome.windows.update(existing.windowId, { focused: true });
      }
      return;
    }
    chrome.tabs.create({ url });
  });
});
