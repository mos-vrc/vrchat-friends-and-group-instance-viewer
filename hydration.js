/**
 * Bounded, render-safe lazy hydration controller for instance cards.
 *
 * The controller deliberately does not depend on IntersectionObserver's first
 * callback for the initial viewport. It also keeps queued work across renders
 * and rechecks the current entry for a location when a request finishes so a
 * fast re-render cannot strand a card behind an active request.
 */
export class InstanceHydrationController {
  constructor({
    root,
    getEntries,
    getSupplementalLocations = () => [],
    needsHydration,
    hydrate,
    concurrency = 2,
    preloadPx = 420,
    initialCount = 4,
  }) {
    this.root = root;
    this.getEntries = getEntries;
    this.getSupplementalLocations = getSupplementalLocations;
    this.needsHydration = needsHydration;
    this.hydrate = hydrate;
    this.concurrency = Math.max(1, concurrency);
    this.preloadPx = Math.max(0, preloadPx);
    this.initialCount = Math.max(0, initialCount);
    this.generation = 0;
    this.observer = null;
    this.queue = [];
    this.queuedLocations = new Set();
    this.activeLocations = new Set();
    this.stopped = false;
    this.mode = 'normal';
    this.priorityLocations = [];
    this.batching = false;
    this.scrollFrame = null;
    this.root?.addEventListener?.('scroll', () => {
      if(this.stopped || this.scrollFrame !== null)return;
      this.scrollFrame=requestAnimationFrame(()=>{
        this.scrollFrame=null;
        if(!this.stopped && this.mode==='normal' && !globalThis.document?.hidden)this.refreshViewport();
      });
    }, {passive:true});
  }

  reset() {
    if(this.scrollFrame!==null && typeof cancelAnimationFrame==='function')cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame=null;
    this.stopped = false;
    this.generation += 1;
    this.disconnect();
    this.queue = [];
    this.queuedLocations.clear();
    this.activeLocations = new Set();
  }

  stop() {
    this.reset();
    this.stopped = true;
  }

  pause() {
    this.disconnect();
    this.queue = [];
    this.queuedLocations.clear();
  }

  disconnect() {
    this.observer?.disconnect();
    this.observer = null;
  }

  sync({ mode = 'normal', priorityLocations = [] } = {}) {
    if (this.stopped || !this.root) return;
    if (globalThis.document?.hidden) { this.pause(); return; }
    this.disconnect();
    this.mode=mode; this.priorityLocations=priorityLocations;

    const cards = [...this.root.querySelectorAll('.card, .friend-location-item[data-location]')];
    const visibleLocations = new Set([...cards.map(card => card.dataset.location), ...this.getSupplementalLocations()].filter(Boolean));
    // Keep active requests alive, but discard queued work for cards that are
    // no longer rendered (for example after a tab switch). This prevents a
    // previous view from causing background API requests for invisible cards.
    this.queue = this.queue.filter((job) => visibleLocations.has(job.location));
    this.queuedLocations = new Set(this.queue.map((job) => job.location));
    if (!cards.length) { this.refreshViewport(); return; }

    const queueCard = (card) => {
      const entry = this.getEntries().find((candidate) => candidate.location === card.dataset.location);
      this.enqueue(entry);
    };

    // A focused friend navigation is intentionally isolated from bulk lazy
    // hydration. Switching from Favorite+ to All can expose many new cards;
    // hydrating all of them before the target scroll settles causes unnecessary
    // requests and moves the target while it is being highlighted. During the
    // focus phase, only the requested instance is hydrated. The normal
    // observer/preload pass is scheduled by the caller after the highlight.
    if (mode === 'focus') {
      const targets = new Set(priorityLocations.filter(Boolean));
      cards.forEach((card) => {
        if (targets.has(card.dataset.location)) queueCard(card);
      });
      return;
    }

    if ('IntersectionObserver' in window) {
      this.observer = new IntersectionObserver((items) => {
        if(items.some(item=>item.isIntersecting))this.refreshViewport();
      }, { root:this.root, rootMargin:`${this.preloadPx}px 0px`, threshold:0.01 });
      cards.forEach(card=>this.observer.observe(card));
    }
    this.refreshViewport();
  }

