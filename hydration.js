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
    needsHydration,
    hydrate,
    concurrency = 2,
    preloadPx = 420,
    initialCount = 4,
  }) {
    this.root = root;
    this.getEntries = getEntries;
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
  }

  reset() {
    this.generation += 1;
    this.disconnect();
    this.queue = [];
    this.queuedLocations.clear();
    this.activeLocations = new Set();
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
    if (!this.root) return;
    if (globalThis.document?.hidden) { this.pause(); return; }
    this.disconnect();

    const cards = [...this.root.querySelectorAll('.card, .friend-location-item[data-location]')];
    const visibleLocations = new Set(cards.map((card) => card.dataset.location).filter(Boolean));
    // Keep active requests alive, but discard queued work for cards that are
    // no longer rendered (for example after a tab switch). This prevents a
    // previous view from causing background API requests for invisible cards.
    this.queue = this.queue.filter((job) => visibleLocations.has(job.location));
    this.queuedLocations = new Set(this.queue.map((job) => job.location));
    if (!cards.length) return;

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

    // Deterministic first paint: always schedule the first few cards. This
    // avoids a startup race where a render happens before IO delivers its
    // initial callback.
    cards.slice(0, this.initialCount).forEach(queueCard);

    if ('IntersectionObserver' in window) {
      this.observer = new IntersectionObserver((items) => {
        for (const item of items) {
          if (!item.isIntersecting) continue;
          queueCard(item.target);
          this.observer?.unobserve(item.target);
        }
      }, {
        root: this.root,
        rootMargin: `${this.preloadPx}px 0px`,
        threshold: 0.01,
      });
      cards.forEach((card) => this.observer.observe(card));
    }

    // Synchronous geometry pass is the fallback for browsers that delay the
    // initial IntersectionObserver callback. It also makes reload behavior
    // deterministic in tests and in transient layout states.
    const rootRect = this.root.getBoundingClientRect();
    const preloadTop = rootRect.top - this.preloadPx;
    const preloadBottom = rootRect.bottom + this.preloadPx;
    cards.forEach((card) => {
      const rect = card.getBoundingClientRect();
      if (rect.top <= preloadBottom && rect.bottom >= preloadTop) queueCard(card);
    });

    // No IntersectionObserver support: hydrate the first preload range rather
    // than only one or two entries.
    if (!this.observer) {
      cards.slice(0, this.initialCount).forEach(queueCard);
    }
  }

  observeNode(node) {
    if (node && this.observer) this.observer.observe(node);
  }

  unobserveNode(node) {
    if (node && this.observer) this.observer.unobserve(node);
  }

  enqueue(entry) {
    if (globalThis.document?.hidden || !entry || !this.needsHydration(entry)) return;
    const location = entry.location;
    if (!location || this.activeLocations.has(location) || this.queuedLocations.has(location)) return;
    this.queuedLocations.add(location);
    this.queue.push({ location, entry });
    this.pump();
  }

  pump() {
    if (globalThis.document?.hidden) { this.pause(); return; }
    while (this.activeLocations.size < this.concurrency && this.queue.length) {
      const job = this.queue.shift();
      if (!job) continue;
      this.queuedLocations.delete(job.location);
      if (this.activeLocations.has(job.location)) continue;

      const current = this.getEntries().find((entry) => entry.location === job.location) || job.entry;
      if (!this.needsHydration(current)) continue;

      const generation = this.generation;
      this.activeLocations.add(job.location);
      Promise.resolve(this.hydrate(job.location, current))
        .catch(() => {})
        .finally(() => {
          if (generation !== this.generation) return;
          this.activeLocations.delete(job.location);

          // A render may have replaced the Entry object while the request was
          // in flight. Requeue the current object, not the stale one.
          const latest = this.getEntries().find((entry) => entry.location === job.location);
          if (latest && this.needsHydration(latest)) this.enqueue(latest);

          this.pump();
        });
    }
  }
}
