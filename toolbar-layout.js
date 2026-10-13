// Use intrinsic control widths rather than a fixed pane breakpoint. Measuring
// the tab children keeps the decision stable even when the tabs scroll.
export class ToolbarLayout {
  constructor(toolbar, { onLayout = () => {} } = {}) {
    this.toolbar = toolbar;
    this.onLayout = onLayout;
    this.frame = null;
    this.measurement = document.createElement('span');
    this.measurement.setAttribute('aria-hidden', 'true');
    this.measurement.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;white-space:pre;pointer-events:none;width:max-content;max-width:none;';
    document.body.appendChild(this.measurement);
    this.schedule = () => {
      if (this.frame !== null) return;
      this.frame = requestAnimationFrame(() => { this.frame = null; this.sync(); });
    };
    this.resize = new ResizeObserver(this.schedule);
    this.resize.observe(toolbar);
    this.mutations = new MutationObserver(this.schedule);
    this.mutations.observe(toolbar, { subtree:true, childList:true, characterData:true,
      attributes:true, attributeFilter:['hidden','class'] });
    toolbar.addEventListener('change', this.schedule);
    document.fonts?.ready.then(this.schedule);
    document.fonts?.addEventListener('loadingdone', this.schedule);
    this.schedule();
  }
  textWidth(element, text) {
    const style = getComputedStyle(element);
    // Measure browser-rendered glyphs with the same font/fallback settings.
    // Canvas estimates and font shorthands need not match native select text.
    for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle',
      'fontStretch', 'fontVariant', 'fontFeatureSettings', 'fontVariationSettings',
      'letterSpacing', 'textTransform']) this.measurement.style[property] = style[property];
    this.measurement.textContent = text;
    return this.measurement.offsetWidth;
  }
  sync() {
    const bar = this.toolbar, tabs = bar.querySelector('.tabs');
    if (!bar.isConnected || !tabs) return;
    const pixels = value => parseFloat(value) || 0;
    const children = [...tabs.children];
    const refresh = bar.querySelector('.toolbar-refresh');
    // Recover full-spacing intrinsic widths from either current presentation.
    // Font size is constant; only padding/gaps change in the tighter mode.
    const buttons = [...tabs.querySelectorAll('button')];
    const paddingCorrection = buttons.reduce((sum, button) => {
      const style = getComputedStyle(button);
      return sum + 18 - pixels(style.paddingLeft) - pixels(style.paddingRight);
    }, 0);
    const fullNavWidth = refresh.getBoundingClientRect().width + 8 - pixels(getComputedStyle(refresh).columnGap)
      + 8 + children.reduce((sum, child) => sum + child.getBoundingClientRect().width, 0)
      + paddingCorrection + 6 * Math.max(0, children.length - 1);
    const sort = bar.querySelector('.sort'), time = bar.querySelector('.updated-at');
    let sortWidth = 0, metaChildren = 1; // Separator is present in single-row mode.
    if (!sort.hidden) {
      const style = getComputedStyle(sort);
      const labelWidth = Math.max(0, ...[...sort.options].map(option => this.textWidth(sort, option.textContent)));
      sortWidth = Math.ceil(Math.max(140, labelWidth + pixels(style.paddingLeft) + pixels(style.paddingRight)
        + pixels(style.borderLeftWidth) + pixels(style.borderRightWidth) + 40));
      const width = sortWidth + 'px';
      if (sort.style.width !== width) { sort.style.width = width; sort.style.flexBasis = width; }
      metaChildren++;
    }
    let timeWidth = 0;
    if (getComputedStyle(time).display !== 'none') {
      const range = document.createRange();
      range.selectNodeContents(time);
      timeWidth = Math.ceil(range.getBoundingClientRect().width);
      range.detach();
      metaChildren++;
    }
    const optionsWidth = bar.querySelector('.toolbar-options').getBoundingClientRect().width;
    const fullMetaWidth = 1 + sortWidth + timeWidth + 8 * (metaChildren - 1);
    const fullRequired = fullNavWidth + fullMetaWidth + optionsWidth + 16 + 20 + 2;
    bar.classList.toggle('is-tight', fullRequired > bar.clientWidth);
    const barStyle = getComputedStyle(bar), navStyle = getComputedStyle(bar.querySelector('.toolbar-navigation'));
    const metaStyle = getComputedStyle(bar.querySelector('.toolbar-meta'));
    const navWidth = refresh.getBoundingClientRect().width + pixels(navStyle.columnGap)
      + children.reduce((sum, child) => sum + child.getBoundingClientRect().width, 0)
      + pixels(getComputedStyle(tabs).columnGap) * Math.max(0, children.length - 1);
    const metaWidth = 1 + sortWidth + timeWidth + pixels(metaStyle.columnGap) * (metaChildren - 1);
    const required = navWidth + metaWidth + optionsWidth + pixels(barStyle.columnGap) * 2;
    const available = bar.clientWidth - pixels(barStyle.paddingLeft) - pixels(barStyle.paddingRight);
    const twoRows = required + 2 > available;
    bar.classList.toggle('is-two-row', twoRows);
    const metaCount = Number(!sort.hidden) + Number(timeWidth > 0);
    const lowerRowWidth = sortWidth + timeWidth + pixels(metaStyle.columnGap) * Math.max(0, metaCount - 1)
      + optionsWidth + pixels(barStyle.columnGap);
    bar.classList.toggle('is-narrow-controls', twoRows && lowerRowWidth + 2 > available);
    // Geometry-only diagnostics used by browser checks.
    const tightPaddingReduction = buttons.reduce((sum, button) => sum + (button.classList.contains('friend-view-tab') ? 4 : 6), 0);
    const tightNavWidth = fullNavWidth - 6 - tightPaddingReduction - Math.max(0, children.length - 1);
    const minimumSingleWidth = tightNavWidth + 1 + sortWidth + timeWidth + 5 * (metaChildren - 1) + optionsWidth + 10 + 14 + 2;
    bar.dataset.minimumSingleWidth = String(Math.ceil(minimumSingleWidth));
    bar.dataset.requiredWidth = String(Math.ceil(required + 2));
    bar.dataset.availableWidth = String(Math.floor(available));
    this.onLayout();
  }
}
