import { CONFIG } from './config.js';

export function isAllowedApiUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://vrchat.com' && !url.username && !url.password
      && url.pathname.startsWith('/api/1/');
  } catch { return false; }
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
    this.ready = store.load().then(value => { this.blockedUntil = Math.max(0, Number(value) || 0); });
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

  async pause(value, fallbackMs) {
    await this.ready;
    this.blockedUntil = Math.max(this.blockedUntil, retryAfterDeadline(value, this.now(), fallbackMs));
    // Serialize writes so an earlier response cannot overwrite a longer wait.
    const write = this.tail.then(() => this.store.save(this.blockedUntil));
    this.tail = write.catch(() => {});
    await write;
    return this.blockedUntil;
  }
}

export function abortError() { return new DOMException('Request superseded', 'AbortError'); }

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
