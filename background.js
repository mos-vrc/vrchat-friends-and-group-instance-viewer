import { CONFIG } from './config.js';
import { isAllowedApiUrl, SharedRequestGate } from './request-policy.js';

const requestGate = new SharedRequestGate();
const pendingGets = new Map();
let apiRuleInstalled = false;
const API_USER_AGENT_RULE_ID = 1001;
let apiRulePromise = null;

function buildApiUserAgent() {
  const version = chrome.runtime.getManifest()?.version || 'unknown';
  return `VRChatFriendsGroupInstanceViewer/${version} (contact @mos_vrc)`;
}

async function ensureApiUserAgentRule() {
  if (!chrome.declarativeNetRequest?.updateSessionRules) return false;
  if (apiRuleInstalled) return true;
  if (apiRulePromise) return apiRulePromise;

  apiRulePromise = (async () => {
    try {
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [API_USER_AGENT_RULE_ID],
        addRules: [{
          id: API_USER_AGENT_RULE_ID,
          priority: 100,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [{
              header: 'user-agent',
              operation: 'append',
              value: buildApiUserAgent(),
            }],
          },
          condition: {
            regexFilter: '^https://(vrchat\\.com|api\\.vrchat\\.cloud)/api/1/',
            requestDomains: ['vrchat.com', 'api.vrchat.cloud'],
            initiatorDomains: [chrome.runtime.id],
            resourceTypes: ['xmlhttprequest'],
          },
        }],
      });
      apiRuleInstalled = true;
      return true;
    } catch (error) {
      console.warn('Could not install VRChat API User-Agent rule:', error);
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

async function handleApiFetch(message) {
  if (!isAllowedApiUrl(message?.url)) return { ok: false, status: 400, text: '' };
  const method = String(message.method || 'GET').toUpperCase();
  // Only methods used by this extension; no arbitrary header forwarding.
  if (!['GET', 'POST', 'DELETE'].includes(method)) return { ok: false, status: 400, text: '' };
  const key = method === 'GET' ? message.url : '';
  if (key && pendingGets.has(key)) return pendingGets.get(key);
  const task = performApiFetch(message, method);
  if (key) pendingGets.set(key, task);
  try { return await task; }
  finally { if (key && pendingGets.get(key) === task) pendingGets.delete(key); }
}

async function performApiFetch(message, method) {
  const slot = await requestGate.claim();
  // Wait in the page, not inside a sleeping MV3 worker. Recheck on every retry.
  if (!slot.granted) return { ok: false, status: 0, deferred: true, retryAt: slot.retryAt, text: '' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.API_TIMEOUT_MS);
  try {
    await ensureApiUserAgentRule();
    const headers = { Accept: 'application/json' };
    if (typeof message.body === 'string') headers['Content-Type'] = 'application/json';
    const response = await fetch(message.url, {
      method, headers,
      body: method === 'GET' ? undefined : (typeof message.body === 'string' ? message.body : undefined),
      credentials: 'include', cache: 'no-store', redirect: 'error', signal: controller.signal,
    });
    const retryAfter = response.headers.get('Retry-After') || '';
    let retryAt = 0;
    if (response.status === 429 || response.status >= 500) {
      retryAt = await requestGate.pause(retryAfter, response.status === 429 ? 2000 : 1000);
    }
    return { ok: response.ok, status: response.status, retryAfter, retryAt, text: await response.text() };
  } catch (error) {
    return { ok: false, status: 0, text: '', code: controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR',
      outcomeUnknown: method !== 'GET' };
  } finally {
    clearTimeout(timer);
    requestGate.release();
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender?.id !== chrome.runtime.id) return undefined;

  if (message?.type === 'VRCHAT_API_FETCH') {
    handleApiFetch(message).then(sendResponse).catch(() => sendResponse({ ok: false, status: 0, text: '', code: 'NETWORK_ERROR' }));
    return true;
  }

  if (message?.type === 'ENSURE_API_USER_AGENT_RULE') {
    ensureApiUserAgentRule().then((installed) => sendResponse({ installed }));
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
