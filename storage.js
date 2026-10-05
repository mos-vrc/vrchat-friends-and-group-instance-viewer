import { CONFIG } from './config.js';

export function accountCacheKey(baseKey, userId) {
  if (!userId || typeof userId !== 'string') throw new Error('A VRChat user ID is required for an account cache key.');
  return `${baseKey}:${encodeURIComponent(userId)}`;
}

export class JsonStorage {
  constructor(storage = window.localStorage) {
    this.storage = storage;
    this.objectCaches = new Set();
  }

  remove(key) {
    try { this.storage.removeItem(key); return true; } catch { return false; }
  }

  flush() { this.objectCaches.forEach(cache => cache.flush()); }

  dispose() { this.objectCaches.forEach(cache => cache.dispose()); this.objectCaches.clear(); }

  clearDataCaches() {
    this.objectCaches.forEach(cache => cache.clearMemory());
    const bases = Object.entries(CONFIG).filter(([name]) => name.endsWith('_CACHE_KEY')).map(([, value]) => value);
    let success = true;
    try {
      const keys = Array.from({ length: this.storage.length }, (_, i) => this.storage.key(i));
      for (const key of keys) {
        if (bases.some(base => key === base || key?.startsWith(base + ':'))) success = this.remove(key) && success;
      }
    } catch { success = false; }
    return success;
  }

  get(key, fallback = null) {
    try {
      const raw = this.storage.getItem(key);
      if (raw == null) return fallback;
      const parsed = JSON.parse(raw);
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

  set(key, value) {
    try {
      this.storage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }
}

export class ValueCache {
  constructor(storage, key, ttlMs) {
    this.storage = storage;
    this.key = key;
    this.ttlMs = ttlMs;
    this.loaded = false;
    this.value = null;
  }

  load() {
    if (this.loaded) return this.value;
    this.loaded = true;
    this.value = this.storage.get(this.key, null);
    return this.value;
  }

  get() {
    const record = this.load();
    if (!record || !Number.isFinite(record.cachedAt)) return null;
    if (Date.now() - record.cachedAt >= this.ttlMs) return null;
    return record.data;
  }

  getStale() {
    return this.getStaleRecord()?.data ?? null;
  }

  getStaleRecord() {
    const record = this.load();
    if (!record || !Object.prototype.hasOwnProperty.call(record, 'data')) return null;
    return record;
  }

  set(data) {
    const record = { cachedAt: Date.now(), data };
    this.value = record;
    this.loaded = true;
    this.storage.set(this.key, record);
    return data;
  }
}

export class ObjectCache {
  constructor(storage, key, maxEntries = 200) {
    this.storage = storage;
    this.key = key;
    this.maxEntries = maxEntries;
    this.loaded = false;
    this.entries = new Map();
    this.dirty = false;
    this.timer = null;
    this.storage.objectCaches?.add(this);
  }

  load() {
    if (this.loaded) return;
    this.loaded = true;
    const raw = this.storage.get(this.key, {});
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    for (const [cacheKey, record] of Object.entries(raw)) {
      if (record && typeof record === 'object' && Number.isFinite(record.cachedAt)) {
        this.entries.set(cacheKey, record);
      }
    }
  }

  get(key, ttlMs) {
    this.load();
    const record = this.entries.get(key);
    if (!record) return null;
    if (Date.now() - record.cachedAt >= ttlMs) {
      this.entries.delete(key);
      this.dirty = true;
      return null;
    }
    return record.data;
  }

  set(key, data) {
    this.load();
    this.entries.delete(key);
    this.entries.set(key, { cachedAt: Date.now(), data });
    this.prune();
    this.persist();
    return data;
  }

  setRecord(key, data, extra = {}) {
    this.load();
    this.entries.delete(key);
    this.entries.set(key, { cachedAt: Date.now(), data, ...extra });
    this.prune();
    this.persist();
  }

  getRecord(key, ttlMs, failureTtlMs = ttlMs) {
    this.load();
    const record = this.entries.get(key);
    if (!record) return null;
    const effectiveTtl = record.status ? failureTtlMs : ttlMs;
    if (Date.now() - record.cachedAt >= effectiveTtl) {
      this.entries.delete(key);
      this.dirty = true;
      this.persist();
      return null;
    }
    return record;
  }

  prune() {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
    this.dirty = true;
  }

  clearMemory() {
    clearTimeout(this.timer);
    this.timer = null;
    this.entries.clear();
    this.loaded = true;
    this.dirty = false;
  }

  dispose() {
    this.flush();
    this.storage.objectCaches?.delete(this);
  }

  persist() {
    if (this.timer || !this.dirty) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, CONFIG.CACHE_WRITE_DELAY_MS);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.loaded || !this.dirty) return;
    const object = Object.fromEntries(this.entries);
    if (this.storage.set(this.key, object)) this.dirty = false;
  }
}