  refreshViewport() {
    if(this.stopped || this.mode==='focus' || globalThis.document?.hidden || !this.root)return;
    const cards=[...this.root.querySelectorAll('.card, .friend-location-item[data-location]')];
    const bounds=this.root.getBoundingClientRect(), ranked=new Map();
    const preload=Math.max(this.preloadPx,Math.min(bounds.bottom-bounds.top,1200));
    for(const [index,card] of cards.entries()){
      const rect=card.getBoundingClientRect(), location=card.dataset.location;
      if(!location)continue;
      const visible=rect.bottom>=bounds.top && rect.top<=bounds.bottom;
      const nearby=rect.bottom>=bounds.top-preload && rect.top<=bounds.bottom+preload;
      const initial=!(this.root.scrollTop>0) && index<this.initialCount;
      if(!nearby && !initial)continue;
      const distance=visible?0:Math.max(bounds.top-rect.bottom,rect.top-bounds.bottom,0)+1;
      if(!ranked.has(location) || distance<ranked.get(location))ranked.set(location,distance);
    }
    // The left location pane shares this controller. Preserve its current
    // visible/preloaded jobs across right-pane renders and scroll jumps, but
    // keep the main viewport first and do not retain offscreen sidebar work.
    for (const location of this.getSupplementalLocations()) {
      if (location && !ranked.has(location)) ranked.set(location, 100000);
    }
    // A scroll jump must not wait behind unopened cards near the old position.
    this.queue=this.queue.filter(job=>ranked.has(job.location));
    this.queuedLocations=new Set(this.queue.map(job=>job.location));
    const entries=new Map(this.getEntries().map(entry=>[entry.location,entry]));
    this.batching=true;
    try {for(const [location] of [...ranked].sort((a,b)=>a[1]-b[1]))this.enqueue(entries.get(location));}
    finally {this.batching=false;}
    this.queue.sort((a,b)=>ranked.get(a.location)-ranked.get(b.location));
    this.pump();
  }

  observeNode(node) {
    if (node && this.observer) this.observer.observe(node);
  }

  unobserveNode(node) {
    if (node && this.observer) this.observer.unobserve(node);
  }

  enqueue(entry) {
    if (this.stopped || globalThis.document?.hidden || !entry || !this.needsHydration(entry)) return;
    const location = entry.location;
    if (!location || this.activeLocations.has(location) || this.queuedLocations.has(location)) return;
    this.queuedLocations.add(location);
    this.queue.push({ location, entry });
    if(!this.batching)this.pump();
  }

  pump() {
    if (this.stopped) return;
    if (globalThis.document?.hidden) { this.pause(); return; }
    while (this.activeLocations.size < this.concurrency && this.queue.length) {
      const job = this.queue.shift();
      if (!job) continue;
      this.queuedLocations.delete(job.location);
      if (this.activeLocations.has(job.location)) continue;

      const current = this.getEntries().find((entry) => entry.location === job.location) || job.entry;
      if (!this.needsHydration(current)) continue;

      const generation = this.generation;
      let cancelled = false;
      this.activeLocations.add(job.location);
      Promise.resolve().then(() => {
        if (this.stopped || generation !== this.generation) { cancelled = true; return; }
        return this.hydrate(job.location, current);
      })
        .catch(error => { cancelled = error?.name === 'AbortError'; })
        .finally(() => {
          if (generation !== this.generation) return;
          this.activeLocations.delete(job.location);

          // A render may have replaced the Entry object while the request was
          // in flight. Requeue the current object, not the stale one.
          const latest = this.getEntries().find((entry) => entry.location === job.location);
          // A no-op or failed hydration must not retry the same object in a
          // microtask loop. Only a replacement from a newer render warrants
          // reconciliation; reset/sync explicitly schedules future retries.
          if (!cancelled && latest && latest !== current && this.needsHydration(latest)) this.enqueue(latest);

          this.pump();
        });
    }
  }
}
