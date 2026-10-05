import { safeImageUrl } from './domain.js';

// One body download per URL in this Viewer. Blobs are kept in memory only;
// img consumers use the same object URL and never fetch the remote URL again.
export class ImagePool {
  constructor({ concurrency = 10, timeoutMs = 20000, minIntervalMs = 50,
    maxBytes = 8 * 1024 * 1024, cacheBytes = 32 * 1024 * 1024,
    maxEntries = 256, fetcher = (...args) => fetch(...args),
    createUrl = blob => URL.createObjectURL(blob), revokeUrl = url => URL.revokeObjectURL(url),
    visible = () => !globalThis.document?.hidden, fallbackFor = () => '' } = {}) {
    Object.assign(this, { concurrency, timeoutMs, minIntervalMs, maxBytes, cacheBytes,
      maxEntries, fetcher, createUrl, revokeUrl, visible, fallbackFor });
    this.entries = new Map(); this.queue = []; this.active = 0;
    this.nextStart = 0; this.cooldownUntil = 0; this.timer = null;
  }
  acquire(raw, fallbackRaw = '') {
    const url = safeImageUrl(raw), fallback = safeImageUrl(fallbackRaw || this.fallbackFor(raw));
    if (!this.allowed(url) || (fallback && !this.allowed(fallback))) throw new Error('Invalid image URL');
    let entry = this.entries.get(url);
    if (entry && !entry.refs && entry.state === 'error' && Date.now() - entry.at >= 60000) {
      this.entries.delete(url); entry = null;
    }
    if (!entry) {
      entry = { url, fallback, refs: 0, state: 'queued', at: Date.now(), size: 0 };
      entry.promise = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; });
      // A detached consumer may release the request before attaching its handler.
      entry.promise.catch(() => {});
      this.entries.set(url, entry); this.queue.push(entry);
    }
    entry.refs++; entry.at = Date.now(); this.pump();
    let released = false;
    return { promise: entry.promise, release: () => {
      if (released) return; released = true; entry.refs--; entry.at = Date.now();
      if (!entry.refs && ['queued', 'loading'].includes(entry.state)) {
        this.entries.delete(url); entry.cancelled = true; entry.controller?.abort();
        entry.reject(new DOMException('Image no longer needed', 'AbortError'));
      }
      this.trim();
    }};
  }
  allowed(url) {
    if (!safeImageUrl(url)) return false;
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return false;
    return !parsed.pathname.startsWith('/api/') || /^\/api\/1\/(?:image|file)\//.test(parsed.pathname);
  }
  pump() {
    clearTimeout(this.timer); this.timer = null;
    if (!this.visible() || this.active >= this.concurrency) return;
    this.queue = this.queue.filter(e => !e.cancelled && e.refs > 0);
    if (!this.queue.length) return;
    const wait = Math.max(this.nextStart, this.cooldownUntil) - Date.now();
    if (wait > 0) { this.timer = setTimeout(() => this.pump(), wait); return; }
    const entry = this.queue.shift(); this.active++; entry.state = 'loading';
    this.nextStart = Date.now() + this.minIntervalMs;
    this.download(entry).finally(() => { this.active--; this.trim(); this.pump(); });
    if (this.active < this.concurrency) this.pump();
  }
  async body(url, signal) {
    const host = new URL(url).hostname;
    const response = await this.fetcher(url, { signal, cache: 'default',
      credentials: host === 'files.vrchat.cloud' ? 'omit' : 'include',
      referrerPolicy: 'no-referrer' });
    if (response.url && !this.allowed(response.url)) {
      await response.body?.cancel(); throw new Error('Invalid image destination');
    }
    if (!response.ok) {
      if (response.status === 429) {
        const raw = response.headers.get('Retry-After');
        const delay = raw && /^\d+(?:\.\d+)?$/.test(raw.trim()) ? Number(raw) * 1000
          : raw ? Date.parse(raw) - Date.now() : 30000;
        this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + Math.max(1000, Number.isFinite(delay) ? delay : 30000));
      }
      await response.body?.cancel();
      const error = new Error(`Image HTTP ${response.status}`); error.status = response.status; throw error;
    }
    if (Number(response.headers.get('Content-Length')) > this.maxBytes) {
      await response.body?.cancel(); throw new Error('Image too large');
    }
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > this.maxBytes) { await reader.cancel(); throw new Error('Image too large'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const blob = new Blob(chunks, { type: response.headers.get('Content-Type') || '' });
    const bytes = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
    const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
    const mime = bytes[0] === 137 && ascii(1, 4) === 'PNG' ? 'image/png'
      : bytes[0] === 255 && bytes[1] === 216 ? 'image/jpeg'
      : ['GIF87a', 'GIF89a'].includes(ascii(0, 6)) ? 'image/gif'
      : ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP' ? 'image/webp'
      : ascii(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 12)) ? 'image/avif'
      : '';
    if (!mime) throw new Error('Unsupported image data');
    return new Blob([blob], { type: mime });
  }
  async download(entry) {
    entry.controller = new AbortController();
    const timer = setTimeout(() => entry.controller.abort(), this.timeoutMs);
    try {
      let blob;
      try { blob = await this.body(entry.url, entry.controller.signal); }
      catch (error) {
        // No timeout/network/429 replay. A definitive missing sized endpoint
        // can use its original image once, within the same slot and deadline.
        if (![400, 404, 415].includes(error.status) || !entry.fallback || entry.fallback === entry.url
          || entry.controller.signal.aborted) throw error;
        blob = await this.body(entry.fallback, entry.controller.signal);
      }
      if (entry.cancelled || entry.controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      entry.objectUrl = this.createUrl(blob); entry.size = blob.size;
      entry.state = 'ready'; entry.at = Date.now(); entry.resolve(entry.objectUrl);
    } catch (error) {
      entry.state = 'error'; entry.at = Date.now(); entry.reject(error);
    } finally { clearTimeout(timer); }
  }
  trim() {
    let total = [...this.entries.values()].reduce((n, e) => n + e.size, 0);
    for (const entry of [...this.entries.values()].filter(e => !e.refs && ['ready', 'error'].includes(e.state)).sort((a, b) => a.at - b.at)) {
      if (total <= this.cacheBytes && this.entries.size <= this.maxEntries) break;
      this.entries.delete(entry.url); total -= entry.size;
      if (entry.objectUrl) this.revokeUrl(entry.objectUrl);
    }
  }
  clear() {
    clearTimeout(this.timer); this.timer = null; this.queue = [];
    for (const entry of this.entries.values()) {
      entry.cancelled = true; entry.controller?.abort();
      entry.reject(new DOMException('Image cache cleared', 'AbortError'));
      if (entry.objectUrl) this.revokeUrl(entry.objectUrl);
    }
    this.entries.clear();
  }
}

