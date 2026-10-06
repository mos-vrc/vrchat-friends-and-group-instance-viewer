import { t } from './i18n.js';
// Transient notices share the surface with the latest reversible action.
// An unrelated refresh notice must not consume that action's lifetime.
export class ActionToast {
  constructor(root) {
    this.root = root;
    this.message = '';
    this.error = false;
    this.messageTimer = null;
    this.undoTimer = null;
    this.undo = null;
    this.hovered = false;
    this.focused = false;
    // The notice surface lets clicks reach controls underneath. Track its
    // bounds as well as button enter events so hovering its text still pauses.
    document.addEventListener('pointermove', event => {
      if (!this.undo || !root) return;
      const box = root.getBoundingClientRect();
      const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
      if (inside !== this.hovered) { this.hovered = inside; this.updateClock(); }
    }, { passive: true });
    root?.addEventListener('mouseenter', () => { this.hovered = true; this.updateClock(); });
    root?.addEventListener('mouseleave', () => { this.hovered = false; this.updateClock(); });
    root?.addEventListener('focusin', () => { this.focused = true; this.updateClock(); });
    root?.addEventListener('focusout', () => queueMicrotask(() => {
      this.focused = Boolean(root.contains(document.activeElement)); this.updateClock();
    }));
  }

  show(message, { error = false, delay = 2800 } = {}) {
    clearTimeout(this.messageTimer);
    this.message = String(message || '').trim();
    this.error = Boolean(error);
    this.render();
    if (delay > 0) this.messageTimer = setTimeout(() => {
      this.message = ''; this.error = false; this.render();
    }, delay);
  }

  setUndo(message, callback, onExpire = () => {}) {
    this.clearUndo();
    clearTimeout(this.messageTimer);
    this.message = ''; this.error = false;
    this.undo = { message, callback, onExpire, remaining: 10000, startedAt: null, busy: false };
    this.render(); this.updateClock();
  }

  updateClock() {
    clearTimeout(this.undoTimer); this.undoTimer = null;
    const undo = this.undo;
    if (!undo) return;
    if (undo.startedAt !== null) {
      undo.remaining = Math.max(0, undo.remaining - (performance.now() - undo.startedAt));
      undo.startedAt = null;
    }
    if (this.hovered || this.focused || undo.busy) return;
    if (!undo.remaining) { this.clearUndo(); return; }
    undo.startedAt = performance.now();
    this.undoTimer = setTimeout(() => { this.clearUndo(); }, undo.remaining);
  }

  setUndoBusy(busy) {
    if (!this.undo) return;
    this.undo.busy = busy;
    const button = this.root?.querySelector('[data-favorite-undo]');
    if (button) { button.disabled = busy; button.setAttribute('aria-busy', String(busy)); }
    this.updateClock();
  }

  clearUndo() {
    clearTimeout(this.undoTimer); this.undoTimer = null;
    const undo = this.undo; this.undo = null;
    undo?.onExpire(); this.render();
  }

  dismiss() {
    clearTimeout(this.messageTimer); this.messageTimer = null;
    this.message = ''; this.error = false; this.clearUndo();
  }

  render() {
    const root = this.root;
    if (!root) return;
    // Preserve the action button node and focus when other notices change.
    let notice = root.querySelector('.action-toast-message');
    if (this.message) {
      if (!notice) { notice = document.createElement('div'); notice.className = 'action-toast-message'; root.prepend(notice); }
      notice.textContent = this.message;
    } else notice?.remove();
    let row = root.querySelector('.action-toast-undo');
    if (this.undo) {
      if (!row) {
        row = document.createElement('div'); row.className = 'action-toast-undo';
        const text = document.createElement('span');
        const button = document.createElement('button'); button.type = 'button'; button.dataset.favoriteUndo = 'true';
        button.textContent = t('戻す');
        button.addEventListener('click', () => { if (this.undo && !this.undo.busy) this.undo.callback(); });
        row.append(text, button); root.append(row);
      }
      row.lastElementChild.textContent = t('戻す');
      row.firstElementChild.textContent = this.undo.message;
      row.lastElementChild.disabled = this.undo.busy;
    } else { row?.remove(); this.focused = Boolean(root.contains(document.activeElement)); }
    root.classList.toggle('is-visible', Boolean(this.message || this.undo));
    root.classList.toggle('error', this.error);
  }
}
