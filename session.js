/**
 * Access VRChat through the browser's existing vrchat.com login session without
 * reading the auth cookie value in extension JavaScript.
 *
 * The extension service worker requests https://vrchat.com/api/1/ directly
 * with credentials: 'include'. Chrome's normal cookie jar attaches applicable
 * VRChat cookies; this extension never reads, stores, or constructs them.
 *
 * declarativeNetRequest is used only to append the extension identifier to the
 * browser User-Agent while preserving the normal Chrome User-Agent.
 */
export class SessionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SessionError';
    this.code = code;
  }
}

function assertVrchatApiUrl(url) {
  if (!/^https:\/\/vrchat\.com\/api\/1\//i.test(url)) {
    throw new SessionError('INVALID_URL', 'Only VRChat API URLs are allowed.');
  }
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    if (!globalThis.chrome?.runtime?.sendMessage) {
      reject(new SessionError('RUNTIME_UNAVAILABLE', 'Chrome extension runtime is unavailable.'));
      return;
    }

    chrome.runtime.sendMessage(message, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new SessionError('RUNTIME_ERROR', runtimeError.message || 'Extension service worker is unavailable.'));
        return;
      }
      resolve(response);
    });
  });
}

export async function fetchUsingVrchatSession(url, options = {}) {
  assertVrchatApiUrl(url);

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
    });

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
    };
  } catch (error) {
    if (error instanceof SessionError) throw error;
    throw new SessionError(
      'NETWORK_ERROR',
      error?.message || 'VRChat API request failed.',
    );
  }
}