export class ImageController {
  constructor(pool, root = document.body) {
    this.pool = pool; this.root = root; this.items = new Map();
    this.observer = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) this.start(e.target);
    }, { rootMargin: '240px' });
    this.mutations = new MutationObserver(() => this.sync());
    this.mutations.observe(root, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['data-image-src', 'data-image-fallback-src'] });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { this.pool.pump(); this.sync(); }
    });
    this.sync();
  }
  sync() {
    for (const [image, item] of this.items) {
      if (!image.isConnected || image.dataset.imageSrc !== item.url) {
        item.handle?.release(); this.observer.unobserve(image); this.items.delete(image);
      }
    }
    for (const image of this.root.querySelectorAll('img[data-image-src]')) {
      if (!this.items.has(image)) {
        image.removeAttribute('src'); image.dataset.imageState = 'waiting';
        this.items.set(image, { url: image.dataset.imageSrc }); this.observer.observe(image);
      }
      if (!document.hidden) {
        const rect = image.getBoundingClientRect();
        // Client rects account for clipping in the independently scrolling panes.
        let visible = image.getClientRects().length && rect.bottom > -240 && rect.top < innerHeight + 240;
        for (let parent = image.parentElement; visible && parent && parent !== this.root; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
            const clip = parent.getBoundingClientRect(); visible = rect.bottom > clip.top - 240 && rect.top < clip.bottom + 240;
          }
        }
        if (visible) this.start(image);
      }
    }
  }
  start(image) {
    const item = this.items.get(image);
    if (!item || item.handle || document.hidden || !image.isConnected) return;
    image.dataset.imageState = 'loading';
    try { item.handle = this.pool.acquire(item.url, image.dataset.imageFallbackSrc); }
    catch { image.dataset.imageState = 'error'; return; }
    item.handle.promise.then(url => {
      if (this.items.get(image) !== item || !image.isConnected) return;
      image.src = url; image.dataset.imageState = 'ready';
    }, () => {
      if (this.items.get(image) === item && image.isConnected) image.dataset.imageState = 'error';
    });
  }
  reset() {
    for (const [image, item] of this.items) {
      item.handle?.release(); image.removeAttribute('src'); this.observer.unobserve(image);
    }
    this.items.clear(); this.pool.clear(); this.sync();
  }
}
