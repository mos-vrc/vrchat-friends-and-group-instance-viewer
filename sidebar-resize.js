import { t } from './i18n.js';

const limits = Object.freeze({ normal: { min: 144, max: 480, default: 168 }, location: { min: 280, max: 640, default: 280 } });
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class SidebarResizer {
  constructor({ sidebar, handle, getMode, onStart, onCommit }) {
    Object.assign(this, { sidebar, handle, getMode, onStart, onCommit });
    this.widths = { normal: 168, location: 280 };
    this.drag = null;
    handle.addEventListener('pointerdown', event => this.start(event));
    handle.addEventListener('pointermove', event => this.move(event));
    handle.addEventListener('pointerup', event => this.finish(event));
    handle.addEventListener('pointercancel', event => this.finish(event, true));
    handle.addEventListener('lostpointercapture', event => this.finish(event));
    handle.addEventListener('keydown', event => this.key(event));
    window.addEventListener('blur', () => this.finish());
    window.addEventListener('resize', () => { this.finish(); this.apply(); });
  }

  restore(saved) {
    for (const mode of Object.keys(limits)) {
      const value = mode === 'location' && saved?.defaultsVersion !== 2 && saved?.location === 336 ? 280 : saved?.[mode];
      this.widths[mode] = typeof value === 'number' && Number.isFinite(value)
        ? clamp(Math.round(value), limits[mode].min, limits[mode].max) : limits[mode].default;
    }
  }

  preferences() { return { ...this.widths, defaultsVersion: 2 }; }

  bounds(mode) {
    const { min, max } = limits[mode];
    // Client widths are CSS pixels, so this also follows browser zoom.
    return { min, max: Math.max(min, Math.min(max, document.querySelector('.app-shell').clientWidth - 320)) };
  }

  apply() {
    const mode = this.getMode();
    if (this.drag && mode !== this.drag.mode) this.finish(undefined, true);
    for (const key of Object.keys(limits)) {
      const { min, max } = this.bounds(key);
      document.body.style.setProperty(key === 'normal' ? '--sidebar-width' : '--sidebar-location-width', `${clamp(this.widths[key], min, max)}px`);
    }
    const hidden = mode === 'hidden';
    this.handle.tabIndex = hidden ? -1 : 0;
    this.handle.setAttribute('aria-label', t('フレンド一覧の幅を変更'));
    this.handle.title = t('フレンド一覧の幅を変更');
    if (!hidden) {
      const { min, max } = this.bounds(mode);
      this.handle.setAttribute('aria-valuemin', String(min));
      this.handle.setAttribute('aria-valuemax', String(max));
      this.handle.setAttribute('aria-valuenow', String(clamp(this.widths[mode], min, max)));
    }
  }

  start(event) {
    if (event.button !== 0 || !event.isPrimary || this.getMode() === 'hidden' || this.drag) return;
    event.preventDefault();
    const mode = this.getMode();
    const box = this.sidebar.getBoundingClientRect();
    this.drag = { mode, id: event.pointerId, x: event.clientX, start: this.sidebar.offsetWidth, previous: this.widths[mode], scale: box.width / this.sidebar.offsetWidth || 1 };
    this.onStart();
    this.handle.focus({ preventScroll: true });
    this.handle.setPointerCapture(event.pointerId);
    document.body.classList.add('sidebar-resizing');
  }

  move(event) {
    if (!this.drag || event.pointerId !== this.drag.id) return;
    const { min, max } = this.bounds(this.drag.mode);
    this.widths[this.drag.mode] = clamp(Math.round(this.drag.start + (event.clientX - this.drag.x) / this.drag.scale), min, max);
    this.apply();
  }

  finish(event, cancel = false) {
    const drag = this.drag;
    if (!drag || (event && event.pointerId !== drag.id)) return;
    this.drag = null;
    if (cancel) this.widths[drag.mode] = drag.previous;
    document.body.classList.remove('sidebar-resizing');
    if (this.handle.hasPointerCapture(drag.id)) this.handle.releasePointerCapture(drag.id);
    this.apply();
    if (!cancel && this.widths[drag.mode] !== drag.previous) this.onCommit();
  }

  key(event) {
    if (event.key === 'Escape' && this.drag) { event.preventDefault(); this.finish(undefined, true); return; }
    const mode = this.getMode();
    if (mode === 'hidden' || this.drag || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const { min, max } = this.bounds(mode);
    const width = clamp(this.widths[mode], min, max);
    this.widths[mode] = event.key === 'Home' ? min : event.key === 'End' ? max : clamp(width + (event.key === 'ArrowRight' ? 10 : -10), min, max);
    this.onStart(); this.apply(); this.onCommit();
  }
}
