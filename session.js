import { isAllowedApiUrl, abortError, withTimeout } from './request-policy.js';
import { CONFIG } from './config.js';
import { fetchInViewer } from './native-session.js';
/**
 * Access VRChat through the browser's existing vrchat.com login session without
 * reading the auth cookie value in extension JavaScript.
 *
 * The viewer document requests https://vrchat.com/api/1/ directly
 * with credentials: 'include'. Chrome's normal cookie jar attaches applicable
 * VRChat cookies; this extension never reads, stores, or constructs them.
 *
 * declarativeNetRequest appends the extension identifier to the browser
 * User-Agent and sets Origin for narrowly scoped VRChat write endpoints.
 * It never reads or modifies Cookie headers.
 * Legacy runtime shims without the native DNR API use the bounded worker path.
 */
export class SessionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SessionError';
    this.code = code;
  }
}

function assertVrchatApiUrl(url) {
  if (!isAllowedApiUrl(url)) {
    throw new SessionError('INVALID_URL', 'Only VRChat API URLs are allowed.');
  }
}

let tabIdPromise;
function currentTabId() {
  if (!globalThis.chrome?.tabs?.getCurrent) return Promise.resolve(undefined);
  return tabIdPromise ||= withTimeout(new Promise(resolve => {
    try { chrome.tabs.getCurrent(tab => {
      const error = chrome.runtime.lastError;
      resolve(!error && Number.isInteger(tab?.id) ? tab.id : undefined);
    }); } catch { resolve(undefined); }
  }), 1000).catch(() => undefined);
}

function sendMessage(message, signal) {
  return new Promise((resolve, reject) => {
    if (!globalThis.chrome?.runtime?.sendMessage) {
      reject(new SessionError('RUNTIME_UNAVAILABLE', 'Chrome extension runtime is unavailable.'));
      return;
    }

    let settled = false;
    const finish = (error, response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error); else resolve(response);
    };
    const onAbort = () => finish(abortError());
    const timer = setTimeout(() => finish(new SessionError('RUNTIME_TIMEOUT', 'Extension service worker did not respond.')),
      CONFIG.API_MESSAGE_TIMEOUT_MS || 35000);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }
    try { chrome.runtime.sendMessage(message, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        finish(new SessionError('RUNTIME_ERROR', runtimeError.message || 'Extension service worker is unavailable.'));
        return;
      }
      finish(null, response);
    }); } catch (error) { finish(new SessionError('RUNTIME_ERROR', error?.message || 'Extension service worker is unavailable.')); }
  });
}

export async function fetchUsingVrchatSession(url, options = {}) {
  assertVrchatApiUrl(url);
  if (globalThis.chrome?.declarativeNetRequest?.updateSessionRules) return fetchInViewer(url, options);

  const method = options.method || 'GET';
  const headers = {
    Accept: 'application/json',
    ...(options.headers || {}),
  };
  const body = typeof options.body === 'string' ? options.body : undefined;

  try {
    const response = await sendMessage({
      type: 'VRCHAT_API_FETCH',
      url,
      method,
      headers,
      body,
      viewerTabId: await currentTabId(),
    }, options.signal);

    if (!response || response.ok !== true && !Number.isInteger(response.status)) {
      throw new SessionError('RUNTIME_ERROR', 'VRChat API request did not return a valid response.');
    }

    return {
      status: Number(response.status) || 0,
      ok: Boolean(response.ok),
      headers: {
        'retry-after': typeof response.retryAfter === 'string' ? response.retryAfter : '',
      },
      text: typeof response.text === 'string' ? response.text : '',
      deferred: response.deferred === true,
      retryAt: Number(response.retryAt) || 0,
      code: response.code || '',
      diagnostic: typeof response.diagnostic === 'string' ? response.diagnostic : '',
      outcomeUnknown: response.outcomeUnknown === true,
    };
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    if (error instanceof SessionError) throw error;
    throw new SessionError(
      'NETWORK_ERROR',
      error?.message || 'VRChat API request failed.',
    );
  }
}
