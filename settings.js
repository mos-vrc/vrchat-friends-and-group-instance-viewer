import {t, setLocale, getLocale, initialLanguage} from "./i18n.js";
import {CONFIG, SORTS, TABS} from "./config.js";

// Preference persistence, visual settings and options-panel positioning.
export function createSettings({
  FRIEND_VIEW_SORTS,
  VIEW_MODES,
  applyMainSortOptions,
  closeFavoriteMenu,
  elements,
  hideFriendInstancePreview,
  renderFriendSidebar,
  setNotificationPanelOpen,
  sidebarResizer,
  state,
  uiStorage
}) {
  function readUiPreferences() {
    const prefs = uiStorage.get(CONFIG.UI_PREFERENCES_KEY, {});
    return prefs && typeof prefs === 'object' && !Array.isArray(prefs) ? prefs : {};
  }

  function persistUiPreferences() {
    uiStorage.set(CONFIG.UI_PREFERENCES_KEY, {
      language: getLocale(),
      updatedTimeMode: state.updatedTimeMode,
      settingsAdvancedExpanded: state.settingsAdvancedExpanded,
      viewMode: state.viewMode,
      tab: state.tab,
      sort: state.sort,
      friendViewSort: state.friendViewSort,
      instanceSize: state.instanceSize,
      instanceDisplay: state.instanceDisplay,
      friendSort: state.friendSort,
      offlineSort: state.offlineSort,
      showIconFrames: state.showIconFrames,
      showNonFriendOwners: state.showNonFriendOwners,
      showFloatingMemo: state.showFloatingMemo,
      theme: state.theme,
      autoRefreshMinutes: state.autoRefreshMinutes,
      sidebarWidths: sidebarResizer.preferences(),
      sidebarMode: state.sidebarMode,
      sidebarFooterExpanded: state.sidebarFooterExpanded,
      sidebarCollapsed: state.sidebarMode === 'hidden',
      friendFilter: elements.friendFilter?.value || 'all',
      showOnWebsite: elements.showOnWebsite?.checked !== false,
      showOffline: elements.showOffline?.checked === true,
    });
  }

  function restoreUiPreferences() {
    const prefs = readUiPreferences();
    setLocale(initialLanguage(prefs.language));
    state.updatedTimeMode=prefs.updatedTimeMode==='exact'?'exact':'relative';
    setSettingsAdvanced(prefs.settingsAdvancedExpanded===true);
    sidebarResizer.restore(prefs.sidebarWidths);
    document.getElementById('language').value = getLocale();
    state.viewMode = Object.values(VIEW_MODES).includes(prefs.viewMode)
      ? prefs.viewMode
      : VIEW_MODES.INSTANCES;
    state.tab = Object.values(TABS).includes(prefs.tab) ? prefs.tab : TABS.FAVORITE_PLUS;
    state.sort = Object.values(SORTS).includes(prefs.sort) ? prefs.sort : SORTS.FRIENDS_DESC;
    state.friendViewSort = Object.values(FRIEND_VIEW_SORTS).includes(prefs.friendViewSort)
      ? prefs.friendViewSort
      : FRIEND_VIEW_SORTS.NAME;
    state.instanceSize = ['small', 'medium', 'large'].includes(prefs.instanceSize)
      ? prefs.instanceSize
      : 'medium';
    state.instanceDisplay = ['simple', 'normal'].includes(prefs.instanceDisplay)
      ? prefs.instanceDisplay
      : 'normal';
    state.friendSort = ['name', 'favorite_list'].includes(prefs.friendSort)
      ? prefs.friendSort
      : 'favorite_list';
    if (prefs.theme === 'sage') prefs.theme = 'mist';
    state.theme = ['light', 'sand', 'mist', 'ash', 'dark-blue', 'dark'].includes(prefs.theme)
      ? prefs.theme
      : 'ash';
    state.autoRefreshMinutes = [5, 10, 30].includes(Number(prefs.autoRefreshMinutes))
      ? Number(prefs.autoRefreshMinutes)
      : 0;
    state.sidebarMode = ['normal', 'location', 'hidden'].includes(prefs.sidebarMode)
      ? prefs.sidebarMode
      : prefs.sidebarCollapsed === true
        ? 'hidden'
        : 'normal';
    state.sidebarFooterExpanded = prefs.sidebarFooterExpanded === true;
    state.offlineSort = ['name', 'recent', 'oldest'].includes(prefs.offlineSort) ? prefs.offlineSort : 'name';
    if (elements.offlineSort) elements.offlineSort.value = state.offlineSort;
    state.showIconFrames=prefs.showIconFrames===true;elements.showIconFrames.checked=state.showIconFrames;
    state.showFloatingMemo = prefs.showFloatingMemo !== false;
    if(elements.showFloatingMemo)elements.showFloatingMemo.checked=state.showFloatingMemo;
    state.showNonFriendOwners = prefs.showNonFriendOwners === true;
    if (elements.showNonFriendOwners) elements.showNonFriendOwners.checked = state.showNonFriendOwners;
    applyInstanceSize();
    applyInstanceDisplay();
    applyTheme();
    applySidebarMode();
    if (elements.friendSort) elements.friendSort.value = state.friendSort;
    if (elements.instanceDisplay) elements.instanceDisplay.value = state.instanceDisplay;
    if (elements.autoRefresh) elements.autoRefresh.value = String(state.autoRefreshMinutes);
    if (elements.friendFilter) {
      const requestedFilter = ['all', 'favorite', 'joinable'].includes(prefs.friendFilter)
        || (typeof prefs.friendFilter === 'string' && prefs.friendFilter.startsWith('favorite-group:'))
        ? prefs.friendFilter
        : 'favorite';
      state.requestedFriendFilter = requestedFilter;
      if ([...elements.friendFilter.options].some((option) => option.value === requestedFilter)) {
        elements.friendFilter.value = requestedFilter;
      } else {
        elements.friendFilter.value = 'favorite';
      }
    }
    if (elements.showOnWebsite) {
      elements.showOnWebsite.checked = typeof prefs.showOnWebsite === 'boolean'
        ? prefs.showOnWebsite
        : false;
    }
    if (elements.showOffline) elements.showOffline.checked = typeof prefs.showOffline === 'boolean' ? prefs.showOffline : prefs.showOfflineFavorites === true;
    applyMainSortOptions();
  }

  function updateInstanceSizeButtons() {
    document.querySelectorAll('.instance-size-button').forEach((button) => {
      const active = button.dataset.instanceSize === state.instanceSize;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function applyInstanceSize() {
    const size = ['small', 'medium', 'large'].includes(state.instanceSize)
      ? state.instanceSize
      : 'medium';
    state.instanceSize = size;
    document.body.dataset.instanceSize = size;
    updateInstanceSizeButtons();
  }

  function applyInstanceDisplay() {
    const display = ['simple', 'normal'].includes(state.instanceDisplay)
      ? state.instanceDisplay
      : 'normal';
    state.instanceDisplay = display;
    document.body.dataset.instanceDisplay = display;
    if (elements.instanceDisplay) elements.instanceDisplay.value = display;
    syncFriendLocationTips();
  }

  function syncFriendLocationTips() {
    elements.list?.querySelectorAll('.friend-location-item [data-friend-tip]').forEach(element => {
      if (state.instanceDisplay === 'simple') element.removeAttribute('title');
      else element.setAttribute('title', element.dataset.friendTip);
    });
  }

  function updateThemeButtons() {
    document.querySelectorAll('.theme-button').forEach((button) => {
      const active = button.dataset.theme === state.theme;
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', String(active));
    });
  }

  function applyTheme() {
    const theme = ['light', 'sand', 'mist', 'ash', 'dark-blue', 'dark'].includes(state.theme)
      ? state.theme
      : 'ash';
    state.theme = theme;
    document.documentElement.dataset.theme = theme;
    document.body.dataset.theme = theme;
    document.documentElement.style.colorScheme = ['light', 'sand', 'mist'].includes(theme) ? 'light' : 'dark';
    updateThemeButtons();
  }

  function applySidebarFooter() {
    const button=elements.sidebarFooterToggle,controls=elements.sidebarVisibilityControls;
    if(!button||!controls)return;
    const open=state.sidebarFooterExpanded;
    const footer=button.closest('.friend-sidebar-footer');
    footer.classList.toggle('is-expanded',open);footer.hidden=state.sidebarMode==='hidden';
    controls.hidden=!open;button.setAttribute('aria-expanded',String(open));
    button.title=button.ariaLabel=t(open?'OtherPlatform・Offlineの設定を閉じる':'OtherPlatform・Offlineの設定を開く');
    button.querySelector('path').setAttribute('d',open?'m5 8 5 5 5-5':'m5 12 5-5 5 5');
  }
  elements.sidebarFooterToggle?.addEventListener('click',()=>{
    state.sidebarFooterExpanded=!state.sidebarFooterExpanded;applySidebarFooter();persistUiPreferences();
  });

  document.addEventListener('click',event=>{
    const footer=elements.sidebarFooterToggle?.closest('.friend-sidebar-footer');
    if(state.sidebarFooterExpanded&&footer&&!footer.contains(event.target)){
      state.sidebarFooterExpanded=false;applySidebarFooter();persistUiPreferences();
    }
  });
  elements.sidebarFooterToggle?.closest('.friend-sidebar-footer')?.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!event.isComposing&&state.sidebarFooterExpanded){
      event.preventDefault();state.sidebarFooterExpanded=false;applySidebarFooter();persistUiPreferences();elements.sidebarFooterToggle.focus({preventScroll:true});
    }
  });

  function applySidebarMode() {
    applySidebarFooter();
    const mode = ['normal', 'location', 'hidden'].includes(state.sidebarMode)
      ? state.sidebarMode
      : 'normal';
    state.sidebarMode = mode;
    const hidden = mode === 'hidden';
    const location = mode === 'location';
    document.body.classList.toggle('sidebar-collapsed', hidden);
    document.body.classList.toggle('sidebar-location-mode', location);
    sidebarResizer.apply();
    if (!elements.sidebarToggle) return;
    elements.sidebarToggle.textContent = hidden ? '›' : location ? '‹' : '»';
    elements.sidebarToggle.setAttribute('aria-expanded', String(!hidden));
    const label = hidden
      ? t('フレンド一覧を表示')
      : location
        ? t('フレンド一覧を隠す')
        : t('今居るインスタンスも表示');
    elements.sidebarToggle.setAttribute('aria-label', label);
    elements.sidebarToggle.title = label;
    elements.sidebarToggle.dataset.sidebarMode = mode;
  }

  function toggleFriendSidebar() {
    state.sidebarMode = state.sidebarMode === 'normal'
      ? 'location'
      : state.sidebarMode === 'location'
        ? 'hidden'
        : 'normal';
    hideFriendInstancePreview({ immediate: true });
    closeFavoriteMenu();
    applySidebarMode();
    renderFriendSidebar();
    persistUiPreferences();
  }

  function positionSettingsPanel() {
    if (!elements.settingsPanel || elements.settingsPanel.classList.contains('hidden')) return;
    const button = elements.settingsButton.getBoundingClientRect();
    const scale = button.width / elements.settingsButton.offsetWidth || 1;
    const margin = 12;
    elements.settingsPanel.style.width = `${Math.min(350, (window.innerWidth - margin * 2) / scale)}px`;
    elements.settingsPanel.style.right = `${margin / scale}px`;
    const top = Math.min(button.bottom + 7 * scale, window.innerHeight - 80);
    elements.settingsPanel.style.top = `${Math.max(margin, top) / scale}px`;
    elements.settingsPanel.style.maxHeight = `${(window.innerHeight - Math.max(margin, top) - margin) / scale}px`;
  }

  function setSettingsAdvanced(expanded) {
    expanded=Boolean(expanded);
    state.settingsAdvancedExpanded=expanded;
    elements.settingsAdvanced.hidden=!expanded;
    elements.settingsMore.setAttribute('aria-expanded',String(expanded));
    elements.settingsMore.textContent=t(expanded?'少なく表示':'さらに表示');
  }

  function setSettingsPanelOpen(open) {
    if (!elements.settingsPanel || !elements.settingsButton) return;
    elements.settingsPanel.classList.toggle('hidden', !open);
    elements.settingsButton.setAttribute('aria-expanded', String(open));
    if (open) {setSettingsAdvanced(state.settingsAdvancedExpanded);elements.settingsPanel.scrollTop=0;setNotificationPanelOpen(false);positionSettingsPanel();}
  }

  function toggleSettingsPanel() {
    const open = elements.settingsPanel?.classList.contains('hidden') !== false;
    setSettingsPanelOpen(open);
  }

  return {
    readUiPreferences,
    persistUiPreferences,
    restoreUiPreferences,
    updateInstanceSizeButtons,
    applyInstanceSize,
    applyInstanceDisplay,
    syncFriendLocationTips,
    updateThemeButtons,
    applyTheme,
    applySidebarMode,
    toggleFriendSidebar,
    positionSettingsPanel,
    setSettingsAdvanced,
    setSettingsPanelOpen,
    toggleSettingsPanel
  };
}
