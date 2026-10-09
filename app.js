import { readFailureMessage } from './ui-feedback.js';
import { WorldCatalog, worldPlatforms, worldIsUnavailable } from './world-catalog.js';
import { fetchRecentWorlds } from './recent-worlds.js';
import { WorldFavorites } from './world-favorites.js';
import { SidebarResizer } from './sidebar-resize.js';
import { t, lt, captureStaticLabels, setLocale, getLocale, relocalize, initialLanguage } from './i18n.js';
import { normalizeSearch, friendSearchText, matchesSearch, activityComparison } from './view-query.js';
import { ActionToast } from './toast.js';
import { patchElement, patchMarkup } from './dom.js';
import { ImagePool, ImageController } from './images.js';
import { formatActivityDateTime, uiText } from './ui-format.js';
import { CONFIG, PERMISSIONS, SORTS, TABS } from './config.js';
import { JsonStorage } from './storage.js';
import { DataRepository, VrchatApiClient } from './api.js';
import { InstanceHydrationController } from './hydration.js';
import {
  buildLocations,
  classifyPermission,
  createFriendLocationMap,
  deriveCanJoin,
  effectiveInstanceUserCount,
  escapeHtml,
  filterAndSortInstances,
  friendIsOnline,
  friendStateText,
  instanceOwnerId,
  mergeInstanceData,
  needsNonFriendOwnerProfile,
  nonFriendOwnerForEntry,
  normalizeFriends,
  normalizeUser,
  onlineStatusInfo,
  permissionBadgeClass,
  permissionLabel,
  participantsForEntry,
  resolveFriendLocation,
  regionLabel,
  sortParticipants,
  uniqueUsers,
  safeImageUrl,
  sizedImageUrl,
} from './domain.js';

const elements = {
  status: document.getElementById('status'),
  statusRow: document.getElementById('statusRow'),
  updatedAt: document.getElementById('updatedAt'),
  sidebarToggle: document.getElementById('sidebarToggle'),
  list: document.getElementById('list'),
  login: document.getElementById('login'),
  loginButton: document.getElementById('loginButton'),
  friendList: document.getElementById('friendList'),
  friendCount: document.getElementById('friendCount'),
  friendSearch: document.getElementById('friendSearch'),
  clearFriendSearch: document.getElementById('clearFriendSearch'),
  friendFilter: document.getElementById('friendFilter'),
  showOnWebsite: document.getElementById('showOnWebsite'),
  showOffline: document.getElementById('showOffline'),
  offlineSearchStatus: document.getElementById('offlineSearchStatus'),
  sort: document.getElementById('sort'),
  offlineSort: document.getElementById('offlineSort'),
  showNonFriendOwners: document.getElementById('showNonFriendOwners'),
  settingsButton: document.getElementById('settingsButton'),
  settingsPanel: document.getElementById('settingsPanel'),
  friendSort: document.getElementById('friendSort'),
  instanceDisplay: document.getElementById('instanceDisplay'),
  autoRefresh: document.getElementById('autoRefresh'),
  reloadButton: document.getElementById('reloadButton'),
  recentButton: document.getElementById('recentButton'),
  clearCacheButton: document.getElementById('clearCacheButton'),
  actionToast: document.getElementById('actionToast'),
  friendInstancePreview: document.getElementById('friendInstancePreview'),
  favoriteMenu: document.getElementById('favoriteMenu'),
};

const uiStorage = new JsonStorage();
let repository = new DataRepository(new VrchatApiClient(), uiStorage);
let worldFavorites = null;
let worldCatalog = new WorldCatalog();
let worldView = { selected: 'recent', loading: false, error: null, token: 0, editor: null };

const VIEW_MODES = Object.freeze({
  INSTANCES: 'instances',
  FRIENDS: 'friends',
  RECENT: 'recent',
});

const FRIEND_VIEW_SORTS = Object.freeze({
  NAME: 'name',
  LOCATION: 'location',
});

// Pass bound cache readers into pure domain code; never hand a repository object
// whose methods would lose their `this` receiver when extracted as callbacks.
const locationCacheReader = Object.freeze({
  getCachedInstance: (location) => repository.getCachedInstance(location),
  getCachedWorld: (worldId) => repository.getCachedWorld(worldId),
});

const state = {
  recent: { account: '', rows: [], ready: false, loading: false, error: null, token: 0 },
  viewMode: VIEW_MODES.INSTANCES,
  tab: TABS.FAVORITE_PLUS,
  sort: SORTS.FRIENDS_DESC,
  friendViewSort: FRIEND_VIEW_SORTS.NAME,
  instanceSize: 'medium',
  instanceDisplay: 'normal',
  friendSort: 'favorite_list',
  offlineSort: 'name',
  showNonFriendOwners: false,
  displayLimits: new Map(),
  theme: 'dark-blue',
  autoRefreshMinutes: 0,
  autoRefreshTimer: null,
  sidebarMode: 'normal',
  user: null,
  favorites: new Set(),
  favoriteRecords: new Map(),
  favoriteGroups: [],
  requestedFriendFilter: 'favorite',
  friends: [],
  onlineFriends: [],
  offlineProfiles: new Map(),
  offlineLoadToken: 0,
  offlineNameLoad: { loading: false, failed: false, loaded: 0, total: 0 },
  favoriteUndo: null,
  friendIndex: new Map(),
  instances: [],
  loading: false,
  loadFailed: false,
  groupLoadFailed: false,
  loadGeneration: 0,
  autoRefreshDueAt: 0,
  favoriteMutationPending: false,
  favoriteGroupEditor: null,
  pendingInvites: new Set(),
  highlight: {
    location: '',
    until: 0,
    timer: null,
    resumeTimer: null,
  },
  dataFromCache: false,
  lastLoadedAt: 0,
  collapsedFriendGroups: new Set(['ungrouped', 'ungrouped-offline']),
  privateCollapsed: true,
  friendPreview: {
    openTimer: null,
    closeTimer: null,
    friendId: '',
    location: '',
    anchor: null,
    pointerX: 0,
    pointerY: 0,
    sidebarSuppressedFriendId: '',
  },
  favoriteMenu: {
    userId: '',
    anchor: null,
    busy: false,
    fromFriendPreview: false,
  },
};

let sidebarHydrationObserver = null;
const sidebarResizer = new SidebarResizer({
  sidebar: document.getElementById('friendSidebar'),
  handle: document.getElementById('sidebarResizer'),
  getMode: () => state.sidebarMode,
  onStart: () => { hideFriendInstancePreview({ immediate: true }); closeFavoriteMenu(); },
  onCommit: () => persistUiPreferences(),
});

function readUiPreferences() {
  const prefs = uiStorage.get(CONFIG.UI_PREFERENCES_KEY, {});
  return prefs && typeof prefs === 'object' && !Array.isArray(prefs) ? prefs : {};
}

function persistUiPreferences() {
  uiStorage.set(CONFIG.UI_PREFERENCES_KEY, {
    language: getLocale(),
    viewMode: state.viewMode,
    tab: state.tab,
    sort: state.sort,
    friendViewSort: state.friendViewSort,
    instanceSize: state.instanceSize,
    instanceDisplay: state.instanceDisplay,
    friendSort: state.friendSort,
    offlineSort: state.offlineSort,
    showNonFriendOwners: state.showNonFriendOwners,
    theme: state.theme,
    autoRefreshMinutes: state.autoRefreshMinutes,
    sidebarWidths: sidebarResizer.preferences(),
    sidebarMode: state.sidebarMode,
    sidebarCollapsed: state.sidebarMode === 'hidden',
    friendFilter: elements.friendFilter?.value || 'all',
    showOnWebsite: elements.showOnWebsite?.checked !== false,
    showOffline: elements.showOffline?.checked === true,
  });
}

function restoreUiPreferences() {
  const prefs = readUiPreferences();
  setLocale(initialLanguage(prefs.language));
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
    : 'dark-blue';
  state.autoRefreshMinutes = [5, 10, 30].includes(Number(prefs.autoRefreshMinutes))
    ? Number(prefs.autoRefreshMinutes)
    : 0;
  state.sidebarMode = ['normal', 'location', 'hidden'].includes(prefs.sidebarMode)
    ? prefs.sidebarMode
    : prefs.sidebarCollapsed === true
      ? 'hidden'
      : 'normal';
  state.offlineSort = ['name', 'recent', 'oldest'].includes(prefs.offlineSort) ? prefs.offlineSort : 'name';
  if (elements.offlineSort) elements.offlineSort.value = state.offlineSort;
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
    : 'dark-blue';
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  document.body.dataset.theme = theme;
  document.documentElement.style.colorScheme = ['light', 'sand', 'mist'].includes(theme) ? 'light' : 'dark';
  updateThemeButtons();
}

