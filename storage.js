export function accountCacheKey(baseKey, userId) {
  if (!userId || typeof userId !== 'string') throw new Error('A VRChat user ID is required for an account cache key.');
  return `${baseKey}:${encodeURIComponent(userId)}`;
}

export class JsonStorage {
  constructor(storage = window.localStorage) {
    this.storage = storage;
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

  getRecord(key, ttlMs) {
    this.load();
    const record = this.entries.get(key);
    if (!record) return null;
    if (Date.now() - record.cachedAt >= ttlMs) {
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

  persist() {
    if (!this.loaded || !this.dirty) return;
    const object = Object.fromEntries(this.entries);
    if (this.storage.set(this.key, object)) this.dirty = false;
  }
}
