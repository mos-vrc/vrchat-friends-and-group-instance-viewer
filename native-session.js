import { CONFIG } from './config.js';
import { buildApiHeaderRules } from './api-header-rules.js';
import { abortError, createCooldownStore, isAllowedApiUrl, retryAfterDeadline, withTimeout } from './request-policy.js';

const cooldownStore = createCooldownStore();
let headerPromise, localNextStart = 0, localCooldown = 0, nextReadSlot = 0;
const nextKey = 'vrc_viewer_api_next_start';
const canonical = value => JSON.stringify(value, function(key, item) {
  return item && !Array.isArray(item) && typeof item === 'object'
    ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item;
});

async function prepareHeaders() {
  if (headerPromise) return headerPromise;
  headerPromise = (async () => {
    const api = chrome.declarativeNetRequest;
    const wanted = buildApiHeaderRules(chrome.runtime.id,
      `VRChatFriendsGroupInstanceViewer/${chrome.runtime.getManifest()?.version || 'unknown'} (contact @mos_vrc)`);
    try {
      if (api.getSessionRules) {
        const existing = await withTimeout(api.getSessionRules(), CONFIG.API_SETUP_TIMEOUT_MS);
        if (wanted.every(rule => existing.some(r => canonical(r) === canonical(rule)))) return { installed: true };
      }
      await withTimeout(api.updateSessionRules({ removeRuleIds: wanted.map(r => r.id), addRules: wanted }), CONFIG.API_SETUP_TIMEOUT_MS);
      return { installed: true };
    } catch (error) {
      headerPromise = null;
      return { installed: false, diagnostic: String(error?.message || error).slice(0, 500) };
    }
  })();
  return headerPromise;
}

function allowedWrite(url, method, text) {
  const u = new URL(url);
  if (method === 'GET') return true;
  if (u.search) return false;
  if (method === 'POST') return u.pathname === '/api/1/favorites' || /^\/api\/1\/invite\/myself\/to\/[^?#]+$/.test(u.pathname);
  if (method === 'DELETE') return /^\/api\/1\/favorites\/fvrt_[A-Za-z0-9_-]+$/.test(u.pathname);
  if (method !== 'PUT') return false;
  let body; try { body = JSON.parse(text); } catch { return false; }
  return /^\/api\/1\/favorite\/group\/(?:friend\/group_[012]|world\/worlds(?:0|[1-9]\d*)|vrcPlusWorld\/vrcPlusWorlds[1-9]\d*)\/usr_[A-Za-z0-9_-]+$/.test(u.pathname)
    && body && Object.keys(body).length === 1 && typeof body.displayName === 'string'
    && body.displayName.trim().length > 0 && body.displayName.trim().length <= CONFIG.FAVORITE_GROUP_NAME_MAX_LENGTH
    && !/[\r\n\u0000]/.test(body.displayName);
}

// The document owns fetch and its lock. Chrome releases document-owned locks
// on close, so a dead viewer can never retain a worker request or API slot.
export async function fetchInViewer(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  if (!isAllowedApiUrl(url) || !allowedWrite(url, method, options.body)) return { ok: false, status: 400, text: '' };
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const check = () => { if (controller.signal.aborted) throw abortError(); };
  const execute = async () => {
    check();
    // Serialize only admission, not the whole response download. Every tab
    // shares the same start interval and persisted cooldown.
    const admission = await navigator.locks.request('vrc-viewer-api-start', { signal: controller.signal }, async () => {
      check();
      const settings = await prepareHeaders();
      check();
      if (method !== 'GET' && !settings.installed) return { ok: false, status: 0, code: 'API_HEADERS_UNAVAILABLE', diagnostic: settings.diagnostic, outcomeUnknown: false, text: '' };
      const saved = await withTimeout(cooldownStore.load(), CONFIG.API_POLICY_TIMEOUT_MS).catch(() => 0);
      check();
      let next = localNextStart;
      try { const value = Number(localStorage.getItem(nextKey)); if (Number.isFinite(value)) next = Math.max(next, value); } catch {}
      const retryAt = Math.max(next, localCooldown, Number.isFinite(saved) ? saved : 0);
      if (retryAt > Date.now()) return { ok: false, status: 0, deferred: true, retryAt, text: '' };
      localNextStart = Date.now() + CONFIG.API_MIN_INTERVAL_MS;
      try { localStorage.setItem(nextKey, String(localNextStart)); } catch {}
      return null;
    });
    if (admission) return admission;
    check();
    const work = async () => {
      const response = await fetch(url, {
        method, headers: { Accept: 'application/json', ...(typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}) },
        body: method === 'GET' ? undefined : options.body,
        credentials: 'include', cache: 'no-store', redirect: 'error', signal: controller.signal,
      });
      check();
      const retryAfter = response.headers.get('Retry-After') || '';
      let retryAt = 0;
      if (response.status === 429 || response.status >= 500) {
        localCooldown = retryAt = Math.max(localCooldown, retryAfterDeadline(retryAfter, Date.now(), response.status === 429 ? 2000 : 1000));
        await navigator.locks.request('vrc-viewer-api-start', { signal: controller.signal }, async () => {
          const saved = await withTimeout(cooldownStore.load(), CONFIG.API_POLICY_TIMEOUT_MS).catch(() => 0);
          retryAt = localCooldown = Math.max(localCooldown, Number.isFinite(saved) ? saved : 0);
          await withTimeout(cooldownStore.save(retryAt), CONFIG.API_POLICY_TIMEOUT_MS).catch(() => {});
        });
      }
      const text = await response.text();
      check();
      return { ok: response.ok, status: response.status, retryAfter, retryAt, text };
    };
    return withTimeout(work(), CONFIG.API_TIMEOUT_MS, () => controller.abort());
  };
  try {
    check();
    if (!globalThis.navigator?.locks?.request) return { ok: false, status: 0, code: 'NETWORK_ERROR', text: '' };
    const run = () => {
      if (method !== 'GET') return execute();
      const count = Math.max(1, Math.min(2, CONFIG.API_READ_CONCURRENCY || 1));
      const first = nextReadSlot++ % count;
      const unavailable = Symbol('busy');
      return (async () => {
        for (let i = 0; i < count; i++) {
          const slot = (first + i) % count;
          // Non-blocking Web Lock probes cannot use signal; execute checks
          // the controller before admission, and queued locks remain abortable.
          const result = await navigator.locks.request(`vrc-viewer-api-read-${slot}`,
            { ifAvailable: true }, lock => lock ? execute() : unavailable);
          if (result !== unavailable) return result;
        }
        return navigator.locks.request(`vrc-viewer-api-read-${first}`, { signal: controller.signal }, execute);
      })();
    };
    // Reads share the outer lock, with two bounded read slots. Writes take it
    // exclusively, so a Favorite/rename/InviteMe mutation never overlaps reads
    // or another mutation. Browser-owned locks still release on tab close.
    return await withTimeout(navigator.locks.request('vrc-viewer-api-request',
      { signal: controller.signal, mode: method === 'GET' ? 'shared' : 'exclusive' }, run),
      CONFIG.API_MESSAGE_TIMEOUT_MS, () => controller.abort());
  } catch (error) {
    if (options.signal?.aborted) throw abortError();
    return { ok: false, status: 0, text: '', code: error?.name === 'TimeoutError' || controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR', outcomeUnknown: method !== 'GET' };
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
  }
}