function applySidebarMode() {
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
window.addEventListener('resize', positionSettingsPanel);
function setSettingsPanelOpen(open) {
  if (!elements.settingsPanel || !elements.settingsButton) return;
  elements.settingsPanel.classList.toggle('hidden', !open);
  elements.settingsButton.setAttribute('aria-expanded', String(open));
  if (open) positionSettingsPanel();
}

function toggleSettingsPanel() {
  const open = elements.settingsPanel?.classList.contains('hidden') !== false;
  setSettingsPanelOpen(open);
}

function clearAutoRefreshTimer() {
  if (!state.autoRefreshTimer) return;
  clearTimeout(state.autoRefreshTimer);
  state.autoRefreshTimer = null;
}

function scheduleAutoRefresh({ preserveDue = false } = {}) {
  clearAutoRefreshTimer();
  if (![5, 10, 30].includes(state.autoRefreshMinutes)) { state.autoRefreshDueAt = 0; return; }
  if (!preserveDue || !state.autoRefreshDueAt) state.autoRefreshDueAt = Date.now() + state.autoRefreshMinutes * 60000;
  if (document.hidden) return;
  const delayMs = Math.max(0, state.autoRefreshDueAt - Date.now());
  state.autoRefreshTimer = setTimeout(async () => {
    state.autoRefreshTimer = null;
    if (document.hidden) return;
    if (state.loading || state.favoriteMutationPending || state.pendingInvites.size
      || (state.viewMode === VIEW_MODES.FRIENDS && state.favoriteGroupEditor)) {
      state.autoRefreshDueAt = Date.now() + 1000;
      scheduleAutoRefresh({ preserveDue: true });
      return;
    }
    // Anchor the next deadline to this start, not the fetch completion.
    state.autoRefreshDueAt = Date.now() + state.autoRefreshMinutes * 60000;
    await load({ reason: 'automatic' });
    // Preserve any deadline selected while loading (interval/visibility changes).
    scheduleAutoRefresh({ preserveDue: true });
  }, delayMs);
}

function friendMap() {
  return state.friendIndex;
}

function setFriendState(friends) {
  state.friends = Array.isArray(friends) ? friends : [];
  state.friendIndex = new Map(state.friends.map((friend) => [friend.id, friend]));
}

function offlineFriendIds() {
  if (!elements.showOffline?.checked || !state.user || !Array.isArray(state.user.offlineFriends)) return [];
  const online = new Set(state.onlineFriends.map(friend => friend.id));
  for (const id of [...(state.user.onlineFriends || []), ...(state.user.activeFriends || [])]) online.add(id);
  return [...new Set(state.user.offlineFriends)].filter(id => typeof id === 'string' && /^usr_[A-Za-z0-9_-]+$/.test(id) && !online.has(id));
}

function cachedOfflineProfile(id) {
  return !repository.disposed && repository.currentUserId === state.user?.id ? repository.cachedUserProfile(id) : null;
}

function isOfflineUnavailable(id) {
  return !repository.disposed && repository.currentUserId === state.user?.id && repository.isOfflineFriendUnavailable(id);
}

function rebuildDisplayedFriends() {
  const offline = offlineFriendIds().filter(id => !isOfflineUnavailable(id) && hasOfflineName(id)).map(id => {
    const profile = state.offlineProfiles.get(id) || cachedOfflineProfile(id);
    return { ...profile, id, displayName: profile?.displayName || (state.offlineNameLoad.failed ? t('名前を取得できませんでした') : t('ユーザー情報を取得中…')),
      status: 'offline', state: 'offline', platform: '', location: 'offline', travelingToLocation: '', isFriend: true };
  });
  setFriendState([...state.onlineFriends, ...offline]);
}

function renderOfflineSearchStatus() {
  const root = elements.offlineSearchStatus;
  if (!root) return;
  const progress = state.offlineNameLoad;
  root.hidden = !elements.showOffline?.checked || !progress.failed;
  root.classList.toggle('error', progress.failed);
  root.textContent = progress.failed
    ? readFailureMessage('offline')
    : '';
}

async function loadOfflineFriendProfiles() {
  const token = ++state.offlineLoadToken;
  const generation = state.loadGeneration;
  const dataRepository = repository;
  if (!elements.showOffline?.checked || !state.user || state.loading || dataRepository.disposed || document.hidden) return;
  if (!Array.isArray(state.user.offlineFriends)) {
    state.offlineNameLoad = { loading: false, failed: true, loaded: 0, total: 0 };
    renderOfflineSearchStatus();
    return;
  }
  const ids = offlineFriendIds();
  const targets = new Set(ids);
  const unavailable = new Set(ids.filter(id => isOfflineUnavailable(id)));
  const missing = new Set(ids.filter(id => (!hasOfflineName(id) || !dataRepository.hasFreshOfflineActivity(id)) && !unavailable.has(id)));
  const current = () => token === state.offlineLoadToken && generation === state.loadGeneration && !dataRepository.disposed && elements.showOffline?.checked && !document.hidden;
  state.offlineNameLoad = { loading: missing.size > 0, failed: false, loaded: ids.length - missing.size - unavailable.size, total: ids.length, unavailable: unavailable.size };
  renderOfflineSearchStatus();
  if (!missing.size) { rebuildDisplayedFriends(); render({ resetScroll: false }); return; }
  // Metadata pages include names and image URLs, never image bodies. Pagination
  // is independent of folded cards so name searches cover all offline friends.
  // Servers may cap a page below the requested size. Advance by the actual
  // count and finish on an empty page, not on a short page.
  const maxPages = Math.max(100, ids.length + 2);
  const seenIds = new Set();
  let offset = 0, pages = 0, lastCount = 0, stopReason = 'page-limit';
  let fallbackAttempted = 0, fallbackRecovered = 0, fallbackUnavailable = 0, fallbackFailed = 0;
  const fallbackStatuses = {};
  const reportIncomplete = (status = null) => {
    if (missing.size) console.warn('[Viewer] Offline metadata incomplete', {
      total: ids.length, loaded: ids.length - missing.size - unavailable.size, unavailable: unavailable.size, pages, offset,
      lastCount, stopReason, status, fallbackAttempted, fallbackRecovered,
      fallbackUnavailable, fallbackFailed, fallbackStatuses
    });
  };
  try {
    for (let page = 0; page < maxPages && missing.size && current(); page += 1) {
      const rows = await dataRepository.fetchOfflineFriendsPage(offset);
      pages += 1; lastCount = rows.length;
      if (!current()) return;
      const profiles = rows.filter(friend => targets.has(friend?.id) && typeof friend.displayName === 'string' && friend.displayName.trim());
      dataRepository.cacheFriendProfiles(profiles);
      for (const friend of profiles) {
        state.offlineProfiles.set(friend.id, dataRepository.cachedUserProfile(friend.id));
        missing.delete(friend.id); unavailable.delete(friend.id);
      }
      state.offlineNameLoad.unavailable = unavailable.size;
      state.offlineNameLoad.loaded = ids.length - missing.size - unavailable.size;
      rebuildDisplayedFriends();
      render({ resetScroll: false });
      if (!rows.length) { stopReason = 'empty-page'; break; }
      offset += rows.length;
      let newIds = 0;
      for (const row of rows) {
        if (typeof row?.id === 'string' && !seenIds.has(row.id)) {
          seenIds.add(row.id); newIds += 1;
        }
      }
      // Stop a server repeating the same page instead of issuing unbounded requests.
      if (!newIds && missing.size) { stopReason = 'repeated-page'; break; }
    }
    if (!current()) return;
    // Lists and auth IDs are separate snapshots. Only repair a small remainder;
    // never turn a broken bulk response into hundreds of profile requests.
    if (missing.size && missing.size <= CONFIG.OFFLINE_PROFILE_FALLBACK_MAX) {
      for (const id of [...missing]) {
        if (!current()) return;
        fallbackAttempted += 1;
        try {
          const profile = await dataRepository.fetchOfflineFriendProfile(id);
          if (!current()) return;
          state.offlineProfiles.set(id, profile);
          missing.delete(id); fallbackRecovered += 1;
          state.offlineNameLoad.loaded = ids.length - missing.size - unavailable.size;
          rebuildDisplayedFriends(); render({ resetScroll: false });
        } catch (error) {
          if (!current() || error?.name === 'AbortError') return;
          if (error?.status === 401) { handleSessionExpired(); return; }
          const status = String(error?.status ?? 'network');
          fallbackStatuses[status] = (fallbackStatuses[status] || 0) + 1;
          if (error?.status === 404) {
            fallbackUnavailable += 1; unavailable.add(id); missing.delete(id);
            state.offlineNameLoad.unavailable = unavailable.size;
            state.offlineNameLoad.loaded = ids.length - missing.size - unavailable.size;
            rebuildDisplayedFriends(); render({ resetScroll: false });
          } else if (error?.status === 403) fallbackUnavailable += 1;
          else { fallbackFailed += 1; break; }
        }
      }
    }
    if (!current()) return;
    state.offlineNameLoad.loading = false;
    // Confirmed 404 IDs are separate from recoverable missing names; retain
    // their Favorite records without presenting them as accessible friends.
    state.offlineNameLoad.failed = missing.size > 0;
    reportIncomplete();
    rebuildDisplayedFriends();
    render({ resetScroll: false });
  } catch (error) {
    if (!current() || error?.name === 'AbortError') return;
    if (error?.status === 401) { handleSessionExpired(); return; }
    state.offlineNameLoad.loading = false;
    state.offlineNameLoad.failed = true;
    stopReason = 'request-error'; reportIncomplete(error?.status ?? null);
    rebuildDisplayedFriends();
    render({ resetScroll: false });
  }
}

function hasOfflineName(id) {
  const profile = state.offlineProfiles.get(id) || cachedOfflineProfile(id);
  return typeof profile?.displayName === 'string' && Boolean(profile.displayName.trim()) && profile.displayName !== id;
}

function setFavoriteGroupState(groups) {
  state.favoriteGroups = Array.isArray(groups) ? groups.slice(0, 3) : [];
  renderFriendFilterOptions();
}

function applyFavoriteState(favoriteState) {
  state.favorites = favoriteState?.ids instanceof Set ? favoriteState.ids : new Set();
  state.favoriteRecords = favoriteState?.records instanceof Map ? favoriteState.records : new Map();
  setFavoriteGroupState(favoriteState?.groups || []);
  rebuildDisplayedFriends();
}

function favoriteGroupForUser(userId) {
  return state.favoriteGroups.find((group) => group?.memberIds?.has(userId))?.name || '';
}

function renderFavoriteActionButton(userId, extraClass = '') {
  if (!userId || !state.friendIndex.has(userId)) return '';
  const isFavorite = state.favorites.has(userId);
  const label = isFavorite ? t('Favoriteを編集') : t('Favoriteに追加');
  return `<button class="favorite-action-button favorite-badge${isFavorite ? ' is-favorite' : ''}${extraClass ? ` ${extraClass}` : ''}" type="button" data-favorite-user-id="${escapeHtml(userId)}" aria-label="${label}" title="${label}"><span class="favorite-action-symbol" aria-hidden="true">${isFavorite ? '★' : ''}</span></button>`;
}

function renderFriendFilterOptions() {
  if (!elements.friendFilter) return;

  const current = elements.friendFilter.value || state.requestedFriendFilter || 'favorite';
  const groupsByName = new Map(state.favoriteGroups.map((group) => [group.name, group]));
  const groupOptions = ['group_0', 'group_1', 'group_2'].map((name, index) => {
    const group = groupsByName.get(name);
    const label = group?.displayName || `Favorite List ${index + 1}`;
    return `<option value="favorite-group:${escapeHtml(name)}">${escapeHtml(label)}</option>`;
  }).join('');

  elements.friendFilter.innerHTML = lt`
    <option value="all">すべて</option>
    <option value="favorite">Favorite</option>
    ${groupOptions}
    <option value="joinable">Join Friends</option>`;

  const preferred = state.requestedFriendFilter || current;
  const available = [...elements.friendFilter.options].some((option) => option.value === preferred);
  elements.friendFilter.value = available ? preferred : 'favorite';
  state.requestedFriendFilter = elements.friendFilter.value;
}

function getVisibleInstances() {
  return filterAndSortInstances(state.instances, state, friendMap());
}

function setStatus(message, error = false) {
  if (!elements.status) return;
  const text = String(message || '').trim();
  elements.status.textContent = text;
  elements.status.classList.toggle('error', Boolean(error));
  elements.statusRow?.classList.toggle('hidden', !text);
}

const actionToast = new ActionToast(elements.actionToast);
function hideActionToast() { actionToast.dismiss(); state.favoriteUndo = null; }
function showActionToast(message, options = {}) { actionToast.show(message, options); }

function applyMainSortOptions() {
  if (!elements.sort) return;
  elements.sort.hidden = state.viewMode === VIEW_MODES.RECENT;
  if (state.viewMode === VIEW_MODES.FRIENDS) {
    elements.sort.innerHTML = lt`
      <option value="name">名前順</option>
      <option value="location">居場所順</option>`;
    elements.sort.value = Object.values(FRIEND_VIEW_SORTS).includes(state.friendViewSort)
      ? state.friendViewSort
      : FRIEND_VIEW_SORTS.NAME;
    elements.sort.setAttribute('aria-label', t('フレンド表示の並び順'));
  } else {
    elements.sort.innerHTML = lt`
      <option value="friends_desc" title="フレンドが多い順">フレンド順</option>
      <option value="users_desc" title="参加人数が多い順">参加人数順</option>`;
    elements.sort.value = Object.values(SORTS).includes(state.sort)
      ? state.sort
      : SORTS.FRIENDS_DESC;
    elements.sort.setAttribute('aria-label', t('インスタンスの並び順'));
  }
}

function updateTabButtons() {
  elements.recentButton?.classList.toggle('active', state.viewMode === VIEW_MODES.RECENT);
  elements.recentButton?.setAttribute('aria-pressed', String(state.viewMode === VIEW_MODES.RECENT));
  document.querySelectorAll('.tab').forEach((button) => {
    const isFriendView = button.dataset.view === VIEW_MODES.FRIENDS;
    const active = isFriendView
      ? state.viewMode === VIEW_MODES.FRIENDS
      : state.viewMode === VIEW_MODES.INSTANCES && button.dataset.filter === state.tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
}

function instanceIsHighlighted(entry) {
  return Boolean(
    entry?.location
      && state.highlight.location === entry.location
      && Date.now() < state.highlight.until,
  );
}

function clearInstanceHighlight() {
  if (state.highlight.timer) {
    clearTimeout(state.highlight.timer);
    state.highlight.timer = null;
  }
  if (state.highlight.resumeTimer) {
    clearTimeout(state.highlight.resumeTimer);
    state.highlight.resumeTimer = null;
  }
  state.highlight.location = '';
  state.highlight.until = 0;
  document.querySelectorAll('.instance-highlight').forEach((node) => {
    node.classList.remove('instance-highlight');
  });
}

function scheduleHighlightClear(location) {
  state.highlight.timer = setTimeout(() => {
    if (state.highlight.location !== location) return;
    state.highlight.location = '';
    state.highlight.until = 0;
    state.highlight.timer = null;
    // Do not cancel the focus hydration resume timer here. The one-second
    // visual highlight and the post-focus hydration lifecycle are independent.
    // Cancelling resume here leaves the observer disconnected after a friend
    // click, which prevents thumbnails from loading when the user scrolls.
    document.querySelectorAll('.instance-highlight').forEach((node) => {
      node.classList.remove('instance-highlight');
    });
  }, 1000);
}

function friendSortName(friend) {
  return String(friend?.displayName || friend?.username || friend?.id || '');
}

function compareFriendNames(a, b) {
  return friendSortName(a).localeCompare(friendSortName(b), 'ja');
}

function compareOfflineFriends(a, b) {
  if (state.offlineSort === 'name') return 0;
  const onlineA = friendIsOnline(a), onlineB = friendIsOnline(b);
  if (onlineA !== onlineB) return onlineA ? -1 : 1;
  if (onlineA) return 0;
  return activityComparison(a, b, state.offlineSort);
}
function limitedMarkup(rows, key, renderer) {
  const limit = state.displayLimits.get(key) || CONFIG.DISPLAY_BATCH_SIZE;
  const markup = rows.slice(0, limit).map(renderer).join('');
  return markup + (rows.length > limit ? lt`<button type="button" class="load-more" data-load-more="${escapeHtml(key)}">さらに${Math.min(CONFIG.DISPLAY_BATCH_SIZE, rows.length - limit)}人表示（${limit} / ${rows.length}）</button>` : '');
}
function resetDisplayLimits() { state.displayLimits.clear(); }
function getFriendSidebarRows() {
  const filter = elements.friendFilter?.value || 'all';
  const query = normalizeSearch(elements.friendSearch?.value);

  const filtered = state.friends.filter((friend) => {
    if (!friendIsOnline(friend) && !elements.showOffline?.checked) return false;
    if (!elements.showOnWebsite?.checked && onlineStatusInfo(friend).className === 'online-website') {
      return false;
    }

    if (filter.startsWith('favorite-group:')) {
      const groupName = filter.slice('favorite-group:'.length);
      const group = state.favoriteGroups.find((candidate) => candidate.name === groupName);
      if (!group?.memberIds?.has(friend.id)) return false;
    } else {
      switch (filter) {
        case 'favorite':
          if (!state.favorites.has(friend.id)) return false;
          break;
        case 'joinable':
          if (!deriveCanJoin(friend)) return false;
          break;
        default:
          break;
      }
    }

    if (!query) return true;
    return matchesSearch(friendSearchText(friend), query);
  });

  if (state.friendSort === 'favorite_list') {
    const groupsByName = new Map(state.favoriteGroups.map((group) => [group.name, group]));
    const orderedGroups = ['group_0', 'group_1', 'group_2']
      .map((name) => groupsByName.get(name))
      .filter(Boolean);

    const favoriteListRank = (friend) => {
      for (let index = 0; index < orderedGroups.length; index += 1) {
        if (orderedGroups[index]?.memberIds?.has(friend.id)) return index;
      }
      return orderedGroups.length;
    };

    return filtered.sort((a, b) => {
      const rankDifference = favoriteListRank(a) - favoriteListRank(b);
      if (rankDifference) return rankDifference;
      return compareOfflineFriends(a, b) || compareFriendNames(a, b);
    });
  }

  if (filter === 'all' || filter === 'joinable') {
    return filtered.sort((a, b) => {
      const favoriteDifference = Number(state.favorites.has(b.id)) - Number(state.favorites.has(a.id));
      if (favoriteDifference) return favoriteDifference;
      return compareOfflineFriends(a, b) || compareFriendNames(a, b);
    });
  }

  return filtered.sort((a, b) => compareOfflineFriends(a, b) || compareFriendNames(a, b));
}

const imageFallbacks = new Map();
function displayImageUrl(rawUrl, kind = 'avatar') {
  const original = safeImageUrl(rawUrl);
  const sized = sizedImageUrl(original, kind === 'world' ? CONFIG.WORLD_IMAGE_SIZE : CONFIG.USER_IMAGE_SIZE);
  if (sized !== original) {
    if (imageFallbacks.size >= 2000) imageFallbacks.delete(imageFallbacks.keys().next().value);
    imageFallbacks.set(sized, original);
  }
  return sized;
}

const imagePool = new ImagePool({ fallbackFor: url => imageFallbacks.get(url) || '', concurrency: CONFIG.IMAGE_CONCURRENCY,
  timeoutMs: CONFIG.IMAGE_TIMEOUT_MS, minIntervalMs: CONFIG.IMAGE_MIN_INTERVAL_MS });
const imageController = new ImageController(imagePool);

function friendAvatarUrl(friend) {
  return displayImageUrl(
    friend.profilePicOverride
      || friend.currentAvatarThumbnailImageUrl
      || friend.userIcon
      || friend.iconUrl
      || '',
  );
}

function renderFriendSidebarLocationThumbnail(friend) {
  const status = onlineStatusInfo(friend);
  const location = resolveFriendLocation(friend);
  const entry = reverseEntryForFriend(friend);
  const permission = entry?.permission || classifyPermission(location);
  const isWebsite = status.className === 'online-website';
  const isPrivate = permission === PERMISSIONS.PRIVATE || location === 'private';
  const permissionClass = permissionBadgeClass(permission);

  const worldName = friendLocationLabel(friend, entry);
  const groupName = entry?.groupName || entry?.instanceData?.group?.name || entry?.instanceData?.groupName || '';
  const locationTitle = groupName ? `${worldName} / ${groupName}` : worldName;

  let countText = '';
  if (entry && !isPrivate && !isWebsite) {
    const userCount = effectiveInstanceUserCount(entry, friendMap());
    const capacity = entry.world?.capacity ?? entry.capacity ?? entry.world?.hardCapacity;
    const friendCount = uniqueUsers(entry.friends).length;
    countText = `${friendCount}/${userCount}/${Number.isFinite(capacity) ? capacity : '-'}`;
  }

  const thumb = entry && !isPrivate && !isWebsite
    ? displayImageUrl(entry.world?.thumbnailImageUrl || entry.instanceData?.world?.thumbnailImageUrl || entry.instanceData?.world?.imageUrl || '', 'world')
    : '';
  const thumbContent = thumb
    ? `<img class="friend-sidebar-location-thumb-image" data-image-src="${escapeHtml(thumb)}" loading="lazy" decoding="async" alt="">`
    : `<div class="friend-sidebar-location-thumb-placeholder friend-location-thumb-placeholder">${renderFriendLocationPlaceholderIcon({ isPrivate, isWebsite })}</div>`;
  const statusText = isWebsite
    ? 'OtherPlatform'
    : isPrivate
      ? 'Private'
      : permissionLabel(permission);

  return `
    <div class="friend-sidebar-location-thumb" title="${escapeHtml(locationTitle)}">
      ${thumbContent}
      <div class="friend-sidebar-location-meta">
        <span class="friend-state friend-sidebar-location-status ${permissionClass}">${escapeHtml(statusText)}</span>
        ${countText ? lt`<span class="friend-sidebar-location-count" title="フレンド数 / 参加人数 / 最大人数">${escapeHtml(countText)}</span>` : ''}
      </div>
      <div class="friend-sidebar-location-title">${escapeHtml(locationTitle)}</div>
    </div>`;
}

function renderFriendSidebarItem(friend) {
  const name = friend.displayName || friend.username || friend.id;
  const status = onlineStatusInfo(friend);
  const location = resolveFriendLocation(friend);
  const entry = reverseEntryForFriend(friend);
  const permission = entry?.permission || classifyPermission(location);
  const isWebsite = status.className === 'online-website';
  const isPrivate = permission === PERMISSIONS.PRIVATE || location === 'private';
  const avatarUrl = friendAvatarUrl(friend);
  const avatar = avatarUrl
    ? `<img class="friend-avatar" data-image-src="${escapeHtml(avatarUrl)}" loading="lazy" decoding="async" alt="">`
    : '<div class="friend-avatar"></div>';
  const showLocation = state.sidebarMode === 'location';
  const locationData = !isWebsite && !isPrivate && location && location !== 'offline'
    ? ` data-location="${escapeHtml(entry?.location || location)}"`
    : '';
  const loadingClass = showLocation && entry && needsHydration(entry)
    ? ' friend-sidebar-location-loading'
    : '';
  const noPreviewClass = !friendIsOnline(friend) || isWebsite || isPrivate ? ' friend-sidebar-no-preview' : '';

  return `
    <div class="friend-item${loadingClass}${noPreviewClass}${!friendIsOnline(friend) ? ' friend-offline' : ''}" data-friend-id="${escapeHtml(friend.id)}"${locationData} tabindex="0" role="button" aria-label="${escapeHtml(name)}">
      <div class="friend-avatar-wrap">
        ${avatar}
        ${renderFavoriteActionButton(friend.id)}
      </div>
      <div class="friend-copy">
        <div class="friend-name">
          <span class="online-dot ${status.className}" title="${escapeHtml(status.label)}" aria-label="${escapeHtml(status.label)}">●</span>
          <span class="friend-name-text" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
        </div>
        <div class="friend-state ${permissionBadgeClass(permission)}">${escapeHtml(friendStateText(friend))}</div>
      </div>
      ${showLocation ? renderFriendSidebarLocationThumbnail(friend) : ''}
    </div>`;
}

function disconnectSidebarHydrationObserver() {
  sidebarHydrationObserver?.disconnect();
  sidebarHydrationObserver = null;
}

function syncSidebarHydration() {
  disconnectSidebarHydrationObserver();
  if (document.hidden || state.sidebarMode !== 'location' || !elements.friendList) return;

  const cards = [...elements.friendList.querySelectorAll('.friend-item[data-location]')];
  if (!cards.length) return;

  const queueCard = (card) => {
    const location = card?.dataset?.location || '';
    if (!location) return;
    const entry = getCurrentInstanceEntry(location);
    if (entry && needsHydration(entry)) hydrationController.enqueue(entry);
  };

  cards.slice(0, Math.min(CONFIG.INITIAL_HYDRATE_COUNT, cards.length)).forEach(queueCard);

  if ('IntersectionObserver' in window) {
    sidebarHydrationObserver = new IntersectionObserver((items) => {
      for (const item of items) {
        if (!item.isIntersecting) continue;
        queueCard(item.target);
        sidebarHydrationObserver?.unobserve(item.target);
      }
    }, {
      root: elements.friendList,
      rootMargin: `${Math.min(CONFIG.HYDRATE_PRELOAD_PX, 320)}px 0px`,
      threshold: 0.01,
    });
    cards.forEach((card) => sidebarHydrationObserver.observe(card));
  }

  const rootRect = elements.friendList.getBoundingClientRect();
  const preload = Math.min(CONFIG.HYDRATE_PRELOAD_PX, 320);
  const preloadTop = rootRect.top - preload;
  const preloadBottom = rootRect.bottom + preload;
  cards.forEach((card) => {
    const rect = card.getBoundingClientRect();
    if (rect.top <= preloadBottom && rect.bottom >= preloadTop) queueCard(card);
  });
}

let sidebarSyncPending = false;
function scheduleSidebarHydrationSync() {
  if (sidebarSyncPending) return;
  sidebarSyncPending = true;
  queueMicrotask(() => { sidebarSyncPending = false; syncSidebarHydration(); });
}

function renderFriendSidebar() {
  renderOfflineSearchStatus();
  if (!elements.friendList || !elements.friendCount) return;
  disconnectSidebarHydrationObserver();
  const previousScroll = elements.friendList.scrollTop;
  const rows = getFriendSidebarRows();

  const visibleCount = rows.length;
  const onlineFriendCount = state.onlineFriends.length;
  const offlineCount = state.friends.length - onlineFriendCount;
  const totalCount = onlineFriendCount + offlineCount;
  elements.friendCount.textContent = `${visibleCount} / ${totalCount}`;
  elements.friendCount.setAttribute(
    'aria-label',
    lt`該当 ${visibleCount}人 / オンライン ${onlineFriendCount}人・Offline ${offlineCount}人`,
  );
  elements.friendCount.title = lt`該当人数 / 表示対象総数（オンライン ${onlineFriendCount}人・Offline ${offlineCount}人）`;
  patchMarkup(elements.friendList, limitedMarkup(rows, 'sidebar', renderFriendSidebarItem));
  if (state.friendPreview.anchor?.classList.contains('friend-item')) validateFriendInstancePreview();
  elements.friendList.scrollTop = previousScroll;
  scheduleSidebarHydrationSync();
}

function replaceSidebarLocationCardsInDom(entry) {
  if (!entry?.location || state.sidebarMode !== 'location' || !elements.friendList) return;
  const nodes = [...elements.friendList.querySelectorAll('.friend-item[data-location]')]
    .filter((node) => node.dataset.location === entry.location);
  if (!nodes.length) return;

  const scrollTop = elements.friendList.scrollTop;
  nodes.forEach((node) => {
    const friend = state.friendIndex.get(node.dataset.friendId);
    if (!friend) return;
    const template = document.createElement('template');
    template.innerHTML = renderFriendSidebarItem(friend).trim();
    const replacement = template.content.firstElementChild;
    if (replacement) patchElement(node, replacement);
  });
  elements.friendList.scrollTop = scrollTop;
  scheduleSidebarHydrationSync();
}

function setActiveTab(tab, { resetScroll = true } = {}) {
  state.viewMode = VIEW_MODES.INSTANCES;
  state.tab = Object.values(TABS).includes(tab) ? tab : TABS.FAVORITE_PLUS;
  applyMainSortOptions();
  persistUiPreferences();
  updateTabButtons();
  render({ resetScroll });
}

async function loadRecentWorlds({ force = false } = {}) {
  if (!state.user || state.loading || state.favoriteMutationPending) return;
  const recent = state.recent;
  if (recent.loading || (recent.ready && !force)) return;
  const account = state.user.id, generation = state.loadGeneration, token = ++recent.token;
  const api = repository.api;
  const current = () => recent === state.recent && token === recent.token && generation === state.loadGeneration && state.user?.id === account;
  recent.account = account; recent.loading = true; recent.error = null;
  if (state.viewMode === VIEW_MODES.RECENT) render();
  try {
    const rows = await fetchRecentWorlds(api);
    if (!current()) return;
    recent.rows = rows; recent.ready = true;
  } catch (error) {
    if (!current() || error?.name === 'AbortError') return;
    if (error?.status === 401) { handleSessionExpired(); return; }
    console.warn('Could not load recent worlds:', error);
    recent.error = error;
  } finally {
    if (current()) { recent.loading = false; if (state.viewMode === VIEW_MODES.RECENT) render(); }
  }
}

function setRecentView() {
  state.viewMode = VIEW_MODES.RECENT;
  clearInstanceHighlight(); applyMainSortOptions(); persistUiPreferences();
  render({ resetScroll: true }); void loadWorldView();
}

async function loadWorldView({force=false}={}) {
  if(!state.user || state.loading || state.favoriteMutationPending || worldView.loading)return;
  const view=worldView, store=worldFavorites, catalog=worldCatalog, api=repository.api;
  const generation=state.loadGeneration, account=state.user.id, token=++view.token;
  const current=()=>view===worldView && token===view.token && generation===state.loadGeneration && state.user?.id===account && store===worldFavorites;
  view.loading=true; view.error=null; render();
  try {
    if(store){
      try{await store.load(force)}catch(error){
        if(view.selected!=='recent' || error?.status===401 || error?.name==='AbortError')throw error;
        // Recent remains usable if the independent Favorite metadata read fails.
      }
    }
    if(!current())return;
    if(view.selected==='recent'){
      view.loading=false;
      await loadRecentWorlds({force});
      return;
    }
    if(!store?.groups.some(g=>g.key===view.selected)){view.selected='recent';view.loading=false;await loadRecentWorlds({force});return}
    let paintQueued=false;
    const onProgress=()=>{
      if(!current() || state.viewMode!==VIEW_MODES.RECENT || paintQueued)return;
      paintQueued=true;
      requestAnimationFrame(()=>{paintQueued=false;if(current() && state.viewMode===VIEW_MODES.RECENT)paintWorldProgress()});
    };
    await catalog.load(store.members(view.selected),api,{force,group:store.groups.find(g=>g.key===view.selected),
      current:()=>catalog===worldCatalog && generation===state.loadGeneration && state.user?.id===account,
      shouldContinue:()=>current() && state.viewMode===VIEW_MODES.RECENT,onProgress});
  }catch(error){
    if(!current() || error?.name==='AbortError')return;
    if(error?.status===401){handleSessionExpired();return}
    view.error=error;
  }finally{if(current()){view.loading=false;if(state.viewMode===VIEW_MODES.RECENT)paintWorldProgress();else render({resetScroll:false})}}
}
function paintWorldProgress(){
  updateReloadButton();
  const section=elements.list.querySelector('.recent-worlds');if(!section)return;
  const template=document.createElement('template');template.innerHTML=renderRecentWorlds();
  patchElement(section,template.content.firstElementChild);
}
function renderRecentWorlds() {
  const recent=state.recent, groups=worldFavorites?.groups||[], selected=worldView.selected;
  const group=groups.find(g=>g.key===selected), isRecent=selected==='recent';
  const rows=isRecent?recent.rows:(worldFavorites?.members(selected)||[]).map(id=>worldCatalog.worlds.get(id)||{id,pending:worldView.loading,unavailable:!worldView.loading});
  const notice=worldView.loading?t('ワールドを読み込み中…'):worldView.error?readFailureMessage('worlds',worldView.error)
    :isRecent?(recent.loading?t('訪問ワールドを読み込み中…'):recent.error?readFailureMessage('recent',recent.error):recent.ready&&!rows.length?t('最近訪問したワールドはありません。'):'')
    :!rows.length?t('このリストにはワールドがありません。'):'';
  const editor=worldView.editor;
  const edit=editor&&editor.key===selected?`<form class="world-list-editor" data-world-list-editor aria-busy="${editor.saving}"><label>${escapeHtml(t('リスト名'))} <input class="world-list-name" maxlength="20" value="${escapeHtml(editor.draft)}"${editor.saving?' disabled':''}></label><span class="world-name-count">${editor.draft.length} / 20</span><button type="submit"${editor.saving||editor.unknown?' disabled':''}>${escapeHtml(t('保存'))}</button><button type="button" data-world-edit-cancel${editor.saving?' disabled':''}>${escapeHtml(t('キャンセル'))}</button><div role="status">${escapeHtml(editor.saving?t('リスト名を保存しています(少し時間が掛かります)…'):editor.error?t(editor.error):'')}</div></form>`:'';
  return `<section class="recent-worlds" aria-label="${escapeHtml(t('ワールド管理'))}"><div class="world-tabs" role="tablist" aria-label="${escapeHtml(t('ワールドリスト'))}">
    <button type="button" role="tab" aria-selected="${isRecent}" data-world-tab="recent">${escapeHtml(t('足跡'))}</button>${groups.map((g,i)=>`<button type="button" role="tab" aria-selected="${g.key===selected}" data-world-tab="${escapeHtml(g.key)}" title="${escapeHtml(g.label)}">★${i+1} ${escapeHtml(g.label)} <span class="world-list-count">(${worldFavorites.members(g.key).length})</span></button>`).join('')}</div>
    ${group?`<div class="world-list-heading"><h2>${escapeHtml(group.label)}</h2><button type="button" data-world-edit title="${escapeHtml(t('リスト名を変更'))}" aria-label="${escapeHtml(t('リスト名を変更'))}"${state.favoriteMutationPending?' disabled':''}><svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m4 13 9-9 3 3-9 9-4 1zM11 6l3 3"/></svg></button></div>`:`<h2>${escapeHtml(t('足跡'))}</h2>`}${edit}
    <div class="recent-notice" role="status">${escapeHtml(notice)}</div><div class="recent-world-grid">${rows.map(world=>{
      const unavailable=worldIsUnavailable(world);
      const thumb=unavailable?'':displayImageUrl(world.thumbnailImageUrl||world.imageUrl||'','world'), platforms=unavailable?null:worldPlatforms(world), name=unavailable?t('情報取得不可'):world.name||t('ワールド情報を取得中…');
      const placeholder=unavailable?`<div class="thumb thumb-placeholder world-unavailable"><span class="world-unavailable-icon" aria-hidden="true">⌕</span><span>World Currently<br>Unavailable</span></div>`:'<div class="thumb thumb-placeholder"></div>';
      return `<article class="recent-world-card" data-world-id="${escapeHtml(world.id)}"><div class="thumb-wrap has-world-favorite"><a class="world-page-link" href="${escapeHtml(buildWorldUrl({worldId:world.id}))}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(t('ワールドページを開く'))}">${thumb?`<img class="thumb" data-image-src="${escapeHtml(thumb)}" alt="" loading="eager" decoding="async">`:placeholder}</a>${renderWorldFavoriteButton(world.id)}</div>
      <div class="recent-world-name">${escapeHtml(name)}</div><div class="recent-world-author">${escapeHtml(unavailable||world.pending?world.id:world.authorName||t('作者不明'))}</div><div class="world-card-actions"><span class="world-platforms" title="${escapeHtml(t('対応環境'))}">${escapeHtml(platforms?.length?platforms.join(' / '):t('対応環境不明'))}</span><button type="button" class="world-copy" data-copy-url="${escapeHtml(buildWorldUrl({worldId:world.id}))}" title="${escapeHtml(t('ワールドURLをコピー'))}" aria-label="${escapeHtml(t('ワールドURLをコピー'))}"><svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="6" y="6" width="11" height="11" rx="1.5"/><path d="M13 6V3H3v10h3"/></svg></button></div></article>`;
    }).join('')}</div></section>`;
}
async function saveWorldListName(event) {
  if(!event.target.matches('[data-world-list-editor]'))return;
  event.preventDefault();const editor=worldView.editor,store=worldFavorites,view=worldView;
  if(!editor || editor.saving || editor.unknown || state.loading || state.favoriteMutationPending)return;
  const name=editor.draft.trim();
  if(!name || name.length>20 || /[\r\n\u0000]/.test(name)){editor.error='グループ名は20文字以内で入力してください。';render();return}
  editor.saving=true;editor.error='';state.favoriteMutationPending=true;
  event.target.querySelectorAll('button,input').forEach(control=>{control.disabled=true});
  actionToast.setUndoBusy(true);render({resetScroll:false});
  showActionToast(t('リスト名を保存しています(少し時間が掛かります)…'),{delay:0});
  try {
    await store.rename(editor.key,name,editor.label);
    if(view!==worldView || store!==worldFavorites)return;
    view.editor=null;showActionToast(t('リスト名を変更しました。'));
  }catch(error){
    if(view!==worldView || store!==worldFavorites)return;
    if(error?.status===401){handleSessionExpired();return}
    editor.unknown=Boolean(error?.outcomeUnknown);
    editor.error=editor.unknown?'変更結果を確認できませんでした。「更新」で名前を確認してください。':error?.favoriteConflict?'Favoriteが別の画面で変更されたため、操作を中止しました。':'リスト名を変更できませんでした。';
    showActionToast(t(editor.error),{error:true,delay:5600});
  }finally{if(view===worldView){editor.saving=false;state.favoriteMutationPending=false;actionToast.setUndoBusy(false);render({resetScroll:false})}}
}
function onWorldViewClick(event) {
  const tab=event.target.closest('[data-world-tab]');
  if(tab && !state.favoriteMutationPending && !state.loading){worldView.selected=tab.dataset.worldTab;worldView.editor=null;worldView.token++;worldView.loading=false;render({resetScroll:true});void loadWorldView();elements.list.querySelector(`[data-world-tab="${CSS.escape(worldView.selected)}"]`)?.scrollIntoView({block:'nearest',inline:'nearest'});return}
  if(event.target.closest('[data-world-edit]') && !state.favoriteMutationPending){
    const group=worldFavorites?.groups.find(g=>g.key===worldView.selected);if(!group)return;
    worldView.editor=worldView.editor?null:{key:group.key,label:group.label,draft:group.label,saving:false,error:'',unknown:false};render();elements.list.querySelector('.world-list-name')?.focus();return;
  }
  if(event.target.closest('[data-world-edit-cancel]') && !worldView.editor?.saving){worldView.editor=null;render();return}
  const copy=event.target.closest('[data-copy-url]');
  if(copy){void navigator.clipboard.writeText(copy.dataset.copyUrl).then(()=>showActionToast(t('URLをコピーしました。'))).catch(()=>showActionToast(t('URLをコピーできませんでした。'),{error:true}));}
}

function setFriendView({ resetScroll = true } = {}) {
  state.viewMode = VIEW_MODES.FRIENDS;
  clearInstanceHighlight();
  applyMainSortOptions();
  persistUiPreferences();
  updateTabButtons();
  render({ resetScroll });
}

function reverseEntryForFriend(friend) {
  const location = resolveFriendLocation(friend);
  if (!location || location === 'offline') return null;
  return state.instances.find((entry) => entry.location === location) || null;
}

function friendLocationLabel(friend, entry = reverseEntryForFriend(friend)) {
  const status = onlineStatusInfo(friend);
  if (!friendIsOnline(friend)) return 'Offline';
  if (status.className === 'online-website') return 'OtherPlatform';
  const location = resolveFriendLocation(friend);
  const permission = entry?.permission || classifyPermission(location);
  if (permission === PERMISSIONS.PRIVATE || location === 'private') return 'Private';
  const worldName = entry?.world?.name || entry?.instanceData?.world?.name || '';
  if (worldName) return worldName;
  if (entry?.instanceFetchFailed || entry?.worldFetchFailed) return t('情報取得不可');
  if (entry?.worldId && entry.worldId !== 'offline' && entry.worldId !== 'private') return t('ワールド情報を取得中…');
  return permissionLabel(permission);
}

function friendLocationSortKey(friend) {
  const entry = reverseEntryForFriend(friend);
  const status = onlineStatusInfo(friend);
  const location = resolveFriendLocation(friend);
  const permission = entry?.permission || classifyPermission(location);

  // Instances, Private, OtherPlatform, then Offline.
  if (!friendIsOnline(friend)) return '3\u0000Offline';
  if (status.className === 'online-website') {
    return '2\u0000OtherPlatform';
  }
  if (permission === PERMISSIONS.PRIVATE || location === 'private') {
    return '1\u0000Private';
  }

  const label = friendLocationLabel(friend, entry);
  return `0\u0000${label}\u0000${location}`;
}

function sortReverseFriends(friends) {
  const rows = [...(friends || [])];
  if (state.friendViewSort === FRIEND_VIEW_SORTS.LOCATION) {
    return rows.sort((a, b) => friendLocationSortKey(a).localeCompare(friendLocationSortKey(b), 'ja') || compareOfflineFriends(a, b) || compareFriendNames(a, b));
  }
  return rows.sort((a, b) => compareOfflineFriends(a, b) || compareFriendNames(a, b));
}

function getReverseFriendGroups() {
  const showOtherPlatform = elements.showOnWebsite?.checked !== false;
  const onlineFriends = state.friends.filter((friend) => {
    if (!friendIsOnline(friend) && !elements.showOffline?.checked) return false;
    if (!showOtherPlatform && onlineStatusInfo(friend).className === 'online-website') return false;
    return true;
  });
  const groupsByName = new Map(state.favoriteGroups.map((group) => [group.name, group]));
  const ordered = ['group_0', 'group_1', 'group_2'].map((name, index) => {
    const group = groupsByName.get(name);
    return {
      id: name,
      label: group?.displayName || `Favorite List ${index + 1}`,
      memberIds: group?.memberIds instanceof Set ? group.memberIds : new Set(),
      friends: [],
    };
  });
  const ungrouped = { id: 'ungrouped', label: t('その他'), memberIds: new Set(), friends: [] };

  // A friend can theoretically appear in more than one Favorite List. To keep
  // the reverse view duplicate-free, use the first/highest Favorite List just
  // like the existing Favorite List sort does.
  for (const friend of onlineFriends) {
    const group = ordered.find((candidate) => candidate.memberIds.has(friend.id));
    (group || ungrouped).friends.push(friend);
  }

  const sections = [...ordered, ungrouped];
  sections.forEach((section) => { section.friends = sortReverseFriends(section.friends); });
  return sections;
}

function renderFriendLocationPlaceholderIcon({ isPrivate = false, isWebsite = false } = {}) {
  if (isPrivate) {
    return `<svg class="friend-location-placeholder-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="5" y="10" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
      <path d="M8 10V7.5a4 4 0 0 1 8 0V10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
  }
  if (isWebsite) {
    return `<svg class="friend-location-placeholder-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>
      <path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9S14.5 18.5 12 21M12 3C9.5 5.5 8.2 8.5 8.2 12S9.5 18.5 12 21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
    </svg>`;
  }
  return '<span class="friend-location-placeholder-ellipsis" aria-hidden="true">…</span>';
}

function renderFriendLocationItem(friend) {
  if (!friend) return '';
  const name = friend.displayName || friend.username || friend.id;
  const status = onlineStatusInfo(friend);
  const location = resolveFriendLocation(friend);
  const entry = reverseEntryForFriend(friend);
  const permission = entry?.permission || classifyPermission(location);
  const isWebsite = status.className === 'online-website';
  const isPrivate = permission === PERMISSIONS.PRIVATE || location === 'private';
  const avatarUrl = friendAvatarUrl(friend);
  const avatar = avatarUrl
    ? `<img class="friend-location-avatar" data-image-src="${escapeHtml(avatarUrl)}" loading="lazy" decoding="async" alt="${escapeHtml(name)}">`
    : '<div class="friend-location-avatar friend-location-avatar-empty"></div>';
  const profileUrl = CONFIG.DEBUG_MODE ? '' : buildUserProfileUrl(friend.id);
  const avatarContent = profileUrl
    ? lt`<a class="friend-location-profile-link" href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener noreferrer" title="VRChat公式プロフィールを開く">${avatar}</a>`
    : avatar;

  const worldName = friendLocationLabel(friend, entry);
  const groupName = entry?.groupName || entry?.instanceData?.group?.name || entry?.instanceData?.groupName || '';
  const launchUrl = entry && !isPrivate && !isWebsite ? buildInstanceLaunchUrl(entry) : '';
  const worldUrl = entry && !isPrivate && !isWebsite ? buildWorldUrl(entry) : '';
  const permissionClass = permissionBadgeClass(permission);
  const region = entry?.region ? regionLabel(entry.region) : '';
  const locationTitle = groupName ? `${worldName} / ${groupName}` : worldName;

  let countText = '';
  if (entry && !isPrivate && !isWebsite) {
    const userCount = effectiveInstanceUserCount(entry, friendMap());
    const capacity = entry.world?.capacity ?? entry.capacity ?? entry.world?.hardCapacity;
    const friendCount = uniqueUsers(entry.friends).length;
    countText = `${friendCount}/${userCount}/${Number.isFinite(capacity) ? capacity : '-'}`;
  }

  const thumb = entry && !isPrivate && !isWebsite
    ? displayImageUrl(entry.world?.thumbnailImageUrl || entry.instanceData?.world?.thumbnailImageUrl || entry.instanceData?.world?.imageUrl || '', 'world')
    : '';
  const thumbContent = thumb
    ? `<img class="friend-location-thumb" data-image-src="${escapeHtml(thumb)}" loading="lazy" decoding="async" alt="">`
    : `<div class="friend-location-thumb friend-location-thumb-placeholder">${renderFriendLocationPlaceholderIcon({ isPrivate, isWebsite })}</div>`;
  const simpleStatusText = isWebsite
    ? 'OtherPlatform'
    : isPrivate
      ? 'Private'
      : permissionLabel(permission);
  const simpleCountText = !isWebsite && !isPrivate && countText ? countText : '';
  const thumbOverlay = `
    <div class="friend-location-thumb-simple-meta">
      <span class="friend-state friend-location-thumb-simple-status ${permissionClass}">${escapeHtml(simpleStatusText)}</span>
      ${simpleCountText ? lt`<span class="friend-location-thumb-simple-count" title="フレンド数 / 参加人数 / 最大人数">${escapeHtml(simpleCountText)}</span>` : ''}
    </div>
    <div class="friend-location-thumb-simple-title" title="${escapeHtml(locationTitle)}">${escapeHtml(locationTitle)}</div>`;
  const thumbWrapped = worldUrl
    ? lt`<a class="friend-location-thumb-link" href="${escapeHtml(worldUrl)}" target="_blank" rel="noopener noreferrer" title="ワールドページを開く">${thumbContent}${thumbOverlay}</a>`
    : `<div class="friend-location-thumb-link">${thumbContent}${thumbOverlay}</div>`;

  const locationMeta = isWebsite
    ? `<span class="friend-state friend-location-permission ${permissionClass}">OtherPlatform</span>`
    : isPrivate
      ? `<span class="friend-state friend-location-permission ${permissionClass}">Private</span>`
      : `<span class="friend-state friend-location-permission ${permissionClass}">${escapeHtml(permissionLabel(permission))}</span>${region ? `<span class="friend-location-region">${escapeHtml(region)}</span>` : ''}${countText ? lt`<span class="friend-location-count" title="フレンド数 / 参加人数 / 最大人数">${escapeHtml(countText)}</span>` : ''}`;

  const lastActivityText = !friendIsOnline(friend) ? formatActivityDateTime(friend.last_activity) : '';
  const lastActivity = lastActivityText
    ? `<time class="friend-location-last-activity" datetime="${escapeHtml(friend.last_activity)}" title="${escapeHtml(uiText('lastActivity'))}">${escapeHtml(lastActivityText)}</time>`
    : '';

  const locationName = launchUrl
    ? lt`<a class="friend-location-world-link" href="${escapeHtml(launchUrl)}" target="_blank" rel="noopener noreferrer" title="VRChat公式Launchページを開く">${escapeHtml(locationTitle)}</a>`
    : `<span class="friend-location-world-name" title="${escapeHtml(locationTitle)}">${escapeHtml(locationTitle)}</span>`;

  const locationData = entry?.location && !isPrivate ? ` data-location="${escapeHtml(entry.location)}"` : '';
  const previewDisabledClass = !friendIsOnline(friend) || isPrivate || isWebsite ? ' friend-location-no-preview' : '';
  return `
    <article class="friend-location-item${!friendIsOnline(friend) ? ' friend-offline' : ''}${entry && needsHydration(entry) ? ' friend-location-loading' : ''}${previewDisabledClass}" data-friend-id="${escapeHtml(friend.id)}"${locationData}>
      <div class="friend-location-avatar-wrap">
        ${avatarContent}
        <span class="online-dot ${status.className} friend-location-online-dot" title="${escapeHtml(status.label)}" aria-label="${escapeHtml(status.label)}">●</span>
        ${renderFavoriteActionButton(friend.id, 'friend-location-favorite')}
      </div>
      <div class="friend-location-copy">
        <div class="friend-location-name-line">
          ${profileUrl ? `<a class="friend-location-name" href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(name)}</a>` : `<span class="friend-location-name">${escapeHtml(name)}</span>`}
        </div>
        <div class="friend-location-world-line">${locationName}${lastActivity}</div>
        <div class="friend-location-meta">${locationMeta}</div>
      </div>
      ${thumbWrapped}
    </article>`;
}

function renderFavoriteGroupEditor(group) {
  const editor = state.favoriteGroupEditor;
  if (editor?.groupName !== group.id) return '';
  const disabled = editor.saving ? ' disabled' : '';
  return lt`<form class="favorite-group-editor" data-group-editor="${escapeHtml(group.id)}">
    <label class="favorite-group-editor-label">グループ名
      <input class="favorite-group-name-input" name="displayName" type="text" autocomplete="off"
        aria-label="Favoriteグループ名" maxlength="${CONFIG.FAVORITE_GROUP_NAME_MAX_LENGTH}" aria-describedby="favorite-group-name-help" value="${escapeHtml(editor.draft)}" required${disabled}>
    </label>
    <div class="favorite-group-editor-actions">
      <span class="favorite-group-name-count">${editor.draft.length} / ${CONFIG.FAVORITE_GROUP_NAME_MAX_LENGTH}</span>
      <button class="favorite-group-save" type="submit"${editor.saving || editor.outcomeUnknown ? ' disabled' : ''}>保存</button>
      <button class="favorite-group-cancel" type="button" data-group-edit-cancel${disabled}>キャンセル</button>
    </div>
    <p class="favorite-group-save-status" role="status"${editor.saving ? '' : ' hidden'}>${editor.saving ? escapeHtml(t('リスト名を保存しています(少し時間が掛かります)…')) : ''}</p>
    <p class="favorite-group-editor-help" id="favorite-group-name-help">最大20文字。一部の絵文字は2文字分として数えます。</p>
    <p class="favorite-group-editor-error" role="alert"${editor.error ? '' : ' hidden'}>${escapeHtml(editor.error || '')}</p>
  </form>`;
}

function renderFriendLocationView() {
  const groups = getReverseFriendGroups();
  const sections = groups.map((group, index) => {
    const isFavoriteGroup = index < 3;
    const collapsed = state.collapsedFriendGroups.has(group.id);
    const icon = isFavoriteGroup ? '★' : '●';
    const regularFriends = group.id === 'ungrouped' ? group.friends.filter(friendIsOnline) : group.friends;
    const offlineFriends = group.id === 'ungrouped' ? group.friends.filter(friend => !friendIsOnline(friend)) : [];
    const rows = collapsed
      ? ''
      : regularFriends.length
        ? limitedMarkup(regularFriends, group.id, renderFriendLocationItem)
        : group.id === 'ungrouped' && offlineFriends.length ? '' : t('<div class="friend-location-section-empty">該当するフレンドはいません</div>');
    return lt`
      <section class="friend-location-section${collapsed ? ' is-collapsed' : ''}" data-favorite-group="${escapeHtml(group.id)}">
        <div class="friend-location-section-heading">
        <button class="friend-location-section-header" type="button"
                data-friend-group-toggle="${escapeHtml(group.id)}"
                aria-expanded="${String(!collapsed)}"
                title="${collapsed ? t('展開') : t('折り畳む')}">
          <span class="friend-location-section-title">
            <span class="friend-location-section-chevron" aria-hidden="true">${collapsed ? '▶' : '▼'}</span>
            <span class="friend-location-section-icon${isFavoriteGroup ? ' is-favorite' : ''}" aria-hidden="true">${icon}</span>
            ${escapeHtml(group.label)}
          </span>
          <span class="friend-location-section-count">${group.friends.length}人</span>
        </button>
        ${isFavoriteGroup ? lt`<button class="favorite-group-edit-button" type="button" data-group-edit="${escapeHtml(group.id)}" aria-label="${escapeHtml(group.label)}の名前を編集" title="名前を編集"${state.favoriteGroupEditor?.saving ? ' disabled' : ''}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1 12-12a2.8 2.8 0 0 0-4-4L4 15z"/></svg>
        </button>` : ''}
        </div>
        ${renderFavoriteGroupEditor(group)}
        ${collapsed ? '' : `${rows ? `<div class="friend-location-grid">${rows}</div>` : ''}${group.id === 'ungrouped' && elements.showOffline?.checked ? renderUngroupedOfflineSection(offlineFriends) : ''}`}
      </section>`;
  }).join('');

  return `<div class="friend-location-view">${sections}</div>`;
}

function renderUngroupedOfflineSection(friends) {
  const collapsed = state.collapsedFriendGroups.has('ungrouped-offline');
  return lt`<section class="friend-location-offline-section${collapsed ? ' is-collapsed' : ''}" data-offline-section>
    <button class="friend-location-section-header" type="button" data-friend-group-toggle="ungrouped-offline" aria-expanded="${String(!collapsed)}" aria-controls="ungroupedOfflineFriends" title="${collapsed ? t('展開') : t('折り畳む')}">
      <span class="friend-location-section-title"><span class="friend-location-section-chevron" aria-hidden="true">${collapsed ? '▶' : '▼'}</span><span class="friend-location-section-icon" aria-hidden="true">○</span>Offline</span>
      <span class="friend-location-section-count">${friends.length}人</span>
    </button>
    ${collapsed ? '' : `<div id="ungroupedOfflineFriends" class="friend-location-grid">${friends.length ? limitedMarkup(friends, 'ungrouped-offline', renderFriendLocationItem) : t('<div class="friend-location-section-empty">Offlineのフレンドはいません</div>')}</div>`}
  </section>`;
}

function buildInstanceLaunchUrl(entry) {
  const worldId = entry?.worldId;
  const instanceId = entry?.instanceId;
  if (!worldId || !instanceId || worldId === 'offline' || worldId === 'private') return '';
  return `${CONFIG.LAUNCH_PAGE}?worldId=${encodeURIComponent(worldId)}&instanceId=${encodeURIComponent(instanceId)}`;
}

function buildWorldUrl(entry) {
  if (!entry?.worldId?.startsWith('wrld_')) return '';
  return `${CONFIG.WORLD_PAGE_BASE}/${encodeURIComponent(entry.worldId)}/info`;
}

function buildUserProfileUrl(userId) {
  if (typeof userId !== 'string' || !/^usr_[0-9a-f-]+$/i.test(userId)) return '';
  return `https://vrchat.com/home/user/${encodeURIComponent(userId)}`;
}

function renderSummaryPeopleIcon(kind) {
  if (kind === 'world') {
    return `<svg class="summary-people-icon summary-people-icon-world" viewBox="0 0 24 18" aria-hidden="true" focusable="false">
      <circle cx="12" cy="5" r="3" fill="currentColor"/>
      <circle cx="5" cy="7" r="2.5" fill="currentColor"/>
      <circle cx="19" cy="7" r="2.5" fill="currentColor"/>
      <path d="M7.2 16c.3-4 2-6.1 4.8-6.1s4.5 2.1 4.8 6.1H7.2Z" fill="currentColor"/>
      <path d="M.8 16c.2-3.3 1.6-5 4.2-5 1.2 0 2.2.4 3 1.2-.8 1-1.3 2.3-1.5 3.8H.8Z" fill="currentColor"/>
      <path d="M17.5 16c-.2-1.5-.7-2.8-1.5-3.8.8-.8 1.8-1.2 3-1.2 2.6 0 4 1.7 4.2 5h-5.7Z" fill="currentColor"/>
    </svg>`;
  }
  return `<svg class="summary-people-icon summary-people-icon-friends" viewBox="0 0 22 18" aria-hidden="true" focusable="false">
    <circle cx="7" cy="6" r="3" fill="currentColor"/>
    <circle cx="15" cy="6" r="3" fill="currentColor"/>
    <path d="M1 17c.2-4.3 2.2-6.5 6-6.5 1.7 0 3 .5 4 1.5-1.2 1.2-1.8 2.9-2 5H1Z" fill="currentColor"/>
    <path d="M13 17c-.2-2.1-.8-3.8-2-5 1-1 2.3-1.5 4-1.5 3.8 0 5.8 2.2 6 6.5h-8Z" fill="currentColor"/>
  </svg>`;
}

function ownerDisplayState() {
  return state.viewMode === VIEW_MODES.INSTANCES ? state : {...state, tab:TABS.ALL};
}

function renderParticipantList(entry, { showAll = false } = {}) {
  const participantState = showAll ? { ...state, tab: TABS.ALL } : state;
  const participants = sortParticipants(
    entry,
    participantsForEntry(entry, participantState, friendMap()),
    state,
  );
  const extraOwner = nonFriendOwnerForEntry(entry, ownerDisplayState(), friendMap());
  const renderUser = (user, ownerInfo=false) => {
    const name = user.displayName || user.username || user.id;
    const src = displayImageUrl(
      user.profilePicOverride
        || user.currentAvatarThumbnailImageUrl
        || user.userIcon
        || user.iconUrl
        || user.imageUrl
        || '',
    );
    const profileUrl = buildUserProfileUrl(user.id);
    const avatar = src
      ? `<img class="participant-avatar" data-image-src="${escapeHtml(src)}" loading="lazy" decoding="async" alt="${escapeHtml(name)}">`
      : '<div class="participant-avatar participant-avatar-empty"></div>';
    const avatarLink = profileUrl
      ? lt`<a class="participant-profile-link" href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener noreferrer" title="VRChat公式プロフィールを開く">${avatar}</a>`
      : avatar;
    const isOwner = Boolean(instanceOwnerId(entry) === user.id);
    const isFriend = friendMap().has(user.id);
    const ownerBadge = isOwner
      ? `<span class="owner-badge${ownerInfo?' owner-badge-reference':''}" title="${escapeHtml(ownerInfo?t('現在の参加者とは限りません。インスタンスオーナーとして表示しています。'):'Instance Owner')}">Owner</span>`
      : '';
    const favoriteBadge = isFriend
      ? renderFavoriteActionButton(user.id, 'favorite-badge-participant')
      : '';

    return `
      <div class="participant" title="${escapeHtml(name)}">
        <div class="participant-avatar-wrap">
          ${avatarLink}${ownerBadge}${favoriteBadge}
        </div>
        <div class="participant-name">${escapeHtml(name)}</div>
      </div>`;
  };
  const empty = !showAll && state.tab === TABS.FAVORITE_ONLY
    ? t('表示対象のFavoriteフレンドはいません') : t('表示対象のユーザーはいません');
  const people = participants.length ? `<div class="participant-list">${participants.map(user=>renderUser(user)).join('')}</div>`
    : `<div class="participant-empty">${escapeHtml(empty)}</div>`;
  const ownerFrame = extraOwner ? `<section class="non-friend-owner-info" aria-label="${escapeHtml(t('インスタンスオーナー'))}">${renderUser(extraOwner,true)}</section>` : '';
  return ownerFrame ? `<div class="participant-area">${ownerFrame}${people}</div>` : people;
}

function renderPrivateInstance(entry, { showAll = false } = {}) {
  const favoriteMode = !showAll && (state.tab === TABS.FAVORITE_PLUS || state.tab === TABS.FAVORITE_ONLY);
  const visibleFriends = showAll
    ? entry.friends
    : favoriteMode
      ? entry.friends.filter((friend) => state.favorites.has(friend.id))
      : entry.friends;

  const collapsible = !showAll && state.viewMode !== VIEW_MODES.FRIENDS && state.tab === TABS.ALL;
  const header = collapsible ? lt`<button type="button" class="friend-location-section-header" data-private-toggle="true" aria-expanded="${!state.privateCollapsed}" aria-controls="privateInstanceUsers"><span class="friend-location-section-chevron" aria-hidden="true">${state.privateCollapsed ? '▶' : '▼'}</span><span class="friend-location-section-title">Private</span><span class="friend-location-section-count">${visibleFriends.length}人</span></button>` : '';
  if (collapsible && state.privateCollapsed) return `<section class="friend-location-section private-instance-section is-collapsed" data-location="${escapeHtml(entry.location)}">${header}</section>`;
  const body = `
    <article class="private-card${instanceIsHighlighted(entry) ? ' instance-highlight' : ''}" data-location="${escapeHtml(entry.location)}" aria-label="Private">
      <div class="private-label">Private</div>
      <div class="private-users">
        ${visibleFriends.map((friend) => {
          const name = friend.displayName || friend.username || friend.id;
          const src = friendAvatarUrl(friend);
          const profileUrl = CONFIG.DEBUG_MODE ? '' : buildUserProfileUrl(friend.id);
          const privateAvatar = src
            ? `<img class="private-avatar" data-image-src="${escapeHtml(src)}" loading="lazy" decoding="async" alt="${escapeHtml(name)}">`
            : `<div class="private-avatar private-avatar-empty" aria-label="${escapeHtml(name)}"></div>`;
          const privateAvatarLink = profileUrl
            ? lt`<a class="private-profile-link" href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener noreferrer" title="VRChat公式プロフィールを開く">${privateAvatar}</a>`
            : privateAvatar;
          return `
            <div class="private-user" title="${escapeHtml(name)}">
              <div class="private-avatar-wrap">
                ${privateAvatarLink}
                ${renderFavoriteActionButton(friend.id, 'private-favorite-badge')}
              </div>
              <div class="private-user-name">${escapeHtml(name)}</div>
            </div>`;
        }).join('')}
        ${visibleFriends.length === 0 ? `<div class="private-empty">${favoriteMode ? t('Favoriteフレンドはいません') : t('表示対象のユーザーはいません')}</div>` : ''}
      </div>
    </article>`;
  return collapsible ? `<section class="friend-location-section private-instance-section" data-location="${escapeHtml(entry.location)}">${header}<div id="privateInstanceUsers">${body}</div></section>` : body;
}

function renderInstanceCard(entry, { preview = false } = {}) {
  if (entry.permission === PERMISSIONS.PRIVATE) return renderPrivateInstance(entry, { showAll: preview });

  const worldName = entry.world?.name
    || entry.instanceData?.world?.name
    || entry.worldId
    || 'World information unavailable';
  const thumb = displayImageUrl(
    entry.world?.thumbnailImageUrl
      || entry.instanceData?.world?.thumbnailImageUrl
      || '',
    'world',
  );
  const worldUrl = entry.debug ? '' : buildWorldUrl(entry);
  const launchUrl = entry.debug ? '' : buildInstanceLaunchUrl(entry);
  const groupName = entry.groupName
    || entry.instanceData?.group?.name
    || entry.instanceData?.groupName
    || (entry.groupId ? t('グループ名取得中…') : '');
  const userCount = effectiveInstanceUserCount(entry, friendMap());
  const capacity = entry.world?.capacity ?? entry.capacity ?? entry.world?.hardCapacity;
  const allFriends = uniqueUsers(entry.friends);
  const allFriendCount = allFriends.length;
  const favoriteFriendCount = allFriends.filter((friend) => state.favorites.has(friend.id)).length;
  const friendCount = preview
    ? allFriendCount
    : state.tab === TABS.FAVORITE_ONLY
      ? favoriteFriendCount
      : allFriendCount;
  const userCountText = Number.isFinite(capacity) ? `${userCount} / ${capacity}` : `${userCount}`;
  const thumbnailCountText = `${allFriendCount}/${userCount}/${Number.isFinite(capacity) ? capacity : '-'}`;
  const permissionClass = permissionBadgeClass(entry.permission);
  const regionBadge = ''; 
  const hydrated = Boolean(entry.instanceData || entry.world);

  return lt`
    <article class="card${hydrated ? '' : ' card-loading'}${instanceIsHighlighted(entry) ? ' instance-highlight' : ''}" data-location="${escapeHtml(entry.location)}">
      <div class="thumb-wrap${worldUrl ? ' thumb-clickable' : ''}">
      ${worldUrl ? lt`<a class="world-page-link" href="${escapeHtml(worldUrl)}" target="_blank" rel="noopener noreferrer" title="ワールドページを開く">` : '<div class="world-page-link">'}
        ${thumb
          ? `<img class="thumb" data-image-src="${escapeHtml(thumb)}" loading="eager" decoding="async" alt="">`
          : '<div class="thumb thumb-placeholder"></div>'}
        <div class="thumb-fade"></div>
        <div class="badges">
          <span class="badge ${permissionClass}">${escapeHtml(permissionLabel(entry.permission))}</span>${regionBadge}
        </div>
        <div class="people-count" title="フレンド数 / 参加人数 / 最大人数">
          <span class="people-count-normal">${escapeHtml(thumbnailCountText)}</span>
          <span class="people-count-simple">${escapeHtml(thumbnailCountText)}</span>
        </div>
        <div class="overlay-title" title="${escapeHtml(worldName)}">${escapeHtml(worldName)}</div>
      ${worldUrl ? '</a>' : '</div>'}
      </div>
      <button class="invite-me-button invite-me-button-simple" type="button" data-location="${escapeHtml(entry.location)}" title="このインスタンスへ自分宛てのInviteMeを送信" ${entry.debug || state.pendingInvites.has(entry.location) || !entry.worldId || !entry.instanceId ? 'disabled' : ''}>InviteMe</button>

      <div class="info-panel">
        <div class="instance-title-line">
          ${launchUrl
            ? lt`<a class="instance-title-name instance-title-name-link" href="${escapeHtml(launchUrl)}" target="_blank" rel="noopener noreferrer" title="VRChat公式Launchページを開く">${escapeHtml(worldName)}</a>`
            : `<span class="instance-title-name" title="${escapeHtml(worldName)}">${escapeHtml(worldName)}</span>`}
          ${entry.groupId ? `<span class="instance-title-separator">/</span><span class="instance-title-group" title="${escapeHtml(groupName)}">${escapeHtml(groupName)}</span>` : ''}
        </div>

        <div class="summary-row">
          <div class="summary-item permission-summary"><svg class="summary-globe" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="1.8"/>
            <path d="M2.8 10h14.4M10 2.5c2.1 2 3.2 4.5 3.2 7.5S12.1 15.5 10 17.5M10 2.5C7.9 4.5 6.8 7 6.8 10s1.1 5.5 3.2 7.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg><span class="summary-value">${escapeHtml(permissionLabel(entry.permission))}${entry.region ? ` / ${escapeHtml(regionLabel(entry.region))}` : ''}</span></div>
          <div class="summary-item">${renderSummaryPeopleIcon('world')}<span class="summary-value">${escapeHtml(userCountText)}</span></div>
          <div class="summary-item friend-count-summary">${renderSummaryPeopleIcon('friends')}<span class="summary-value">${escapeHtml(String(friendCount))}</span><button class="invite-me-button invite-me-button-normal" type="button" data-location="${escapeHtml(entry.location)}" title="このインスタンスへ自分宛てのInviteMeを送信" ${entry.debug || state.pendingInvites.has(entry.location) || !entry.worldId || !entry.instanceId ? 'disabled' : ''}>InviteMe</button></div>
        </div>

        ${renderParticipantList(entry, { showAll: preview })}
      </div>
    </article>`;
}

async function onInviteMeClick(event) {
  const button = event.target.closest('.invite-me-button');
  const inMainList = Boolean(button && elements.list?.contains(button));
  const inPreview = Boolean(button && elements.friendInstancePreview?.contains(button));
  if (!button || (!inMainList && !inPreview)) return;
  event.preventDefault();
  event.stopPropagation();

  const location = button.dataset.location || '';
  const entry = getCurrentInstanceEntry(location);
  if (!entry || !entry.worldId || !entry.instanceId) return;
  if (CONFIG.DEBUG_MODE || entry.debug) {
    showActionToast(t('DEBUG MODE: ダミーインスタンスにはInviteMeを送信しません。'), { delay: 2600 });
    return;
  }
  if (button.disabled || state.loading || state.pendingInvites.has(location)) return;

  const generation = state.loadGeneration;
  state.pendingInvites.add(location);
  button.disabled = true;
  button.classList.add('is-loading');
  button.textContent = t('送信中…');
  try {
    await repository.inviteMyselfTo(location);
    if (generation !== state.loadGeneration) return;
    button.textContent = 'Invited';
    button.classList.add('is-success');
    showActionToast(t('InviteMeを送信しました'), { delay: 2200 });
    window.setTimeout(() => {
      if (!button.isConnected) return;
      button.textContent = 'InviteMe';
      button.classList.remove('is-success', 'is-loading');
      button.disabled = false;
    }, 1800);
  } catch (error) {
    if (generation !== state.loadGeneration || error?.name === 'AbortError') return;
    if (error?.status === 401) handleSessionExpired();
    console.warn('Could not send InviteMe:', location, error);
    button.textContent = 'InviteMe';
    button.classList.remove('is-loading');
    button.disabled = false;
    const message = error?.status === 401
      ? t('VRChatのログインセッションが無効です。')
      : error?.status === 404
        ? t('このインスタンスは存在しないか、InviteMeを送信できません。')
        : error?.outcomeUnknown ? t('送信結果を確認できませんでした。VRChat側の通知を確認してください。')
      : lt`InviteMeの送信に失敗しました${error?.status ? ` (${error.status})` : ''}`;
    showActionToast(message, { error: true, delay: 5600 });
  } finally {
    state.pendingInvites.delete(location);
    document.querySelectorAll('.invite-me-button').forEach(other => {
      if (other.dataset.location !== location) return;
      other.disabled = false;
      other.classList.remove('is-loading');
      if (other !== button) other.textContent = 'InviteMe';
    });
  }
}

function getCurrentInstanceEntry(location, fallback = null) {
  return state.instances.find((entry) => entry.location === location) || fallback;
}

function needsHydration(entry) {
  if (state.loading || !entry || entry.debug || entry.permission === PERMISSIONS.PRIVATE) return false;

  // A failed Instance request must become a terminal state for the current
  // render. Without this guard, `!entry.instanceData` remained true after a
  // failed request, causing the hydration controller to enqueue the same
  // location forever. That could monopolize the event loop and freeze the UI.
  if (!entry.instanceData) {
    if (entry.instanceFetchFailed) return false;
    return true;
  }

  if (!entry.world && !entry.worldFetchFailed
    && entry.worldId && entry.worldId !== 'offline' && entry.worldId !== 'private') {
    return true;
  }
  return needsNonFriendOwnerProfile(entry, friendMap(), ownerDisplayState());
}

function scrollInstanceCardIntoView(location, behavior = 'smooth') {
  if (!elements.list || !location) return false;
  const target = [...elements.list.querySelectorAll('[data-location]')]
    .find((node) => node.dataset.location === location);
  if (!target) return false;
  target.scrollIntoView({ behavior, block: 'center' });
  return true;
}

function replaceCardInDom(entry) {
  const currentEntry = getCurrentInstanceEntry(entry?.location, entry);
  if (!currentEntry) return;

  replaceSidebarLocationCardsInDom(currentEntry);
  refreshFriendInstancePreview(currentEntry.location);

  if (state.viewMode === VIEW_MODES.FRIENDS) {
    const nodes = [...elements.list.querySelectorAll('.friend-location-item[data-location]')]
      .filter((candidate) => candidate.dataset.location === currentEntry.location);
    if (!nodes.length) return;
    const scrollTop = elements.list.scrollTop;
    nodes.forEach((node) => {
      const friend = state.friendIndex.get(node.dataset.friendId);
      if (!friend) return;
      hydrationController.unobserveNode(node);
      const template = document.createElement('template');
      template.innerHTML = renderFriendLocationItem(friend).trim();
      const replacement = template.content.firstElementChild;
      if (!replacement) return;
      patchElement(node, replacement);
      if (needsHydration(currentEntry)) hydrationController.observeNode(node);
    });
    elements.list.scrollTop = scrollTop;
    return;
  }

  const node = [...elements.list.querySelectorAll('.card[data-location]')]
    .find((candidate) => candidate.dataset.location === currentEntry.location);
  if (!node) return;

  hydrationController.unobserveNode(node);
  const template = document.createElement('template');
  template.innerHTML = renderInstanceCard(currentEntry).trim();
  const replacement = template.content.firstElementChild;
  if (!replacement) return;
  const scrollTop = elements.list.scrollTop;
  patchElement(node, replacement);
  elements.list.scrollTop = scrollTop;
  if (needsHydration(currentEntry)) hydrationController.observeNode(node);

  // Re-center the focused card after asynchronous hydration replaced its DOM
  // node. This neutralizes layout shifts caused by the completed request.
  if (state.highlight.location === currentEntry.location && Date.now() < state.highlight.until) {
    requestAnimationFrame(() => scrollInstanceCardIntoView(currentEntry.location, 'auto'));
  }
}

async function hydrateInstance(location, fallbackEntry) {
  if (!location) return;
  const dataRepository = repository;
  const generation = state.loadGeneration;
  const current = () => generation === state.loadGeneration && !dataRepository.disposed;
  let currentEntry = getCurrentInstanceEntry(location, fallbackEntry);
  if (!currentEntry || currentEntry.permission === PERMISSIONS.PRIVATE) return;

  try {
    let data = currentEntry.instanceData;
    if (!data) {
      try {
        data = await dataRepository.fetchInstance(location);
        if (!current()) return;
      } catch (error) {
        if (!current() || error?.name === 'AbortError') return;
        if (error?.status === 401) { handleSessionExpired(); return; }
        currentEntry = getCurrentInstanceEntry(location, currentEntry);
        currentEntry.instanceFetchFailed = true;
        replaceCardInDom(currentEntry);
        throw error;
      }
    }

    // Owner information does not require a presence check.
    currentEntry = getCurrentInstanceEntry(location, currentEntry);
    const changed = !currentEntry.instanceData || currentEntry.instanceData !== data;
    currentEntry.instanceFetchFailed = false;
    mergeInstanceData(currentEntry, data);

    if (!currentEntry.world && !currentEntry.worldFetchFailed
      && currentEntry.worldId && currentEntry.worldId !== 'offline' && currentEntry.worldId !== 'private') {
      try {
        const world = await dataRepository.fetchWorld(currentEntry.worldId);
        if (!current()) return;
        currentEntry = getCurrentInstanceEntry(location, currentEntry);
        if (world) {
          currentEntry.world = world;
          currentEntry.worldFetchFailed = false;
        } else {
          currentEntry.worldFetchFailed = true;
        }
      } catch (error) {
        if (!current() || error?.name === 'AbortError') return;
        if (error?.status === 401) { handleSessionExpired(); return; }
        currentEntry = getCurrentInstanceEntry(location, currentEntry);
        currentEntry.worldFetchFailed = true;
      }
    }

    if (needsNonFriendOwnerProfile(currentEntry, friendMap(), ownerDisplayState())) {
      const ownerId = instanceOwnerId(currentEntry);
      const ownerUser = await dataRepository.fetchUser(ownerId);
      if (!current()) return;
      currentEntry = getCurrentInstanceEntry(location, currentEntry);
      currentEntry.ownerUserLoaded = true;
      if (ownerUser) currentEntry.ownerUser = ownerUser;
    }

    replaceCardInDom(currentEntry);
  } catch (error) {
    if (!current() || error?.name === 'AbortError') return;
    if (error?.status === 401) { handleSessionExpired(); return; }
    console.warn('Could not hydrate instance:', location, error);
  }
}


const FRIEND_PREVIEW_OPEN_DELAY_MS = 550;
const FRIEND_PREVIEW_CLOSE_DELAY_MS = 180;

function clearFriendPreviewTimer(kind) {
  const key = kind === 'close' ? 'closeTimer' : 'openTimer';
  const timer = state.friendPreview[key];
  if (!timer) return;
  clearTimeout(timer);
  state.friendPreview[key] = null;
}

function hideFriendInstancePreview({ immediate = false } = {}) {
  clearFriendPreviewTimer('open');
  clearFriendPreviewTimer('close');
  const hide = () => {
    if (!elements.friendInstancePreview) return;
    elements.friendInstancePreview.classList.add('hidden');
    elements.friendInstancePreview.innerHTML = '';
    elements.friendInstancePreview.style.left = '';
    elements.friendInstancePreview.style.top = '';
    state.friendPreview.friendId = '';
    state.friendPreview.location = '';
    state.friendPreview.anchor = null;
    state.friendPreview.pointerX = 0;
    state.friendPreview.pointerY = 0;
  };
  if (immediate) {
    hide();
    return;
  }
  state.friendPreview.closeTimer = window.setTimeout(() => {
    state.friendPreview.closeTimer = null;
    hide();
  }, FRIEND_PREVIEW_CLOSE_DELAY_MS);
}

function previewParticipantCount(entry) {
  const participantState = { ...state, tab: TABS.ALL };
  return sortParticipants(
    entry,
    participantsForEntry(entry, participantState, friendMap()),
    state,
  ).length + (nonFriendOwnerForEntry(entry, ownerDisplayState(), friendMap()) ? 1 : 0);
}

function positionFriendInstancePreview() {
  const preview = elements.friendInstancePreview;
  if (!preview || preview.classList.contains('hidden')) return;
  const gap = 14;
  const edge = 8;
  const x = Number(state.friendPreview.pointerX) || edge;
  const y = Number(state.friendPreview.pointerY) || edge;
  const previewRect = preview.getBoundingClientRect();

  let left = x + gap;
  let top = y + gap;
  if (left + previewRect.width > window.innerWidth - edge) left = x - previewRect.width - gap;
  if (top + previewRect.height > window.innerHeight - edge) top = y - previewRect.height - gap;
  left = Math.max(edge, Math.min(left, window.innerWidth - previewRect.width - edge));
  top = Math.max(edge, Math.min(top, window.innerHeight - previewRect.height - edge));

  preview.style.left = `${Math.round(left)}px`;
  preview.style.top = `${Math.round(top)}px`;
}

function renderFriendInstancePreview(entry) {
  const preview = elements.friendInstancePreview;
  if (!preview || !entry) return;
  const participantCount = Math.max(1, previewParticipantCount(entry));
  // Normal mode reserves roughly five participant columns even when only one
  // friend is present, so the world/title/summary area keeps enough room.
  // Simple mode remains compact and uses only the columns it actually needs.
  const columns = state.instanceDisplay === 'normal'
    ? 5
    : Math.min(5, participantCount);
  const avatarSize = { small: 60, medium: 72, large: 88 }[state.instanceSize] || 72;
  // The owner reference occupies one counted slot, plus its dashed frame
  // padding and the outer gap in place of the ordinary 4px grid gap.
  const ownerExtra = nonFriendOwnerForEntry(entry, ownerDisplayState(), friendMap())
    ? (window.innerWidth <= 620 ? 2 : 16) + (state.instanceDisplay === 'normal' ? 10 : 6) - 4 : 0;
  const gridWidth = (columns * avatarSize) + ((columns - 1) * 4) + ownerExtra;
  preview.style.setProperty('--friend-preview-columns', String(columns));
  preview.style.setProperty('--friend-preview-grid-width', `${gridWidth}px`);
  patchMarkup(preview, renderInstanceCard(entry, { preview: true }));
  preview.classList.remove('hidden');
  requestAnimationFrame(positionFriendInstancePreview);
}

function refreshFriendInstancePreview(location) {
  if (!location || state.friendPreview.location !== location) return;
  if (!validateFriendInstancePreview()) return;
  const entry = getCurrentInstanceEntry(location);
  if (!entry || !elements.friendInstancePreview || elements.friendInstancePreview.classList.contains('hidden')) return;
  renderFriendInstancePreview(entry);
}

function isValidFriendPreviewAnchor(item) {
  if (!item?.isConnected) return false;
  if (item.classList.contains('friend-location-item')) {
    return state.viewMode === VIEW_MODES.FRIENDS && Boolean(elements.list?.contains(item));
  }
  if (item.classList.contains('friend-item')) {
    return state.sidebarMode !== 'hidden' && Boolean(elements.friendList?.contains(item));
  }
  return false;
}

function friendPreviewEntry(item) {
  if (!isValidFriendPreviewAnchor(item)) return null;
  const friend = state.friendIndex.get(item.dataset.friendId);
  if (!friend || onlineStatusInfo(friend).className === 'online-website') return null;
  const location = resolveFriendLocation(friend);
  if (classifyPermission(location) === PERMISSIONS.PRIVATE || location === 'private') return null;
  return reverseEntryForFriend(friend);
}

function validateFriendInstancePreview() {
  const entry = friendPreviewEntry(state.friendPreview.anchor);
  if (!entry || entry.location !== state.friendPreview.location) {
    hideFriendInstancePreview({ immediate: true });
    return false;
  }
  return true;
}

function scheduleFriendInstancePreview(item, pointerX, pointerY) {
  if (!isValidFriendPreviewAnchor(item)) { hideFriendInstancePreview({ immediate: true }); return; }
  if (
    item.classList.contains('friend-item')
    && state.friendPreview.sidebarSuppressedFriendId
    && item.dataset.friendId === state.friendPreview.sidebarSuppressedFriendId
  ) { hideFriendInstancePreview({ immediate: true }); return; }
  if (elements.favoriteMenu && !elements.favoriteMenu.classList.contains('hidden')) return;
  const entry = friendPreviewEntry(item);
  // Ineligible rows must close the old preview rather than cancel its close timer.
  if (!entry) { hideFriendInstancePreview({ immediate: true }); return; }
  clearFriendPreviewTimer('open');
  clearFriendPreviewTimer('close');

  const friend = state.friendIndex.get(item.dataset.friendId);
  state.friendPreview.pointerX = Number(pointerX) || 0;
  state.friendPreview.pointerY = Number(pointerY) || 0;

  state.friendPreview.openTimer = window.setTimeout(() => {
    state.friendPreview.openTimer = null;
    const currentEntry = friendPreviewEntry(item);
    if (!currentEntry || currentEntry.location !== entry.location) {
      hideFriendInstancePreview({ immediate: true });
      return;
    }
    state.friendPreview.friendId = friend.id;
    state.friendPreview.location = currentEntry.location;
    state.friendPreview.anchor = item;
    renderFriendInstancePreview(currentEntry);

    // Reuse the existing bounded hydration pipeline. If the details are already
    // cached this is a no-op; otherwise only this visible instance is queued.
    if (needsHydration(currentEntry)) hydrationController.enqueue(currentEntry);
  }, FRIEND_PREVIEW_OPEN_DELAY_MS);
}

function onFriendLocationMouseOver(event) {
  if (state.viewMode !== VIEW_MODES.FRIENDS) return;
  const item = event.target.closest('.friend-location-item');
  if (!item || !elements.list?.contains(item)) return;
  if (event.relatedTarget && item.contains(event.relatedTarget)) return;
  scheduleFriendInstancePreview(item, event.clientX, event.clientY);
}

function onFriendLocationMouseMove(event) {
  if (!state.friendPreview.openTimer) return;
  const item = event.target.closest('.friend-location-item');
  if (!item || !elements.list?.contains(item)) return;
  state.friendPreview.pointerX = event.clientX;
  state.friendPreview.pointerY = event.clientY;
}

function onFriendLocationMouseOut(event) {
  const item = event.target.closest('.friend-location-item');
  if (!item || !elements.list?.contains(item)) return;
  if (event.relatedTarget && item.contains(event.relatedTarget)) return;
  clearFriendPreviewTimer('open');
  hideFriendInstancePreview();
}

function clearSidebarFriendPreviewSuppression() {
  state.friendPreview.sidebarSuppressedFriendId = '';
}

function suppressSidebarFriendPreviewUntilLeave(friendId) {
  state.friendPreview.sidebarSuppressedFriendId = friendId || '';
  hideFriendInstancePreview({ immediate: true });
}

function onFriendSidebarMouseOver(event) {
  const item = event.target.closest('.friend-item');
  if (!item || !elements.friendList?.contains(item)) return;
  if (event.relatedTarget && item.contains(event.relatedTarget)) return;

  const suppressedFriendId = state.friendPreview.sidebarSuppressedFriendId;
  if (suppressedFriendId) {
    if (item.dataset.friendId === suppressedFriendId) return;
    clearSidebarFriendPreviewSuppression();
  }

  scheduleFriendInstancePreview(item, event.clientX, event.clientY);
}

function onFriendSidebarMouseMove(event) {
  const item = event.target.closest('.friend-item');

  if (state.friendPreview.sidebarSuppressedFriendId) {
    if (!item || item.dataset.friendId !== state.friendPreview.sidebarSuppressedFriendId) {
      clearSidebarFriendPreviewSuppression();
    } else {
      return;
    }
  }

  if (!state.friendPreview.openTimer) return;
  if (!item || !elements.friendList?.contains(item)) return;
  state.friendPreview.pointerX = event.clientX;
  state.friendPreview.pointerY = event.clientY;
}

function onFriendSidebarMouseOut(event) {
  const item = event.target.closest('.friend-item');
  if (!item || !elements.friendList?.contains(item)) return;
  if (event.relatedTarget && item.contains(event.relatedTarget)) return;
  clearFriendPreviewTimer('open');
  hideFriendInstancePreview();
}

function onFriendSidebarMouseLeave() {
  clearSidebarFriendPreviewSuppression();
  hideFriendInstancePreview();
}

function toggleFriendLocationGroup(groupId) {
  if (!groupId) return;
  if (state.collapsedFriendGroups.has(groupId)) state.collapsedFriendGroups.delete(groupId);
  else state.collapsedFriendGroups.add(groupId);
  hideFriendInstancePreview({ immediate: true });
  render({ resetScroll: false });
}

function onFriendViewControlClick(event) {
  const editButton = event.target.closest('[data-group-edit]');
  if (editButton && elements.list?.contains(editButton)) {
    event.preventDefault();
    if (state.loading || state.favoriteMutationPending || state.pendingInvites.size) return;
    const groupName = editButton.dataset.groupEdit;
    const group = state.favoriteGroups.find(group => group.name === groupName);
    if (!FAVORITE_GROUP_NAMES.includes(groupName)) return;
    if (state.favoriteGroupEditor?.groupName === groupName) {
      closeFavoriteGroupEditor(); return;
    }
    if (state.favoriteGroupEditor?.groupName !== groupName) {
      state.favoriteGroupEditor = { groupName, draft: group?.displayName || `Favorite List ${FAVORITE_GROUP_NAMES.indexOf(groupName) + 1}`, saving: false, error: '', outcomeUnknown: false };
    }
    render({ resetScroll: false });
    const input = elements.list.querySelector('.favorite-group-name-input');
    input?.focus(); input?.select();
    return;
  }
  if (event.target.closest('[data-group-edit-cancel]')) {
    event.preventDefault();
    if (state.favoriteGroupEditor?.saving) return;
    closeFavoriteGroupEditor(); return;
  }
  if (event.target.closest('[data-group-editor]')) return;
  const privateToggle = event.target.closest('[data-private-toggle]');
  if (privateToggle && elements.list?.contains(privateToggle)) {
    event.preventDefault(); state.privateCollapsed = !state.privateCollapsed;
    render({ resetScroll: false }); return;
  }
  const toggle = event.target.closest('[data-friend-group-toggle]');
  if (!toggle || !elements.list?.contains(toggle)) return;
  event.preventDefault();
  toggleFriendLocationGroup(toggle.dataset.friendGroupToggle || '');
}

function closeFavoriteGroupEditor({ restoreFocus = true } = {}) {
  const groupName = state.favoriteGroupEditor?.groupName;
  state.favoriteGroupEditor = null;
  render({ resetScroll: false });
  if (restoreFocus) elements.list.querySelector(`[data-group-edit="${groupName}"]`)?.focus();
}

async function saveFavoriteGroupName(event) {
  if (!event.target.matches('[data-group-editor]')) return;
  event.preventDefault();
  const editor = state.favoriteGroupEditor;
  if (!editor || editor.saving || editor.outcomeUnknown || state.loading || state.favoriteMutationPending || state.pendingInvites.size) return;
  const name = editor.draft.trim();
  if (!name || name.length > CONFIG.FAVORITE_GROUP_NAME_MAX_LENGTH || /[\r\n\u0000]/.test(name)) {
    editor.error = name.length > CONFIG.FAVORITE_GROUP_NAME_MAX_LENGTH ? t('グループ名は20文字以内で入力してください。') : t('グループ名を入力してください。'); render({ resetScroll: false });
    elements.list.querySelector('.favorite-group-name-input')?.focus(); return;
  }
  const group = state.favoriteGroups.find(group => group.name === editor.groupName);
  if (name === group?.displayName) { closeFavoriteGroupEditor(); return; }
  if (CONFIG.DEBUG_MODE) { showActionToast(t('DEBUG MODE: グループ名は変更しません。')); return; }
  const generation = state.loadGeneration;
  const dataRepository = repository;
  editor.saving = true; editor.error = '';
  state.favoriteMutationPending = true;
  actionToast.setUndoBusy(true);
  render({ resetScroll: false });
  showActionToast(t('リスト名を保存しています(少し時間が掛かります)…'), { delay: 0 });
  try {
    const result = await dataRepository.renameFriendFavoriteGroup(editor.groupName, name);
    if (generation !== state.loadGeneration || dataRepository.disposed) return;
    if (result.syncError?.status === 401) { handleSessionExpired(); return; }
    applyFavoriteState(result.favoriteState);
    state.favoriteGroupEditor = null;
    render({ resetScroll: false });
    elements.list.querySelector(`[data-group-edit="${editor.groupName}"]`)?.focus();
    showActionToast(result.syncFailed ? t('グループ名を保存しました（再確認に失敗しました。次回更新時に確認します）。') : t('グループ名を変更しました。'), { delay: 4000 });
  } catch (error) {
    if (generation !== state.loadGeneration || error?.name === 'AbortError') return;
    if (error?.status === 401) { handleSessionExpired(); return; }
    editor.saving = false;
    editor.outcomeUnknown = Boolean(error?.outcomeUnknown);
    editor.error = editor.outcomeUnknown
      ? t('変更結果を確認できませんでした。「更新」で名前を確認してください。')
      : error?.status === 400
        ? t('名前が受け付けられませんでした。文字数や内容を変更して再試行してください。')
        : lt`グループ名の保存に失敗しました${error?.status ? ` (${error.status})` : ''}。再試行できます。`;
    render({ resetScroll: false });
    elements.list.querySelector('.favorite-group-name-input')?.focus();
    showActionToast(editor.error, { error: true, delay: 5600 });
  } finally {
    if (state.favoriteGroupEditor === editor) editor.saving = false;
    if (generation === state.loadGeneration) { state.favoriteMutationPending = false; actionToast.setUndoBusy(false); }
  }
}

const FAVORITE_GROUP_NAMES = Object.freeze(['group_0', 'group_1', 'group_2']);

function closeFavoriteMenu({ restoreFocus = false } = {}) {
  const anchor = state.favoriteMenu.anchor;
  if (elements.favoriteMenu) {
    elements.favoriteMenu.classList.add('hidden');
    elements.favoriteMenu.innerHTML = '';
    elements.favoriteMenu.style.left = '';
    elements.favoriteMenu.style.top = '';
  }
  state.favoriteMenu.userId = '';
  state.favoriteMenu.worldId = '';
  state.favoriteMenu.anchor = null;
  state.favoriteMenu.busy = false;
  state.favoriteMenu.fromFriendPreview = false;
  if (restoreFocus && anchor?.isConnected) anchor.focus();
}

function positionFavoriteMenu(anchor) {
  const menu = elements.favoriteMenu;
  if (!menu || !anchor?.isConnected || menu.classList.contains('hidden')) return;
  const edge = 8;
  const gap = 5;
  const rect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  let left = rect.right + gap;
  let top = rect.bottom + gap;
  if (left + menuRect.width > window.innerWidth - edge) left = rect.left - menuRect.width - gap;
  left = Math.min(left, window.innerWidth - menuRect.width - edge);
  if (top + menuRect.height > window.innerHeight - edge) top = rect.top - menuRect.height - gap;
  menu.style.left = `${Math.max(edge, Math.round(left))}px`;
  menu.style.top = `${Math.max(edge, Math.round(top))}px`;
}

function renderFavoriteMenu(userId, anchor) {
  const menu = elements.favoriteMenu;
  if (!menu || !userId || !anchor) return;
  const isFavorite = state.favorites.has(userId);
  const currentGroup = favoriteGroupForUser(userId);
  const groupsByName = new Map(state.favoriteGroups.map((group) => [group.name, group]));
  const groupRows = FAVORITE_GROUP_NAMES.map((name, index) => {
    const label = groupsByName.get(name)?.displayName || `Favorite List ${index + 1}`;
    const active = isFavorite && currentGroup === name;
    return `<button class="favorite-menu-item${active ? ' is-current' : ''}" type="button" role="menuitemradio" aria-checked="${String(active)}" data-favorite-group="${name}" data-favorite-user-id="${escapeHtml(userId)}"><span class="favorite-menu-check" aria-hidden="true">${active ? '✓' : ''}</span><span class="favorite-menu-label">${escapeHtml(label)}</span></button>`;
  }).join('');
  const removeRow = isFavorite
    ? lt`<div class="favorite-menu-separator" role="separator"></div><button class="favorite-menu-item favorite-menu-remove" type="button" role="menuitem" data-favorite-remove="true" data-favorite-user-id="${escapeHtml(userId)}"><span class="favorite-menu-check" aria-hidden="true"></span><span class="favorite-menu-label">Favoriteを外す</span></button>`
    : '';
  menu.innerHTML = `${groupRows}${removeRow}`;
  menu.classList.remove('hidden');
  state.favoriteMenu.userId = userId;
  state.favoriteMenu.anchor = anchor;
  state.favoriteMenu.fromFriendPreview = Boolean(elements.friendInstancePreview?.contains(anchor));
  if (state.favoriteMenu.fromFriendPreview) clearFriendPreviewTimer('close');
  requestAnimationFrame(() => positionFavoriteMenu(anchor));
}

function onFavoriteMenuMouseEnter() {
  if (!state.favoriteMenu.fromFriendPreview) return;
  clearFriendPreviewTimer('close');
}

function onFavoriteMenuMouseLeave() {
  if (!state.favoriteMenu.fromFriendPreview) return;
  hideFriendInstancePreview();
}

async function applyFavoriteMutation({ userId, groupName = '', remove = false } = {}) {
  if (!userId || state.favoriteMutationPending || state.loading) return;
  if (CONFIG.DEBUG_MODE) {
    showActionToast(t('DEBUG MODE: Favorite情報はVRChatへ変更しません。'), { delay: 2600 });
    closeFavoriteMenu();
    return;
  }
  const currentRecord = state.favoriteRecords.get(userId) || null;
  const previousTags = [...(currentRecord?.tags || [])];
  const currentGroup = favoriteGroupForUser(userId);
  if (!remove && currentGroup === groupName && state.favorites.has(userId)) {
    closeFavoriteMenu();
    return;
  }

  actionToast.clearUndo(); state.favoriteUndo = null;
  state.favoriteMutationPending = true;
  state.favoriteMenu.busy = true;
  const generation = state.loadGeneration;
  const dataRepository = repository;
  elements.favoriteMenu?.querySelectorAll('button').forEach((button) => { button.disabled = true; });
  showActionToast(remove ? t('Favoriteを外しています…') : t('Favoriteを更新中…'), { delay: 0 });
  try {
    const result = remove
      ? await dataRepository.removeFriendFavorite(currentRecord)
      : await dataRepository.setFriendFavoriteGroup(userId, groupName, currentRecord);
    if (generation !== state.loadGeneration) return;
    applyFavoriteState(result.favoriteState);
    closeFavoriteMenu();
    render({ resetScroll: false });
    void loadOfflineFriendProfiles();
    if (result.syncFailed) {
      if (result.syncError?.status === 401) { handleSessionExpired(); return; }
      offerFavoriteUndo(userId, previousTags, remove ? [] : [groupName], generation);
      const action = remove ? t('Favoriteを外しました') : t('Favoriteを更新しました');
      showActionToast(lt`${action}（再同期に失敗しました。次回更新時に再確認します）`, { delay: 5200 });
    } else {
      offerFavoriteUndo(userId, previousTags, [...(state.favoriteRecords.get(userId)?.tags || [])], generation);
    }
  } catch (error) {
    if (generation !== state.loadGeneration || error?.name === 'AbortError') return;
    if (error?.status === 401) handleSessionExpired();
    console.warn('Could not update Favorite:', userId, error);
    state.favoriteMenu.busy = false;
    elements.favoriteMenu?.querySelectorAll('button').forEach((button) => { button.disabled = false; });
    const rollback = error?.favoriteRollbackFailed ? t('（元のFavorite Listへの復元にも失敗しました）') : '';
    const message = error?.status === 401
      ? t('VRChatのログインセッションが無効です。')
      : error?.status === 403
        ? t('このフレンドのFavoriteを変更できません。')
        : error?.favoriteOutcomeUnknown || error?.outcomeUnknown
        ? t('変更結果を確認できませんでした。更新してFavoriteの状態を確認してください。')
      : lt`Favoriteの更新に失敗しました${error?.status ? ` (${error.status})` : ''}${rollback}`;
    showActionToast(message, { error: true, delay: 5600 });
  } finally {
    if (generation === state.loadGeneration) state.favoriteMutationPending = false;
  }
}

function offerFavoriteUndo(userId, previousTags, expectedTags, generation) {
  const ticket = { userId, previousTags, expectedTags, generation, account: state.user?.id };
  state.favoriteUndo = ticket;
  actionToast.setUndo(t('Favoriteを更新しました。'), () => void undoFavorite(ticket), () => {
    if (state.favoriteUndo === ticket) state.favoriteUndo = null;
  });
}

async function undoFavorite(ticket) {
  if (state.favoriteUndo !== ticket || state.favoriteMutationPending || state.loading) return;
  if (ticket.account !== state.user?.id) {
    actionToast.clearUndo(); state.favoriteUndo = null; return;
  }
  const dataRepository = repository;
  const generation = state.loadGeneration;
  state.favoriteMutationPending = true;
  actionToast.setUndoBusy(true);
  closeFavoriteMenu();
  try {
    const result = await dataRepository.restoreFriendFavorite(ticket.userId, ticket.previousTags, ticket.expectedTags);
    if (generation !== state.loadGeneration) return;
    if (result.syncError?.status === 401) { handleSessionExpired(); return; }
    applyFavoriteState(result.favoriteState);
    render({ resetScroll: false });
    showActionToast(result.syncFailed
      ? t('Favoriteを元に戻しました。（再同期に失敗しました。更新で再確認してください）')
      : t('Favoriteを元に戻しました。'), { delay: result.syncFailed ? 5200 : 2800 });
  } catch (error) {
    if (generation !== state.loadGeneration || error?.name === 'AbortError') return;
    if (error?.status === 401) { handleSessionExpired(); return; }
    // Reconcile once after a failed write; never blindly retry an uncertain one.
    let live = error.favoriteState;
    if (!live) {
      try { live = await dataRepository.fetchFavoritesStrict(); }
      catch (syncError) { if (syncError?.status === 401) { handleSessionExpired(); return; } }
    }
    if (generation !== state.loadGeneration) return;
    if (live) { applyFavoriteState(live); render({ resetScroll: false }); }
    showActionToast(error.favoriteConflict
      ? t('Favoriteが別の画面で変更されたため、戻せませんでした。')
      : t('Favoriteを元に戻せませんでした。') + (live ? t('現在の登録状態を表示しています。') : t('更新して登録状態を確認してください。')), { error: true, delay: 6500 });
  } finally {
    if (generation === state.loadGeneration) {
      state.favoriteMutationPending = false;
      state.favoriteUndo = null;
      actionToast.clearUndo();
    }
  }
}


function initializeDemoWorldFavorites(instances) {
  worldFavorites = new WorldFavorites(repository.api);
  worldFavorites.ready = true; worldFavorites.updatedAt = Date.now();
  worldFavorites.groups = [1,2,3,4].map(n=>({type:'world',name:`worlds${n}`,key:`world:worlds${n}`,label:['Chill Worlds','Event Worlds','Explore','Favorite Worlds'][n-1]}));
  const ids=[...new Set(instances.map(e=>e.worldId).filter(Boolean))].slice(0,2);
  ids.forEach((id,i)=>worldFavorites.records.set(id,[{id:`fvrt_demo_world_${i}`,type:'world',tags:[`worlds${i+1}`]}]));
}
function renderWorldFavoriteButton(worldId) {
  if (!/^wrld_[A-Za-z0-9_-]+$/.test(worldId || '')) return '';
  const active = Boolean(worldFavorites?.records.get(worldId)?.length);
  const label = worldFavorites?.ready
    ? t(active ? 'ワールドFavoriteを変更' : 'ワールドをFavoriteに登録')
    : t('ワールドFavoriteを確認');
  return `<button type="button" class="world-favorite-button favorite-badge${active ? ' is-favorite' : ''}" data-world-favorite-id="${escapeHtml(worldId)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"${state.favoriteMutationPending || state.loading ? ' disabled' : ''}><span aria-hidden="true">${active ? `★${worldFavorites.number(worldId)||1}` : ''}</span></button>`;
}
async function refreshWorldFavorites(generation, store, force=false) {
  if (!store || CONFIG.DEBUG_MODE || CONFIG.SCREENSHOT_MODE) return;
  try {
    await store.load(force);
    if (generation !== state.loadGeneration || store !== worldFavorites) return;
    render({ resetScroll:false });
  } catch (error) {
    if (generation !== state.loadGeneration || error?.name === 'AbortError') return;
    if (error?.status === 401) { handleSessionExpired(); return; }
    console.warn('Could not read world Favorites:', error);
  }
}
function unavailableFavoriteWorld(worldId) {
  const world=worldCatalog.worlds.get(worldId) || state.recent.rows.find(w=>w.id===worldId);
  return Boolean(world && worldIsUnavailable(world));
}
function renderWorldFavoriteMenu(worldId, anchor) {
  const menu=elements.favoriteMenu;
  if (!menu || !anchor?.isConnected) return;
  const current=worldFavorites?.current(worldId)||[];
  const groups=worldFavorites?.groups||[];
  const unavailable=unavailableFavoriteWorld(worldId);
  menu.innerHTML=(worldFavorites?.ready
    ? (unavailable ? `<div class="favorite-menu-world-heading" role="note">${escapeHtml(t('取得不可のワールドは移動・再登録できません。Favoriteの解除は元に戻せない可能性があります。'))}</div>` : groups.map(g=>{
      const active=current.some(r=>r.type===g.type && r.tags.includes(g.name));
      const label=`★${groups.indexOf(g)+1} ${g.label}${g.type==='vrcPlusWorld'?' (VRC+)':''}`;
      return `<button type="button" class="favorite-menu-item${active?' is-current':''}" role="menuitemradio" aria-checked="${active}" data-world-favorite-id="${escapeHtml(worldId)}" data-world-favorite-group="${escapeHtml(g.key)}"><span class="favorite-menu-check" aria-hidden="true">${active?'✓':''}</span><span class="favorite-menu-label">${escapeHtml(label)}</span></button>`;
    }).join('')) + (current.length ? `<div class="favorite-menu-separator" role="separator"></div><button type="button" class="favorite-menu-item favorite-menu-remove" data-world-favorite-id="${escapeHtml(worldId)}" data-world-favorite-remove role="menuitem"><span class="favorite-menu-check" aria-hidden="true"></span><span class="favorite-menu-label">${escapeHtml(t('Favoriteを外す'))}</span></button>`:'')
    : `<button type="button" class="favorite-menu-item" data-world-favorite-retry="${escapeHtml(worldId)}">${escapeHtml(t('ワールドFavoriteを再取得'))}</button>`);
  state.favoriteMenu.worldId=worldId;state.favoriteMenu.anchor=anchor;
  state.favoriteMenu.fromFriendPreview=Boolean(elements.friendInstancePreview?.contains(anchor));
  if(state.favoriteMenu.fromFriendPreview)clearFriendPreviewTimer('close');
  menu.classList.remove('hidden');requestAnimationFrame(()=>positionFavoriteMenu(anchor));
}
async function openWorldFavoriteMenu(worldId, anchor) {
  if(state.loading || state.favoriteMutationPending)return;
  const store=worldFavorites;const generation=state.loadGeneration;
  if(CONFIG.DEBUG_MODE || CONFIG.SCREENSHOT_MODE){closeFavoriteMenu();renderWorldFavoriteMenu(worldId,anchor);return}
  if(!store)return;
  closeFavoriteMenu();renderWorldFavoriteMenu(worldId,anchor);
  try{
    if(!store.ready){elements.favoriteMenu.innerHTML=`<div class="favorite-menu-world-heading">${escapeHtml(t('ワールドFavoriteを確認中…'))}</div>`;await store.load(true)}
    if(generation!==state.loadGeneration||store!==worldFavorites||state.favoriteMenu.worldId!==worldId)return;
    renderWorldFavoriteMenu(worldId,anchor);
  }catch(error){
    if(generation!==state.loadGeneration||error?.name==='AbortError')return;
    if(error?.status===401){handleSessionExpired();return}
    if(state.favoriteMenu.worldId===worldId)renderWorldFavoriteMenu(worldId,anchor);
    showActionToast(readFailureMessage('worldFavorites',error),{error:true,delay:5200});
  }
}
async function changeWorldFavorite(worldId, desired, expected, undo=false) {
  if(CONFIG.DEBUG_MODE || CONFIG.SCREENSHOT_MODE){showActionToast(t('撮影用モード: ワールドFavoriteは変更しません。'),{delay:2600});closeFavoriteMenu();return}
  if(state.loading || state.favoriteMutationPending || !worldFavorites)return;
  const store=worldFavorites,generation=state.loadGeneration,account=state.user?.id;
  actionToast.clearUndo();state.favoriteUndo=null;state.favoriteMutationPending=true;state.favoriteMenu.busy=true;
  elements.favoriteMenu?.querySelectorAll('button').forEach(b=>{b.disabled=true});
  showActionToast(t('Favoriteを更新中…'),{delay:0});
  try{
    const unavailable=unavailableFavoriteWorld(worldId);
    if(unavailable && desired.length){const e=new Error('Unavailable world');e.favoriteWorldUnavailable=true;e.favoriteNoMutation=true;throw e}
    const result=await store.change(worldId,desired,expected);
    if(generation!==state.loadGeneration||store!==worldFavorites)return;
    if(result.syncError?.status===401){handleSessionExpired();return}
    closeFavoriteMenu();render({resetScroll:false});
    if(undo)showActionToast(t('Favoriteを元に戻しました。'),{delay:2800});
    else if(unavailable && !desired.length)showActionToast(t('取得不可のワールドのFavoriteを解除しました。元に戻すことはできません。'),{delay:6000});
    else{
      const ticket={worldId,previous:result.previous,expected:result.expected,generation,account};state.favoriteUndo=ticket;
      actionToast.setUndo(t('ワールドFavoriteを更新しました。'),()=>{
        if(state.favoriteUndo!==ticket||state.user?.id!==ticket.account)return;
        void changeWorldFavorite(worldId,ticket.previous,ticket.expected,true);
      },()=>{if(state.favoriteUndo===ticket)state.favoriteUndo=null});
    }
    if(result.syncFailed)showActionToast(t('Favoriteを更新しました（再同期に失敗しました。更新で再確認してください）。'),{delay:5200});
  }catch(error){
    if(generation!==state.loadGeneration||error?.name==='AbortError')return;
    if(error?.status===401){handleSessionExpired();return}
    // Reconcile a failed or uncertain write once; no blind write retry.
    if(!error?.favoriteNoMutation)try{await store.load(true)}catch{store.ready=false}
    if(generation!==state.loadGeneration||store!==worldFavorites)return;
    closeFavoriteMenu();render({resetScroll:false});
    const message=error?.favoriteWorldUnavailable ? t('取得不可または再登録できないワールドのため、登録を変更せずに中止しました。Favoriteの解除のみ可能です。')
      : error?.favoriteNoMutation ? t('ワールド情報を確認できませんでした。Favoriteの登録は変更していません。時間をおいて再試行してください。')
      : error?.favoriteConflict ? t('Favoriteが別の画面で変更されたため、操作を中止しました。')
      : error?.outcomeUnknown ? t('変更結果を確認できませんでした。更新してFavoriteの状態を確認してください。')
      : error?.favoriteRollbackFailed ? t('ワールドFavoriteの変更に失敗し、元の登録も復元できませんでした。更新で確認してください。')
      : error?.favoriteListSetupSuggested ? t('空リストの登録に失敗しました。改善しない場合は、公式ページから各リストへ最低ひとつ以上のワールドをお気に入り登録した後、この拡張機能の更新ボタンで再取得してください。')
      : t('ワールドFavoriteを変更できませんでした。登録上限やアクセス権を確認してください。');
    showActionToast(message,{error:true,delay:error?.favoriteListSetupSuggested?15000:6000});
  }finally{if(generation===state.loadGeneration){state.favoriteMutationPending=false;state.favoriteMenu.busy=false;render({resetScroll:false});if(state.viewMode===VIEW_MODES.RECENT&&worldView.selected!=='recent')void loadWorldView()}}
}
function onWorldFavoriteClick(event) {
  const button=event.target.closest('.world-favorite-button');
  const choice=event.target.closest('[data-world-favorite-group], [data-world-favorite-remove], [data-world-favorite-retry]');
  if(!button && !(choice&&elements.favoriteMenu?.contains(choice)))return false;
  event.preventDefault();event.stopPropagation();
  if(state.favoriteMutationPending||state.loading)return true;
  if(button){
    const id=button.dataset.worldFavoriteId;
    if(state.favoriteMenu.worldId===id&&state.favoriteMenu.anchor===button){closeFavoriteMenu({restoreFocus:true});return true}
    clearFriendPreviewTimer('open');clearFriendPreviewTimer('close');
    if(!elements.friendInstancePreview?.contains(button))hideFriendInstancePreview({immediate:true});
    void openWorldFavoriteMenu(id,button);return true;
  }
  if(choice.hasAttribute('data-world-favorite-retry')){void openWorldFavoriteMenu(choice.dataset.worldFavoriteRetry,state.favoriteMenu.anchor);return true}
  const id=choice.dataset.worldFavoriteId,current=worldFavorites?.current(id)||[];
  const group=worldFavorites?.groups.find(g=>g.key===choice.dataset.worldFavoriteGroup);
  if(!choice.hasAttribute('data-world-favorite-remove')&&!group)return true;
  void changeWorldFavorite(id,group?[{type:group.type,tags:[group.name]}]:[],current);return true;
}

function onFavoriteUiClick(event) {
  if (onWorldFavoriteClick(event)) return;
  const actionButton = event.target.closest('.favorite-action-button');
  if (actionButton) {
    event.preventDefault();
    event.stopPropagation();
    clearFriendPreviewTimer('open');
    clearFriendPreviewTimer('close');
    if (!elements.friendInstancePreview?.contains(actionButton)) {
      hideFriendInstancePreview({ immediate: true });
    }
    const userId = actionButton.dataset.favoriteUserId || '';
    if (!userId) return;
    if (!elements.favoriteMenu?.classList.contains('hidden') && state.favoriteMenu.userId === userId && state.favoriteMenu.anchor === actionButton) {
      closeFavoriteMenu({ restoreFocus: true });
      return;
    }
    closeFavoriteMenu();
    renderFavoriteMenu(userId, actionButton);
    return;
  }

  const menuItem = event.target.closest('.favorite-menu-item');
  if (menuItem && elements.favoriteMenu?.contains(menuItem)) {
    event.preventDefault();
    event.stopPropagation();
    const userId = menuItem.dataset.favoriteUserId || state.favoriteMenu.userId;
    if (menuItem.dataset.favoriteRemove === 'true') {
      void applyFavoriteMutation({ userId, remove: true });
    } else {
      void applyFavoriteMutation({ userId, groupName: menuItem.dataset.favoriteGroup || '' });
    }
    return;
  }

  if (!elements.favoriteMenu?.classList.contains('hidden') && !event.target.closest('#favoriteMenu')) {
    closeFavoriteMenu();
  }
}

const hydrationController = new InstanceHydrationController({
  root: elements.list,
  getEntries: () => state.instances,
  needsHydration,
  hydrate: hydrateInstance,
  concurrency: CONFIG.HYDRATE_CONCURRENCY,
  preloadPx: CONFIG.HYDRATE_PRELOAD_PX,
  initialCount: CONFIG.INITIAL_HYDRATE_COUNT,
});

function render({ resetScroll = false, hydrationMode = 'normal', priorityLocation = '' } = {}) {
  updateReloadButton();
  hideFriendInstancePreview({ immediate: true });
  closeFavoriteMenu();
  const friendScroll = elements.friendList?.scrollTop || 0;
  const rightScroll = resetScroll ? 0 : elements.list?.scrollTop || 0;
  hydrationController.disconnect();

  updateTabButtons();
  renderFriendSidebar();

  const manifest = globalThis.chrome?.runtime?.getManifest?.();
  const appVersion = manifest?.version_name || manifest?.version || '1.6.3';
  const credit = `<div class="app-credit">VRChat Friends &amp; Group Instance Viewer v${escapeHtml(appVersion)} created by <a href="https://x.com/mos_vrc" target="_blank" rel="noopener noreferrer">@mos_vrc</a></div>`;
  if (state.viewMode === VIEW_MODES.RECENT) {
    patchMarkup(elements.list, `${renderRecentWorlds()}${credit}`);
  } else if (state.viewMode === VIEW_MODES.FRIENDS) {
    patchMarkup(elements.list, `${renderFriendLocationView()}${credit}`);
  } else {
    const data = getVisibleInstances();
    if (!data.length) {
      patchMarkup(elements.list, lt`<div class="empty">表示できるインスタンスはありません。</div>${credit}`);
    } else {
      patchMarkup(elements.list, `${data.map(renderInstanceCard).join('')}${credit}`);
    }
  }

  elements.friendList.scrollTop = friendScroll;
  elements.list.scrollTop = rightScroll;
  if (state.viewMode === VIEW_MODES.RECENT) return;
  hydrationController.sync({
    mode: hydrationMode,
    priorityLocations: priorityLocation ? [priorityLocation] : [],
  });
}

function focusFriendInstance(friend) {
  if (!friend || !friendIsOnline(friend)) return;
  const location = resolveFriendLocation(friend);
  if (!location || location === 'offline') return;

  const targetTab = state.favorites.has(friend.id) ? TABS.FAVORITE_PLUS : TABS.ALL;
  state.viewMode = VIEW_MODES.INSTANCES;
  state.tab = targetTab;
  applyMainSortOptions();
  persistUiPreferences();
  updateTabButtons();
  const targetEntry = filterAndSortInstances(state.instances, state, friendMap())
    .find((entry) => entry.location === location);

  clearInstanceHighlight();
  if (!targetEntry) {
    render({ resetScroll: false });
    showActionToast(
      targetTab === TABS.FAVORITE_PLUS
        ? t('このフレンドのインスタンスはFavorite+には表示されません')
        : t('このフレンドのインスタンスは「すべて」には表示されません'),
      { delay: 3200 },
    );
    return;
  }

  // Mark the target before rendering so the card is painted with the
  // highlight from its first frame. Bulk hydration is suppressed for this
  // focus transition; only the target instance may issue a detail request.
  state.highlight.location = location;
  state.highlight.until = Date.now() + 1000;
  render({
    resetScroll: false,
    hydrationMode: 'focus',
    priorityLocation: location,
  });

  // Deterministic positioning after the DOM is committed. Use an immediate
  // center first, then one more frame in case the browser has not completed
  // layout yet. The highlighted card itself re-centers again if its async
  // hydration replaces the DOM node.
  requestAnimationFrame(() => {
    scrollInstanceCardIntoView(location, 'auto');
    requestAnimationFrame(() => scrollInstanceCardIntoView(location, 'auto'));
  });

  scheduleHighlightClear(location);

  // Resume ordinary lazy hydration only after the one-second highlight has
  // finished, so the focus operation cannot be destabilized by a bulk burst
  // of requests. This does not refetch friends/favorites/groups.
  if (state.highlight.resumeTimer) clearTimeout(state.highlight.resumeTimer);
  state.highlight.resumeTimer = setTimeout(() => {
    state.highlight.resumeTimer = null;
    hydrationController.sync();
  }, CONFIG.FOCUS_HYDRATION_DELAY_MS);
}

function updateLoadedAtLabel() {
  if (!elements.updatedAt) return;
  if (!state.lastLoadedAt) {
    elements.updatedAt.textContent = t('更新: --:--:--');
    elements.updatedAt.title = t('最終更新');
    return;
  }

  const date = new Date(state.lastLoadedAt);
  const time = [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
  const label = lt`更新: ${time}`;
  elements.updatedAt.textContent = label;
  elements.updatedAt.title = state.dataFromCache ? lt`${label}（一部キャッシュ）` : label;
}

async function refreshGroupDataInBackground(userId, dataRepository, generation) {
  const current = () => generation === state.loadGeneration && !dataRepository.disposed;
  try {
    const groupInstances = await dataRepository.fetchGroupInstances(userId);
    if (!current()) return;
    state.groupLoadFailed = Boolean(dataRepository.groupInstancesError);
    if (state.groupLoadFailed) setStatus(readFailureMessage('groups', dataRepository.groupInstancesError), true);
    const previous = new Map(state.instances.map(entry => [entry.location, entry]));
    state.instances = buildLocations(
      createFriendLocationMap(state.friends),
      groupInstances,
      locationCacheReader,
    );
    state.instances = state.instances.map(entry => {
      const old = previous.get(entry.location);
      if (!old) return entry;
      if (old.instanceData) mergeInstanceData(entry, old.instanceData);
      return { ...entry, world: old.world || entry.world,
        ownerUser: old.ownerUser, ownerUserLoaded: old.ownerUserLoaded,
        instanceFetchFailed: old.instanceFetchFailed, worldFetchFailed: old.worldFetchFailed,
        groupName: old.groupName || entry.groupName };
    });
    const focusRemaining = Math.max(0, state.highlight.until - Date.now());
    if (state.highlight.location && focusRemaining > 0) {
      setTimeout(() => {
        if (current() && state.highlight.location) render();
      }, focusRemaining + 16);
    } else {
      render();
    }
    state.dataFromCache = Boolean(dataRepository.usedStaleFallback);
    updateLoadedAtLabel();

    const missingGroupIds = [...new Set(
      state.instances
        .filter((entry) => entry.groupId && !entry.groupName)
        .map((entry) => entry.groupId),
    )].slice(0, CONFIG.MAX_GROUP_LOOKUPS);

    // Group name lookups are deliberately fire-and-update. Do not keep the
    // whole UI in a loading state while up to 100 group requests run.
    await mapWithConcurrency(
      missingGroupIds,
      async (groupId) => {
        if (!current()) return;
        const group = await dataRepository.fetchGroup(groupId);
        if (!current()) return;
        const id = group?.groupId || group?.id;
        const name = group?.name || group?.shortCode || '';
        if (!id || !name) return;

        // A single VRChat Group can have multiple active instances. The lookup
        // is deduplicated by groupId, so fan the resolved name out to every
        // matching instance instead of updating only the first card.
        const matchingEntries = state.instances.filter((candidate) => candidate.groupId === id);
        if (!matchingEntries.length) return;
        matchingEntries.forEach((entry) => {
          entry.groupName = name;
          replaceCardInDom(entry);
        });
      },
      CONFIG.GROUP_LOOKUP_CONCURRENCY,
    );
  } catch (error) {
    if (!current() || error?.name === 'AbortError') return;
    if (error?.status === 401) throw error;
    state.groupLoadFailed = true;
    setStatus(readFailureMessage('groups', error), true);
    console.warn('Could not refresh group instances:', error);
  }
}

async function ensureApiUserAgentRule() {
  if (!globalThis.chrome?.runtime?.sendMessage) return false;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'ENSURE_API_USER_AGENT_RULE' });
    return Boolean(response?.installed);
  } catch {
    // User-Agent identification is important for VRChat API usage, but a
    // browser/runtime that cannot register the rule should not make the UI
    // itself unusable. The API request path remains otherwise unchanged.
    return false;
  }
}



function createDebugData() {
  const count = Math.max(1, Math.floor(Number(CONFIG.DEBUG_FRIEND_COUNT) || 20));
  const favoriteCount = Math.min(count, Math.max(0, Math.floor(Number(CONFIG.DEBUG_FAVORITE_COUNT) || 2)));
  const specs = [
    { kind: 'public', count, worldNumber: 1, region: 'jp', name: `Debug Public World (${count} Friends)` },
    { kind: 'group', count, worldNumber: 2, region: 'us', name: 'Debug Group World' },
    { kind: 'private', count, worldNumber: 3, region: 'jp', name: 'Private' },
  ];
  let nextFriendNumber = 0;
  const favorites = new Set();
  const favoriteGroupMembers = [new Set(), new Set(), new Set()];
  const friends = [];
  const instances = specs.map((spec, specIndex) => {
    const worldId = `wrld_00000000-0000-0000-0000-${String(spec.worldNumber).padStart(12, '0')}`;
    const ownerNumber = nextFriendNumber + 1;
    const ownerId = `usr_00000000-0000-0000-0000-${String(ownerNumber).padStart(12, '0')}`;
    const groupId = 'grp_00000000-0000-0000-0000-000000000001';
    const instanceId = spec.kind === 'group'
      ? `debug-group-002~group(${groupId})~groupAccessType(public)~region(${spec.region})`
      : `debug-${String(spec.worldNumber).padStart(3, '0')}~region(${spec.region})`;
    const location = spec.kind === 'private' ? 'private' : `${worldId}:${instanceId}`;
    const members = Array.from({ length: spec.count }, (_, offset) => {
      const number = ++nextFriendNumber;
      const friend = {
        id: `usr_00000000-0000-0000-0000-${String(number).padStart(12, '0')}`,
        displayName: `Debug Friend ${String(number).padStart(2, '0')}`,
        username: `debug_friend_${String(number).padStart(2, '0')}`,
        status: number % 11 === 0 ? 'join me' : number % 7 === 0 ? 'busy' : 'active',
        location,
      };
      // Keep Favorite counts deterministic for layout/filter testing.
      if (offset < favoriteCount) {
        favorites.add(friend.id);
        favoriteGroupMembers[specIndex]?.add(friend.id);
      }
      friends.push(friend);
      return friend;
    });
    if (spec.kind === 'private') {
      return {
        debug: true, location, source: 'friend', friends: members,
        worldId: 'private', permission: PERMISSIONS.PRIVATE,
        permissionLabel: permissionLabel(PERMISSIONS.PRIVATE),
      };
    }
    const capacity = Math.max(80, spec.count);
    const instanceData = {
      id: instanceId, instanceId, worldId,
      ownerId: spec.kind === 'group' ? groupId : ownerId,
      photonRegion: spec.region, n_users: spec.count, capacity,
      users: members,
    };
    if (spec.kind === 'group') {
      instanceData.type = 'group';
      instanceData.groupAccessType = 'public';
      instanceData.groupName = 'Debug Group';
    }
    return {
      debug: true, location, source: 'friend', friends: members,
      worldId, instanceId, region: spec.region,
      permission: spec.kind === 'group' ? PERMISSIONS.GROUP_PUBLIC : PERMISSIONS.PUBLIC,
      permissionLabel: permissionLabel(spec.kind === 'group' ? PERMISSIONS.GROUP_PUBLIC : PERMISSIONS.PUBLIC),
      ownerId: spec.kind === 'group' ? undefined : ownerId,
      groupId: spec.kind === 'group' ? groupId : undefined,
      groupName: spec.kind === 'group' ? 'Debug Group' : '',
      groupAccessType: spec.kind === 'group' ? 'public' : undefined,
      users: spec.count, capacity, instanceData,
      world: {
        id: worldId, name: spec.name, capacity, hardCapacity: capacity,
        thumbnailImageUrl: '',
      },
    };
  });
  const favoriteGroups = ['group_0', 'group_1', 'group_2'].map((name, index) => ({
    name,
    displayName: `Favorite List ${index + 1}`,
    memberIds: favoriteGroupMembers[index],
  }));
  return { friends, favorites, favoriteGroups, instances };
}

function loadDebugData() {
  const debug = createDebugData();
  state.user = {
    id: 'usr_00000000-0000-0000-0000-999999999999',
    displayName: 'Debug Mode',
    username: 'debug_mode',
  };
  state.onlineFriends = debug.friends;
  setFriendState(debug.friends);
  state.favorites = debug.favorites;
  state.favoriteRecords = new Map();
  setFavoriteGroupState(debug.favoriteGroups);
  state.instances = debug.instances;
  initializeDemoWorldFavorites(debug.instances);
  state.lastLoadedAt = Date.now();
  state.dataFromCache = false;
  elements.login?.classList.add('hidden');
  render();
  updateLoadedAtLabel();
  setStatus(lt`DEBUG MODE: 各${Math.max(1, Math.floor(Number(CONFIG.DEBUG_FRIEND_COUNT) || 20))}人・Favorite ${CONFIG.DEBUG_FAVORITE_COUNT}人 / 3インスタンス（Public・Group・Private）`);
}

function clearDisplayedData() {
  state.recent = { account: '', rows: [], ready: false, loading: false, error: false, token: state.recent.token + 1 };
  worldFavorites = null;
  worldCatalog=new WorldCatalog(); worldView={selected:'recent',loading:false,error:false,token:worldView.token+1,editor:null};
  state.favoriteGroupEditor = null;
  state.favoriteMutationPending = false;
  actionToast.clearUndo(); state.favoriteUndo = null;
  state.offlineLoadToken += 1;
  state.offlineProfiles.clear();
  state.offlineNameLoad = { loading: false, failed: false, loaded: 0, total: 0 };
  state.collapsedFriendGroups.add('ungrouped-offline');
  renderOfflineSearchStatus();
  state.onlineFriends = [];
  state.privateCollapsed = true;
  hideFriendInstancePreview({ immediate: true });
  closeFavoriteMenu();
  clearInstanceHighlight();
  hydrationController.reset();
  disconnectSidebarHydrationObserver();
  state.instances = [];
  setFriendState([]);
  state.favorites = new Set();
  state.favoriteRecords = new Map();
  setFavoriteGroupState([]);
  state.lastLoadedAt = 0;
  state.user = null;
  elements.list.replaceChildren();
  elements.friendList.replaceChildren();
  imageController.reset(); imageFallbacks.clear();
  elements.friendCount.textContent = '0 / 0';
  elements.friendCount.title = t('表示中 / 表示対象総数');
  elements.friendCount.setAttribute('aria-label', t('表示中 0人 / 表示対象総数 0人'));
  updateLoadedAtLabel();
}

function handleSessionExpired() {
  hideActionToast();
  state.loadGeneration += 1;
  repository.dispose();
  state.loading = false;
  if (elements.reloadButton) elements.reloadButton.disabled = false;
  clearDisplayedData();
  elements.login?.classList.remove('hidden');
  setStatus(t('VRChatのログインセッションが無効です。VRChat公式サイトで再ログインしてください。'), true);
}

async function load({ reason = 'initial', preserveToast = false } = {}) {
  const notify = reason !== 'initial';
  if (CONFIG.DEBUG_MODE) {
    loadDebugData();
    return;
  }
  if (state.loading || state.favoriteMutationPending || state.pendingInvites.size) return;
  state.favoriteGroupEditor = null;
  actionToast.setUndoBusy(true);
  state.offlineLoadToken += 1;
  repository.dispose();
  repository = new DataRepository(new VrchatApiClient(), uiStorage);
  const dataRepository = repository;
  const generation = ++state.loadGeneration;
  const current = () => generation === state.loadGeneration && !dataRepository.disposed;
  hydrationController.reset();
  state.recent.token += 1; state.recent.loading = false; worldView.token++; worldView.loading=false;
  state.loading = true;
  state.loadFailed = false;
  state.groupLoadFailed = false;
  if (elements.reloadButton) elements.reloadButton.disabled = true;
  if (['manual', 'cache', 'restore'].includes(reason)) scheduleAutoRefresh();
  state.dataFromCache = false;
  state.lastLoadedAt = 0;
  dataRepository.usedStaleFallback = false;
  elements.login?.classList.add('hidden');
  if (notify) {
    setStatus('');
    if (!preserveToast) showActionToast(reason === 'automatic'
      ? t('自動更新しています…') : t('情報を更新しています…'), { delay: 0 });
  } else {
    setStatus(t('VRChatログインセッションを確認中…'));
  }

  try {
    // Authentication must complete before any account-scoped cache can be used.
    const user = await dataRepository.fetchMe();
    if (!current()) return;
    if (state.user?.id && state.user.id !== user.id) clearDisplayedData();
    const previousWorlds = worldFavorites;
    state.recent.token += 1; state.recent.loading = false; worldView.token++; worldView.loading=false;
    state.user = user;
    worldFavorites = new WorldFavorites(dataRepository.api);
    worldFavorites.account = user.id;
    if (previousWorlds?.account === user.id) {
      worldFavorites.groups = previousWorlds.groups; worldFavorites.records = previousWorlds.records;
      worldFavorites.ready = previousWorlds.ready; worldFavorites.updatedAt = previousWorlds.updatedAt;
    }


    // Do not paint stale cached lists first. Fetch the time-sensitive primary
    // datasets first so the first interactive render reflects current data (or
    // a same-account fallback only when the live request fails).
    if (!notify) setStatus(t('フレンド情報を更新中…'));
    const [friends, favoriteState] = await Promise.all([
      dataRepository.fetchFriends(),
      dataRepository.fetchFavorites(),
    ]);

    if (!current()) return;
    state.onlineFriends = normalizeFriends(friends);
    state.offlineProfiles.clear();
    applyFavoriteState(favoriteState);
    void refreshWorldFavorites(generation, worldFavorites, ['manual', 'cache'].includes(reason));
    state.instances = buildLocations(
      createFriendLocationMap(state.friends),
      [],
      locationCacheReader,
    );

    state.lastLoadedAt = dataRepository.primaryDataUpdatedAt || Date.now();
    // Repository exposes whether a primary dataset had to fall back to stale
    // same-account data. Keep that information visible without blocking the UI.
    state.dataFromCache = Boolean(dataRepository.usedStaleFallback);
    state.loading = false;
    render();
    if (state.viewMode === VIEW_MODES.RECENT && reason !== 'automatic') void loadWorldView();
    updateLoadedAtLabel();
    setStatus('');
    if (notify) {
      const message = reason === 'automatic' ? t('フレンド情報を自動更新しました') : t('フレンド情報を更新しました');
      showActionToast(message + (state.dataFromCache ? t('（一部キャッシュ）。') : '。'), { delay: 2800 });
    }

    void loadOfflineFriendProfiles();

    // Group Instances are secondary data for this screen. Load them after the
    // first interactive paint so tab switching and friend clicks remain
    // responsive even while group data is being fetched.
    void refreshGroupDataInBackground(user.id, dataRepository, generation).catch((error) => {
      if (current() && error?.status === 401) handleSessionExpired();
    });
  } catch (error) {
    if (!current() || error?.name === 'AbortError') return;
    if (error?.status === 401) handleSessionExpired();
    else {
      state.loadFailed = true;
      const message = readFailureMessage('friends', error);
      setStatus(message, true);
      if (notify) showActionToast(message, { error: true, delay: 5600 });
      console.warn('Could not load primary data:', error);
    }
  } finally {
    if (generation === state.loadGeneration) { state.loading = false; actionToast.setUndoBusy(false); }
    updateReloadButton();
  }
}

async function mapWithConcurrency(items, worker, concurrency = 2) {
  const output = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  async function run() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      try {
        output[index] = await worker(items[index], index);
      } catch {
        output[index] = null;
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, run));
  return output;
}

function onFriendListClick(event) {
  if (event.target.closest('.favorite-action-button')) return;
  const item = event.target.closest('.friend-item');
  if (!item || !elements.friendList.contains(item)) return;
  suppressSidebarFriendPreviewUntilLeave(item.dataset.friendId);
  focusFriendInstance(state.friends.find((friend) => friend.id === item.dataset.friendId));
}

function onFriendListKeydown(event) {
  if (event.target.closest('.favorite-action-button')) return;
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const item = event.target.closest('.friend-item');
  if (!item) return;
  event.preventDefault();
  focusFriendInstance(state.friends.find((friend) => friend.id === item.dataset.friendId));
}

document.querySelectorAll('.tab').forEach((button) => {
  button.addEventListener('click', () => {
    clearInstanceHighlight();
    if (button.dataset.view === VIEW_MODES.FRIENDS) {
      setFriendView();
      return;
    }
    setActiveTab(button.dataset.filter || TABS.FAVORITE_PLUS);
  });
});

elements.sort?.addEventListener('change', () => {
  if (state.viewMode === VIEW_MODES.FRIENDS) {
    state.friendViewSort = Object.values(FRIEND_VIEW_SORTS).includes(elements.sort.value)
      ? elements.sort.value
      : FRIEND_VIEW_SORTS.NAME;
  } else {
    state.sort = Object.values(SORTS).includes(elements.sort.value)
      ? elements.sort.value
      : SORTS.FRIENDS_DESC;
  }
  persistUiPreferences();
  render();
});

document.querySelectorAll('.instance-size-button').forEach((button) => {
  button.addEventListener('click', () => {
    const size = button.dataset.instanceSize;
    if (!['small', 'medium', 'large'].includes(size) || size === state.instanceSize) return;
    state.instanceSize = size;
    applyInstanceSize();
    persistUiPreferences();
    render({ resetScroll: false });
  });
});

elements.instanceDisplay?.addEventListener('change', () => {
  state.instanceDisplay = ['simple', 'normal'].includes(elements.instanceDisplay.value)
    ? elements.instanceDisplay.value
    : 'normal';
  applyInstanceDisplay();
  persistUiPreferences();
});

document.querySelectorAll('.theme-button').forEach((button) => {
  button.addEventListener('click', () => {
    const theme = button.dataset.theme;
    if (!['light', 'sand', 'mist', 'ash', 'dark-blue', 'dark'].includes(theme) || theme === state.theme) return;
    state.theme = theme;
    applyTheme();
    persistUiPreferences();
  });
});

elements.friendSort?.addEventListener('change', () => {
  state.friendSort = ['name', 'favorite_list'].includes(elements.friendSort.value)
    ? elements.friendSort.value
    : 'name';
  persistUiPreferences();
  renderFriendSidebar();
});

elements.autoRefresh?.addEventListener('change', () => {
  const minutes = Number(elements.autoRefresh.value);
  state.autoRefreshMinutes = [5, 10, 30].includes(minutes) ? minutes : 0;
  persistUiPreferences();
  scheduleAutoRefresh();
});

elements.settingsButton?.addEventListener('click', () => {
  toggleSettingsPanel();
});

elements.sidebarToggle?.addEventListener('click', () => {
  toggleFriendSidebar();
});

document.addEventListener('click', onFavoriteUiClick, true);

// Let the original click finish before rendering removes the editor's DOM.
// This preserves the clicked control's action and focus.
document.addEventListener('click', (event) => {
  const editor = state.favoriteGroupEditor;
  if (!editor || editor.saving || event.target.closest('[data-group-editor], [data-group-edit]')) return;
  queueMicrotask(() => {
    if (state.favoriteGroupEditor === editor && !editor.saving) {
      closeFavoriteGroupEditor({ restoreFocus: false });
    }
  });
}, true);

document.addEventListener('click', (event) => {
  if (elements.settingsPanel?.classList.contains('hidden')) return;
  if (event.target.closest('.toolbar-options') || elements.settingsPanel.contains(event.target)) return;
  setSettingsPanelOpen(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!elements.favoriteMenu?.classList.contains('hidden')) {
    closeFavoriteMenu({ restoreFocus: true });
    return;
  }
  if (elements.settingsPanel?.classList.contains('hidden')) return;
  setSettingsPanelOpen(false);
  elements.settingsButton?.focus();
});

function bindSearch(input, callback) {
  let composing = false;
  input?.addEventListener('compositionstart', () => { composing = true; });
  input?.addEventListener('compositionend', () => { composing = false; resetDisplayLimits(); callback(); });
  input?.addEventListener('input', event => { if (!composing && !event.isComposing) { resetDisplayLimits(); callback(); } });
}
bindSearch(elements.friendSearch, renderFriendSidebar);
elements.showNonFriendOwners?.addEventListener('change', () => {
  state.showNonFriendOwners = elements.showNonFriendOwners.checked;
  persistUiPreferences(); render({resetScroll:false});
  if (state.friendPreview.location) renderFriendInstancePreview(getCurrentInstanceEntry(state.friendPreview.location));
});
elements.offlineSort?.addEventListener('change', () => {
  state.offlineSort = elements.offlineSort.value;
  resetDisplayLimits(); persistUiPreferences(); render();
});
for (const root of [elements.friendList, elements.list]) {
  root?.addEventListener('click', event => {
    const button = event.target.closest('[data-load-more]');
    if (!button) return;
    const key = button.dataset.loadMore;
    const previous = state.displayLimits.get(key) || CONFIG.DISPLAY_BATCH_SIZE;
    state.displayLimits.set(key, previous + CONFIG.DISPLAY_BATCH_SIZE);
    if (key === 'sidebar') renderFriendSidebar(); else render();
    // Keep keyboard navigation at the beginning of the newly revealed batch.
    const items = key === 'sidebar' ? root.querySelectorAll('.friend-item')
      : (root.querySelector(key === 'ungrouped-offline' ? '[data-offline-section]' : `[data-favorite-group="${key}"]`)?.querySelectorAll('.friend-location-item') || []);
    const focusTarget = items[previous]?.matches('.friend-item') ? items[previous] : items[previous]?.querySelector('a, button');
    focusTarget?.focus({ preventScroll: true });
  });
}
elements.friendFilter?.addEventListener('change', () => {
  resetDisplayLimits();
  state.requestedFriendFilter = elements.friendFilter.value || 'favorite';
  persistUiPreferences();
  renderFriendSidebar();
});
elements.showOnWebsite?.addEventListener('change', () => {
  persistUiPreferences();
  renderFriendSidebar();
  if (state.viewMode === VIEW_MODES.FRIENDS) render({ resetScroll: false });
});
elements.showOffline?.addEventListener('change', () => {
  state.offlineLoadToken += 1;
  state.offlineNameLoad.loading = false;
  if (elements.showOffline.checked) state.collapsedFriendGroups.add('ungrouped-offline');
  persistUiPreferences();
  rebuildDisplayedFriends();
  hideFriendInstancePreview({ immediate: true });
  render({ resetScroll: false });
  void loadOfflineFriendProfiles();
});
elements.clearFriendSearch?.addEventListener('click', () => {
  if (!elements.friendSearch) return;
  resetDisplayLimits();
  elements.friendSearch.value = '';
  elements.friendSearch.focus();
  renderFriendSidebar();
});
elements.friendList?.addEventListener('click', onFriendListClick);
elements.friendList?.addEventListener('mouseover', onFriendSidebarMouseOver);
elements.friendList?.addEventListener('mousemove', onFriendSidebarMouseMove, { passive: true });
elements.friendList?.addEventListener('mouseout', onFriendSidebarMouseOut);
elements.friendList?.addEventListener('mouseleave', onFriendSidebarMouseLeave);
elements.friendList?.addEventListener('scroll', () => hideFriendInstancePreview({ immediate: true }), { passive: true });
elements.list?.addEventListener('keydown',event=>{
  const tab=event.target.closest('[data-world-tab]');if(!tab || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  const tabs=[...elements.list.querySelectorAll('[data-world-tab]')],i=tabs.indexOf(tab);
  const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(i+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
  event.preventDefault();tabs[next].focus();tabs[next].click();
});
elements.list?.addEventListener('click', onWorldViewClick);
elements.friendInstancePreview?.addEventListener('click', onWorldViewClick);
elements.list?.addEventListener('submit', event=>{void saveWorldListName(event)});
elements.list?.addEventListener('input', event=>{if(event.target.matches('.world-list-name') && worldView.editor && !worldView.editor.saving){worldView.editor.draft=event.target.value;event.target.closest('form').querySelector('.world-name-count').textContent=`${event.target.value.length} / 20`;}});
elements.list?.addEventListener('keydown',event=>{if(event.target.closest('[data-world-list-editor]')){if(event.key==='Escape'&&!event.isComposing&&!worldView.editor?.saving){event.preventDefault();worldView.editor=null;render();}if(event.key==='Enter'&&event.isComposing)event.preventDefault();}});
document.addEventListener('click',event=>{const editor=worldView.editor;if(!editor||editor.saving||event.target.closest('[data-world-list-editor],[data-world-edit]'))return;queueMicrotask(()=>{if(editor===worldView.editor){worldView.editor=null;render()}})},true);
elements.list?.addEventListener('click', onFriendViewControlClick);
elements.list?.addEventListener('submit', event => { void saveFavoriteGroupName(event); });
elements.list?.addEventListener('input', event => {
  if (!event.target.matches('.favorite-group-name-input') || !state.favoriteGroupEditor || state.favoriteGroupEditor.saving) return;
  state.favoriteGroupEditor.draft = event.target.value;
  const form = event.target.closest('[data-group-editor]');
  form.querySelector('.favorite-group-name-count').textContent = `${event.target.value.length} / ${CONFIG.FAVORITE_GROUP_NAME_MAX_LENGTH}`;
  if (!state.favoriteGroupEditor.outcomeUnknown) {
    state.favoriteGroupEditor.error = ''; form.querySelector('.favorite-group-editor-error').hidden = true;
  }
});
elements.list?.addEventListener('keydown', event => {
  if (!event.target.closest('[data-group-editor]')) return;
  if (event.key === 'Escape' && !event.isComposing && !state.favoriteGroupEditor?.saving) {
    event.preventDefault(); event.stopPropagation(); closeFavoriteGroupEditor();
  }
  if (event.key === 'Enter' && event.isComposing) event.preventDefault();
});
elements.list?.addEventListener('click', onInviteMeClick);
elements.list?.addEventListener('mouseover', onFriendLocationMouseOver);
elements.list?.addEventListener('mousemove', onFriendLocationMouseMove, { passive: true });
elements.list?.addEventListener('mouseout', onFriendLocationMouseOut);
elements.list?.addEventListener('scroll', () => hideFriendInstancePreview({ immediate: true }), { passive: true });
elements.friendInstancePreview?.addEventListener('mouseenter', () => clearFriendPreviewTimer('close'));
elements.friendInstancePreview?.addEventListener('mouseleave', () => hideFriendInstancePreview());
elements.friendInstancePreview?.addEventListener('click', onInviteMeClick);
elements.favoriteMenu?.addEventListener('mouseenter', onFavoriteMenuMouseEnter);
elements.favoriteMenu?.addEventListener('mouseleave', onFavoriteMenuMouseLeave);
window.addEventListener('resize', () => {
  hideFriendInstancePreview({ immediate: true });
  closeFavoriteMenu();
});
elements.friendList?.addEventListener('keydown', onFriendListKeydown);
elements.loginButton?.addEventListener('click', () => {
  window.open(CONFIG.LOGIN_URL, '_blank', 'noopener,noreferrer');
});

elements.recentButton?.addEventListener('click', setRecentView);

function updateReloadButton() {
  if (elements.reloadButton) elements.reloadButton.disabled = Boolean(state.loading || worldView.loading || state.recent.loading);
}

async function refreshCurrentView() {
  if (state.loading || worldView.loading || state.recent.loading) return;
  if (state.favoriteMutationPending || state.pendingInvites.size) {
    showActionToast(t('操作の完了後に更新してください。'));
    return;
  }
  const needsPrimaryRetry = !state.user || state.loadFailed || state.groupLoadFailed
    || (elements.showOffline?.checked && state.offlineNameLoad.failed);
  if (!needsPrimaryRetry && state.viewMode === VIEW_MODES.RECENT) { worldView.editor=null; await loadWorldView({ force: true }); return; }
  await load({ reason: 'manual' });
}
elements.reloadButton?.addEventListener('click', refreshCurrentView);
elements.clearCacheButton?.addEventListener('click', async () => {
  if (state.favoriteMutationPending || state.pendingInvites.size) {
    showActionToast(t('操作の完了後にキャッシュを削除してください。'));
    return;
  }
  state.loadGeneration += 1;
  repository.dispose();
  state.loading = false;
  clearDisplayedData();
  imageController.reset();
  const cleared = uiStorage.clearDataCaches();
  // Notify other open Viewer tabs before rebuilding this tab's caches.
  uiStorage.set('vrc_viewer_cache_clear_event', { at: Date.now(), nonce: Math.random() });
  setSettingsPanelOpen(false);
  showActionToast(cleared ? t('キャッシュを削除しました。最新情報を取得します。') : t('一部のキャッシュを削除できませんでした。'), { error: !cleared });
  await load({ reason: 'cache', preserveToast: true });
});
window.addEventListener('storage', event => {
  if (event.key !== 'vrc_viewer_cache_clear_event') return;
  hideActionToast();
  state.loadGeneration += 1;
  // Cancel pending saves before disposing; do not resurrect cleared records.
  uiStorage.objectCaches.forEach(cache => cache.clearMemory());
  repository.dispose();
  state.loading = false;
  clearDisplayedData();
  if (elements.reloadButton) elements.reloadButton.disabled = false;
  setStatus('');
  showActionToast(t('別の画面でキャッシュが削除されました。「更新」で最新情報を取得してください。'), { delay: 8000 });
});
window.addEventListener('pagehide', () => { uiStorage.flush(); repository.dispose(); imagePool.clear(); });
window.addEventListener('pageshow', event => { if (event.persisted) { imageController.reset(); void load({ reason: 'restore' }); } });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearAutoRefreshTimer();
    state.offlineLoadToken += 1;
    state.offlineNameLoad.loading = false;
    renderOfflineSearchStatus();
    uiStorage.flush();
    hydrationController.pause();
    disconnectSidebarHydrationObserver();
    hideFriendInstancePreview({ immediate: true });
  } else {
    scheduleAutoRefresh({ preserveDue: true });
    if (!state.loading && !repository.disposed) {
      hydrationController.sync();
      syncSidebarHydration();
      void loadOfflineFriendProfiles();
    }
  }
});

// Keep the fixed settings dialog outside backdrop-filter containing blocks.
document.body.append(elements.settingsPanel);
captureStaticLabels();
document.getElementById('language').addEventListener('change', event => {
  setLocale(event.target.value);
  persistUiPreferences();
  applyMainSortOptions();
  applySidebarMode();
  renderOfflineSearchStatus();
  updateLoadedAtLabel();
  renderFriendFilterOptions();
  if (state.favoriteGroupEditor?.error) state.favoriteGroupEditor.error = relocalize(state.favoriteGroupEditor.error);
  setStatus(relocalize(elements.status.textContent), elements.status.classList.contains('error'));
  actionToast.message = relocalize(actionToast.message);
  if (actionToast.undo) actionToast.undo.message = relocalize(actionToast.undo.message);
  actionToast.render();
  render({ resetScroll: false });
  positionSettingsPanel();
});
restoreUiPreferences();
persistUiPreferences();
applyMainSortOptions();
updateTabButtons();
scheduleAutoRefresh();
if (!CONFIG.DEBUG_MODE) void ensureApiUserAgentRule();
void load();
