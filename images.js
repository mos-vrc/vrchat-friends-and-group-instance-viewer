import { PersistentImageCache } from './image-cache.js';
import { safeImageUrl } from './domain.js';

// One body download per URL in this Viewer. Blobs are kept in memory only;
// img consumers use the same object URL and never fetch the remote URL again.
export class ImagePool {
  constructor({ concurrency = 10, timeoutMs = 20000, minIntervalMs = 50,
    maxBytes = 8 * 1024 * 1024, cacheBytes = 32 * 1024 * 1024,
    maxEntries = 256, fetcher = (...args) => fetch(...args),
    createUrl = blob => URL.createObjectURL(blob), revokeUrl = url => URL.revokeObjectURL(url),
    visible = () => !globalThis.document?.hidden, fallbackFor = () => '',
    persistent = new PersistentImageCache(), getScope = () => '' } = {}) {
    Object.assign(this, { concurrency, timeoutMs, minIntervalMs, maxBytes, cacheBytes,
      maxEntries, fetcher, createUrl, revokeUrl, visible, fallbackFor, persistent, getScope });
    this.entries = new Map(); this.queue = []; this.active = 0;
    this.nextStart = 0; this.cooldownUntil = 0; this.timer = null;
  }
  acquire(raw, fallbackRaw = '', {defer=false} = {}) {
    const url = safeImageUrl(raw), fallback = safeImageUrl(fallbackRaw || this.fallbackFor(raw));
    if (!this.allowed(url) || (fallback && !this.allowed(fallback))) throw new Error('Invalid image URL');
    let entry = this.entries.get(url);
    if (entry && !entry.refs && entry.state === 'error' && Date.now() - entry.at >= 60000) {
      this.entries.delete(url); entry = null;
    }
    if (!entry) {
      entry = { url, fallback, scope: this.getScope(), refs: 0, state: 'queued', at: Date.now(), size: 0 };
      entry.promise = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; });
      // A detached consumer may release the request before attaching its handler.
      entry.promise.catch(() => {});
      this.entries.set(url, entry); this.queue.push(entry);
    }
    entry.refs++; entry.at = Date.now(); if(!defer)this.pump();
    let released = false;
    return { promise: entry.promise, get state(){return entry.state}, release: () => {
      if (released) return; released = true; entry.refs--; entry.at = Date.now();
      if (!entry.refs && ['queued', 'loading'].includes(entry.state)) {
        // A reset can already have installed a newer request for this URL.
        if (this.entries.get(url) === entry) this.entries.delete(url);
        entry.cancelled = true; entry.controller?.abort();
        entry.reject(new DOMException('Image no longer needed', 'AbortError'));
      }
      this.trim();
    }};
  }
  retryFailed(raw) {
    const url=safeImageUrl(raw),entry=this.entries.get(url);
    if(entry?.state==='error')this.entries.delete(url);
  }
  prioritize(urls) {
    const rank=new Map(urls.map((url,index)=>[url,index]));
    this.queue.sort((a,b)=>(rank.get(a.url)??Infinity)-(rank.get(b.url)??Infinity));
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
      credentials: ['vrchat.com', 'api.vrchat.cloud'].includes(host) ? 'include' : 'omit',
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
      const saved = await this.persistent.read(entry.url, entry.scope);
      if (entry.cancelled || entry.controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      let blob = saved.blob;
      try { if (!blob) blob = await this.body(entry.url, entry.controller.signal); }
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
      // Saving is independent of display and bounded by the cache deadline.
      if (!saved.blob) void this.persistent.write(entry.url, entry.scope, blob, saved.generation).catch(() => {});
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
  constructor(pool, root = document.body, {preloadPx=840} = {}) {
    this.preloadPx=preloadPx; this.scrollFrame=null;
    this.pool = pool; this.root = root; this.items = new Map();
    this.observer = new IntersectionObserver(entries => {
      if(entries.some(e=>e.isIntersecting))this.sync();
    }, { rootMargin: `${this.preloadPx}px` });
    this.mutations = new MutationObserver(() => this.sync());
    this.mutations.observe(root, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['data-image-src', 'data-image-fallback-src'] });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { this.pool.pump(); this.sync(); }
    });
    this.root.addEventListener('scroll',()=>{
      if(this.scrollFrame!==null)return;
      this.scrollFrame=requestAnimationFrame(()=>{this.scrollFrame=null;if(!document.hidden)this.sync()});
    },{capture:true,passive:true});
    this.sync();
  }
  sync() {
    for (const [image, item] of this.items) {
      if (!image.isConnected || image.dataset.imageSrc !== item.url) {
        item.handle?.release(); this.observer.unobserve(image); this.items.delete(image);
      }
    }
    const candidates=[],clips=new Map();
    for (const image of this.root.querySelectorAll('img[data-image-src]')) {
      if (!this.items.has(image)) {
        image.removeAttribute('src'); image.dataset.imageState = 'waiting';
        this.items.set(image, { url: image.dataset.imageSrc }); this.observer.observe(image);
      }
      if(document.hidden)continue;
      const rect=image.getBoundingClientRect();
      let nearby=Boolean(image.getClientRects().length) && rect.bottom>-Math.max(this.preloadPx,1200) && rect.top<innerHeight+Math.max(this.preloadPx,1200), visible=nearby;
      let top=0,bottom=innerHeight;
      for(let parent=image.parentElement;nearby && parent && parent!==this.root;parent=parent.parentElement){
        if(!clips.has(parent))clips.set(parent,/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)?parent.getBoundingClientRect():null);
        const clip=clips.get(parent);
        if(clip){top=Math.max(top,clip.top);bottom=Math.min(bottom,clip.bottom);}
      }
      const preload=Math.max(this.preloadPx,Math.min(bottom-top,1200));
      nearby=nearby && rect.bottom>top-preload && rect.top<bottom+preload;
      visible=visible && rect.bottom>top && rect.top<bottom;
      const item=this.items.get(image);
      if(nearby)candidates.push({image,visible,distance:visible?0:Math.max(top-rect.bottom,rect.top-bottom,0)+1});
      else if(item.handle?.state==='queued'){
        // Drop only unstarted downloads; completed cache and active work survive.
        const old=item.handle;item.handle=null;old.release();image.dataset.imageState='waiting';
      }
    }
    candidates.sort((a,b)=>a.distance-b.distance);
    this.pool.prioritize(candidates.map(c=>this.items.get(c.image).url));
    for(const {image} of candidates)this.start(image);
    this.pool.prioritize(candidates.map(c=>this.items.get(c.image).url));
    this.pool.pump();
  }

  start(image) {
    const item = this.items.get(image);
    if (!item || item.handle || document.hidden || !image.isConnected) return;
    image.dataset.imageState = 'loading';
    try { item.handle = this.pool.acquire(item.url, image.dataset.imageFallbackSrc, {defer:true}); }
    catch { image.dataset.imageState = 'error'; return; }
    const handle=item.handle;
    handle.promise.then(url => {
      if (this.items.get(image) !== item || item.handle!==handle || !image.isConnected) return;
      image.src = url; image.dataset.imageState = 'ready';
    }, () => {
      if (this.items.get(image) === item && item.handle===handle && image.isConnected) image.dataset.imageState = 'error';
    });
  }
  reset() {
    for (const [image, item] of this.items) {
      item.handle?.release(); image.removeAttribute('src'); this.observer.unobserve(image);
    }
    this.items.clear(); this.pool.clear(); this.sync();
  }
}
