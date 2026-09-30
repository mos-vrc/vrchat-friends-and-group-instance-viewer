const API_USER_AGENT_RULE_ID = 1001;
let apiRulePromise = null;

function buildApiUserAgent() {
  const version = chrome.runtime.getManifest()?.version || 'unknown';
  return `VRChatFriendsGroupInstanceViewer/${version} (contact @mos_vrc)`;
}

async function ensureApiUserAgentRule() {
  if (!chrome.declarativeNetRequest?.updateSessionRules) return false;
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
            urlFilter: '||vrchat.com/api/1/',
            requestDomains: ['vrchat.com'],
            initiatorDomains: [chrome.runtime.id],
            resourceTypes: ['xmlhttprequest'],
          },
        }],
      });
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

function isAllowedApiUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === 'vrchat.com'
      && url.pathname.startsWith('/api/1/');
  } catch {
    return false;
  }
}

async function handleApiFetch(message) {
  if (!isAllowedApiUrl(message?.url)) {
    return { ok: false, status: 400, text: '' };
  }

  const method = typeof message.method === 'string' ? message.method.toUpperCase() : 'GET';
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return { ok: false, status: 400, text: '' };
  }

  await ensureApiUserAgentRule();

  const headers = { Accept: 'application/json' };
  if (message?.headers && typeof message.headers === 'object') {
    for (const [key, value] of Object.entries(message.headers)) {
      const lower = key.toLowerCase();
      if (typeof value === 'string' && lower !== 'user-agent' && lower !== 'cookie') {
        headers[key] = value;
      }
    }
  }

  try {
    const response = await fetch(message.url, {
      method,
      headers,
      body: typeof message.body === 'string' ? message.body : undefined,
      credentials: 'include',
      cache: 'no-store',
    });

    return {
      ok: response.ok,
      status: response.status,
      retryAfter: response.headers.get('Retry-After') || '',
      text: await response.text(),
      finalUrl: response.url || '',
      redirected: Boolean(response.redirected),
      responseType: response.type || '',
    };
  } catch (error) {
    console.warn('VRChat API request failed:', error);
    return {
      ok: false,
      status: 0,
      retryAfter: '',
      text: '',
      networkError: error?.message || 'VRChat API request failed.',
    };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender?.id !== chrome.runtime.id) return undefined;

  if (message?.type === 'VRCHAT_API_FETCH') {
    handleApiFetch(message).then(sendResponse);
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
