// Account-scoped, bounded cache of validated image blobs. Cache failures never
// block an image download. A persistent generation prevents a late save in
// another Viewer from resurrecting images after the cache has been cleared.
const TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);
export class PersistentImageCache {
  constructor({ indexedDB = globalThis.indexedDB, name = 'vrc_viewer_images_v1',
    maxBytes = 64 * 1024 * 1024, maxEntries = 512, timeoutMs = 1200 } = {}) {
    Object.assign(this, { indexedDB, name, maxBytes, maxEntries, timeoutMs });
    this.database = null;
    this.opening = null;
    this.unavailable = false;
  }
  async open() {
    if (!this.indexedDB || this.unavailable) return null;
    if (this.database) return this.database;
    if (this.opening) return this.opening;
    this.opening = new Promise(resolve => {
      let settled = false;
      const finish = db => { if (settled) { db?.close(); return; } settled = true; clearTimeout(timer); if (!db) this.unavailable = true; resolve(db); };
      const timer = setTimeout(() => finish(null), this.timeoutMs);
      try {
        const request = this.indexedDB.open(this.name, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          db.createObjectStore('images', { keyPath: 'key' });
          db.createObjectStore('meta');
        };
        request.onerror = () => finish(null);
        request.onblocked = () => finish(null);
        request.onsuccess = () => {
          const db = request.result;
          if (!settled) {
            this.database = db;
            db.onversionchange = () => { db.close(); if (this.database === db) this.database = null; };
          }
          finish(db);
        };
      } catch { finish(null); }
    }).finally(() => { this.opening = null; });
    return this.opening;
  }
  async transaction(mode, run, fallback) {
    const db = await this.open();
    if (!db) return fallback;
    return new Promise(resolve => {
      let tx, result = fallback, settled = false;
      const finish = value => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
      const timer = setTimeout(() => { try { tx?.abort(); } catch {} finish(fallback); }, this.timeoutMs);
      try {
        tx = db.transaction(['images', 'meta'], mode);
        tx.oncomplete = () => finish(result);
        tx.onerror = tx.onabort = () => finish(fallback);
        run(tx.objectStore('images'), tx.objectStore('meta'), value => { result = value; });
      } catch { try { tx?.abort(); } catch {} finish(fallback); }
    });
  }
  valid(blob) { return blob instanceof Blob && blob.size > 0 && blob.size <= 8 * 1024 * 1024 && TYPES.has(blob.type); }
  async read(url, scope) {
    if (!scope) return { blob: null, generation: null };
    return this.transaction('readonly', (images, meta, result) => {
      const row = images.get(scope + '\n' + url), epoch = meta.get('generation');
      let entry, generation, done = 0;
      const finish = () => {
        if (++done < 2) return;
        result({ blob: entry && entry.expiresAt > Date.now() && this.valid(entry.blob) ? entry.blob : null,
          generation: Number.isFinite(generation) ? generation : 0 });
      };
      row.onsuccess = () => { entry = row.result; finish(); };
      epoch.onsuccess = () => { generation = epoch.result; finish(); };
    }, { blob: null, generation: null });
  }
  async write(url, scope, blob, generation) {
    if (!scope || generation === null || !this.valid(blob)) return false;
    return this.transaction('readwrite', (images, meta, result) => {
      const epoch = meta.get('generation');
      epoch.onsuccess = () => {
        if ((epoch.result || 0) !== generation) return;
        const now = Date.now(), key = scope + '\n' + url;
        // Versioned VRChat files naturally change their URL on replacement.
        const versioned = /\/file_[^/]+\/\d+\//.test(new URL(url).pathname);
        const entry = { key, blob, size: blob.size, at: now, expiresAt: now + (versioned ? 30 : 1) * 86400000 };
        images.put(entry);
        meta.put({ key, size: blob.size, at: now, expiresAt: entry.expiresAt }, key);
        const rows = meta.getAll();
        rows.onsuccess = () => {
          const valid = rows.result.filter(row => {
            if (!row || typeof row !== 'object' || typeof row.key !== 'string') return false;
            if (row.expiresAt <= now || !Number.isFinite(row.size) || row.size <= 0) { images.delete(row.key); meta.delete(row.key); return false; }
            return true;
          }).sort((a, b) => b.at - a.at);
          let bytes = 0;
          valid.forEach((row, index) => {
            bytes += row.size;
            if (index >= this.maxEntries || bytes > this.maxBytes) { images.delete(row.key); meta.delete(row.key); }
          });
          result(true);
        };
      };
    }, false);
  }
  async clear() {
    return this.transaction('readwrite', (images, meta, result) => {
      const epoch = meta.get('generation');
      epoch.onsuccess = () => { const generation = (epoch.result || 0) + 1; images.clear(); meta.clear(); meta.put(generation, 'generation'); result(true); };
    }, !this.indexedDB);
  }
}
