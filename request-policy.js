import { CONFIG } from './config.js';
import { allowedNotificationWrite } from './notifications.js';

export function withTimeout(promise, milliseconds, onTimeout) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('Request timed out');
      error.name = 'TimeoutError';
      reject(error);
      onTimeout?.();
    }, milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function isAllowedApiUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://vrchat.com' && !url.username && !url.password
      && url.pathname.startsWith('/api/1/');
  } catch { return false; }
}

// The single write allowlist for both transports (native-session.js in the
// viewer document, background.js in the worker). A write is admitted only
// for the exact routes, methods and body shapes below; notification writes
// carry their own validation in notifications.js. GETs are reads and are
// admitted by isAllowedApiUrl at the call sites instead.
export function allowedWriteRequest(pathname, method, bodyText, hasSearch = false) {
  if (method === 'GET') return true;
  if (hasSearch) return false;
  if (allowedNotificationWrite(pathname, method, bodyText)) return true;
  if (method === 'POST') {
    if (pathname === '/api/1/favorites' || /^\/api\/1\/invite\/myself\/to\/[^?#]+$/.test(pathname)) return true;
    if (/^\/api\/1\/calendar\/grp_[A-Za-z0-9_-]+\/cal_[A-Za-z0-9_-]+\/follow$/.test(pathname)) {
      let body; try { body = JSON.parse(bodyText); } catch { return false; }
      return Boolean(body) && Object.keys(body).length === 1 && typeof body.isFollowing === 'boolean';
    }
    return false;
  }
  if (method === 'DELETE') return /^\/api\/1\/favorites\/fvrt_[A-Za-z0-9_-]+$/.test(pathname);
  if (method !== 'PUT') return false;
  let body; try { body = JSON.parse(bodyText); } catch { return false; }
  return /^\/api\/1\/favorite\/group\/(?:friend\/group_[012]|world\/worlds(?:0|[1-9]\d*)|vrcPlusWorld\/vrcPlusWorlds[1-9]\d*|avatar\/avatars[1-9]\d*)\/usr_[A-Za-z0-9_-]+$/.test(pathname)
    && Boolean(body) && Object.keys(body).length === 1 && typeof body.displayName === 'string'
    && body.displayName.trim().length > 0 && body.displayName.trim().length <= CONFIG.FAVORITE_GROUP_NAME_MAX_LENGTH
    && !/[\r\n\u0000]/.test(body.displayName);
}

export function retryAfterDeadline(value, now = Date.now(), fallbackMs = 1000) {
  const text = String(value ?? '').trim();
  const seconds = /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : NaN;
  const deadline = Number.isFinite(seconds) ? now + seconds * 1000 : Date.parse(text);
  return Number.isFinite(deadline) && deadline > now ? deadline : now + fallbackMs;
}

// Persist only the shared cooldown timestamp. No account data or credentials.
export function createCooldownStore(indexedDB = globalThis.indexedDB) {
  let database;
  const open = () => database ||= new Promise((resolve) => {
    if (!indexedDB) return resolve(null);
    try {
      const request = indexedDB.open('vrc-viewer-network-policy', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('policy');
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return {
    async load() {
      const db = await open();
      if (!db) return 0;
      return new Promise((resolve) => {
        try {
          const request = db.transaction('policy').objectStore('policy').get('cooldown');
          request.onsuccess = () => resolve(Number(request.result) || 0);
          request.onerror = () => resolve(0);
        } catch { resolve(0); }
      });
    },
    async save(deadline) {
      const db = await open();
      if (!db) return;
      return new Promise((resolve) => {
        try {
          const tx = db.transaction('policy', 'readwrite');
          tx.objectStore('policy').put(deadline, 'cooldown');
          tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
        } catch { resolve(); }
      });
    },
  };
}

export class SharedRequestGate {
  constructor({ store = createCooldownStore(), now = () => Date.now() } = {}) {
    this.now = now;
    this.store = store;
    this.blockedUntil = 0;
    this.nextStartAt = 0;
    this.active = 0;
    this.tail = Promise.resolve();
    this.ready = withTimeout(Promise.resolve().then(() => store.load()), CONFIG.API_POLICY_TIMEOUT_MS || 3000)
      .catch(() => 0).then(value => { this.blockedUntil = Math.max(0, Number(value) || 0); });
  }

  claim() {
    const ticket = this.tail.then(async () => {
      await this.ready;
      const now = this.now();
      const retryAt = Math.max(this.blockedUntil, this.nextStartAt,
        this.active >= CONFIG.API_MAX_CONCURRENCY ? now + CONFIG.API_MIN_INTERVAL_MS : 0);
      if (retryAt > now) return { granted: false, retryAt };
      this.active += 1;
      this.nextStartAt = now + CONFIG.API_MIN_INTERVAL_MS;
      return { granted: true };
    });
    this.tail = ticket.catch(() => {});
    return ticket;
  }

  release() { this.active = Math.max(0, this.active - 1); }

  async rateLimited(value) {
    // Match the earlier short cooldown. Honor the server's Retry-After;
    // use two seconds only when no valid deadline was supplied.
    return this.pause(value, 2000);
  }

  async pause(value, fallbackMs, minimumMs = 0) {
    await this.ready;
    this.blockedUntil = Math.max(this.blockedUntil, retryAfterDeadline(value, this.now(), fallbackMs), this.now() + minimumMs);
    // Serialize writes so an earlier response cannot overwrite a longer wait.
    const write = this.tail.then(() => withTimeout(Promise.resolve().then(() => this.store.save(this.blockedUntil)),
      CONFIG.API_POLICY_TIMEOUT_MS || 3000).catch(() => {}));
    this.tail = write.catch(() => {});
    await write;
    return this.blockedUntil;
  }
}

export function abortError() { return new DOMException('Request superseded', 'AbortError'); }

// A signal that aborts when any of the given signals aborts.
export function combineSignals(signals) {
  const live = signals.filter((signal) => signal && typeof signal.addEventListener === 'function');
  if (live.length <= 1) return live[0] || new AbortController().signal;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(live);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  for (const signal of live) {
    if (signal.aborted) { controller.abort(); break; }
    signal.addEventListener('abort', onAbort, { once: true });
  }
  return controller.signal;
}

export function waitUntil(deadline, signal) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); };
    const onAbort = () => { cleanup(); reject(abortError()); };
    const tick = () => {
      if (signal?.aborted) return onAbort();
      const remaining = deadline - Date.now();
      if (remaining <= 0) { cleanup(); resolve(); }
      else timer = setTimeout(tick, Math.min(remaining, 30000));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    tick();
  });
}

export function waitForVisible(signal, doc = globalThis.document) {
  if (!doc?.hidden) return signal?.aborted ? Promise.reject(abortError()) : Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => { doc.removeEventListener('visibilitychange', onVisibility); signal?.removeEventListener('abort', onAbort); };
    const onAbort = () => { cleanup(); reject(abortError()); };
    const onVisibility = () => { if (!doc.hidden) { cleanup(); resolve(); } };
    doc.addEventListener('visibilitychange', onVisibility);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    else onVisibility();
  });
}
