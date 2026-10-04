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
  needsInstanceDetailsForFoaf,
  needsNonFriendOwnerProfile,
  isFoafPresentInEntry,
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
  shouldFetchNonFriendOwner,
  safeImageUrl,
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
  sort: document.getElementById('sort'),
  settingsButton: document.getElementById('settingsButton'),
  settingsPanel: document.getElementById('settingsPanel'),
  friendSort: document.getElementById('friendSort'),
  instanceDisplay: document.getElementById('instanceDisplay'),
  autoRefresh: document.getElementById('autoRefresh'),
  actionToast: document.getElementById('actionToast'),
  friendInstancePreview: document.getElementById('friendInstancePreview'),
  favoriteMenu: document.getElementById('favoriteMenu'),
};

const uiStorage = new JsonStorage();
const repository = new DataRepository(new VrchatApiClient(), uiStorage);

const VIEW_MODES = Object.freeze({
  INSTANCES: 'instances',
  FRIENDS: 'friends',
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
  viewMode: VIEW_MODES.INSTANCES,
  tab: TABS.FAVORITE_PLUS,
  sort: SORTS.FRIENDS_DESC,
  friendViewSort: FRIEND_VIEW_SORTS.NAME,
  instanceSize: 'medium',
  instanceDisplay: 'normal',
  friendSort: 'favorite_list',
  theme: 'dark-blue',
  autoRefreshMinutes: 0,
  autoRefreshTimer: null,
  sidebarMode: 'normal',
  statusTimer: null,
  toastTimer: null,
  user: null,
  favorites: new Set(),
  favoriteRecords: new Map(),
  favoriteGroups: [],
  requestedFriendFilter: 'favorite',
  friends: [],
  friendIndex: new Map(),
  instances: [],
  loading: false,
  highlight: {
    location: '',
    until: 0,
    timer: null,
    resumeTimer: null,
  },
  dataFromCache: false,
  lastLoadedAt: 0,
  collapsedFriendGroups: new Set(['ungrouped']),
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
  },
};

let sidebarHydrationObserver = null;

function readUiPreferences() {
  const prefs = uiStorage.get(CONFIG.UI_PREFERENCES_KEY, {});
  return prefs && typeof prefs === 'object' && !Array.isArray(prefs) ? prefs : {};
}

function persistUiPreferences() {
  uiStorage.set(CONFIG.UI_PREFERENCES_KEY, {
    viewMode: state.viewMode,
    tab: state.tab,
    sort: state.sort,
    friendViewSort: state.friendViewSort,
    instanceSize: state.instanceSize,
    instanceDisplay: state.instanceDisplay,
    friendSort: state.friendSort,
    theme: state.theme,
    autoRefreshMinutes: state.autoRefreshMinutes,
    sidebarMode: state.sidebarMode,
    sidebarCollapsed: state.sidebarMode === 'hidden',
    friendFilter: elements.friendFilter?.value || 'all',
    showOnWebsite: elements.showOnWebsite?.checked !== false,
  });
}

function restoreUiPreferences() {
  const prefs = readUiPreferences();
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
  state.theme = ['light', 'ash', 'dark-blue', 'dark'].includes(prefs.theme)
    ? prefs.theme
    : 'dark-blue';
  state.autoRefreshMinutes = [10, 30].includes(Number(prefs.autoRefreshMinutes))
    ? Number(prefs.autoRefreshMinutes)
    : 0;
  state.sidebarMode = ['normal', 'location', 'hidden'].includes(prefs.sidebarMode)
    ? prefs.sidebarMode
    : prefs.sidebarCollapsed === true
      ? 'hidden'
      : 'normal';
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
  const theme = ['light', 'ash', 'dark-blue', 'dark'].includes(state.theme)
    ? state.theme
    : 'dark-blue';
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  document.body.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === 'light' ? 'light' : 'dark';
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
  if (!elements.sidebarToggle) return;
  elements.sidebarToggle.textContent = hidden ? '›' : location ? '‹' : '»';
  elements.sidebarToggle.setAttribute('aria-expanded', String(!hidden));
  const label = hidden
    ? 'フレンド一覧を表示'
    : location
      ? 'フレンド一覧を隠す'
      : '今居るインスタンスも表示';
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

function setSettingsPanelOpen(open) {
  if (!elements.settingsPanel || !elements.settingsButton) return;
  elements.settingsPanel.classList.toggle('hidden', !open);
  elements.settingsButton.setAttribute('aria-expanded', String(open));
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

function scheduleAutoRefresh() {
  clearAutoRefreshTimer();
  if (![10, 30].includes(state.autoRefreshMinutes)) return;
  const delayMs = state.autoRefreshMinutes * 60 * 1000;
  state.autoRefreshTimer = setTimeout(async () => {
    state.autoRefreshTimer = null;
    if (state.loading) {
      scheduleAutoRefresh();
      return;
    }
    await load();
    scheduleAutoRefresh();
  }, delayMs);
}

function friendMap() {
  return state.friendIndex;
}

function setFriendState(friends) {
  state.friends = Array.isArray(friends) ? friends : [];
  state.friendIndex = new Map(state.friends.map((friend) => [friend.id, friend]));
}

function setFavoriteGroupState(groups) {
  state.favoriteGroups = Array.isArray(groups) ? groups.slice(0, 3) : [];
  renderFriendFilterOptions();
}

function applyFavoriteState(favoriteState) {
  state.favorites = favoriteState?.ids instanceof Set ? favoriteState.ids : new Set();
  state.favoriteRecords = favoriteState?.records instanceof Map ? favoriteState.records : new Map();
  setFavoriteGroupState(favoriteState?.groups || []);
}

function favoriteGroupForUser(userId) {
  return state.favoriteGroups.find((group) => group?.memberIds?.has(userId))?.name || '';
}

function renderFavoriteActionButton(userId, extraClass = '') {
  if (!userId || !state.friendIndex.has(userId)) return '';
  const isFavorite = state.favorites.has(userId);
  const label = isFavorite ? 'Favoriteを編集' : 'Favoriteに追加';
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

  elements.friendFilter.innerHTML = `
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

function clearStatusTimer() {
  if (!state.statusTimer) return;
  clearTimeout(state.statusTimer);
  state.statusTimer = null;
}

function setStatus(message, error = false) {
  if (!elements.status) return;
  clearStatusTimer();
  const text = String(message || '').trim();
  elements.status.textContent = text;
  elements.status.classList.toggle('error', Boolean(error));
  elements.statusRow?.classList.toggle('hidden', !text);
}

function setTransientStatus(message, { error = false, delay = 2800 } = {}) {
  setStatus(message, error);
  if (!message || error) return;
  state.statusTimer = setTimeout(() => {
    state.statusTimer = null;
    if (elements.status?.textContent === message) setStatus('');
  }, delay);
}

function clearActionToastTimer() {
  if (!state.toastTimer) return;
  clearTimeout(state.toastTimer);
  state.toastTimer = null;
}

function hideActionToast() {
  clearActionToastTimer();
  if (!elements.actionToast) return;
  elements.actionToast.classList.remove('is-visible', 'error');
  elements.actionToast.textContent = '';
}

function showActionToast(message, { error = false, delay = 2800 } = {}) {
  if (!elements.actionToast) return;
  clearActionToastTimer();
  const text = String(message || '').trim();
  if (!text) {
    hideActionToast();
    return;
  }
  elements.actionToast.textContent = text;
  elements.actionToast.classList.toggle('error', Boolean(error));
  elements.actionToast.classList.add('is-visible');
  if (delay > 0) {
    state.toastTimer = window.setTimeout(() => {
      state.toastTimer = null;
      if (elements.actionToast?.textContent === text) hideActionToast();
    }, delay);
  }
}

function applyMainSortOptions() {
  if (!elements.sort) return;
  if (state.viewMode === VIEW_MODES.FRIENDS) {
    elements.sort.innerHTML = `
      <option value="name">名前順</option>
      <option value="location">居場所順</option>`;
    elements.sort.value = Object.values(FRIEND_VIEW_SORTS).includes(state.friendViewSort)
      ? state.friendViewSort
      : FRIEND_VIEW_SORTS.NAME;
    elements.sort.setAttribute('aria-label', 'フレンド表示の並び順');
  } else {
    elements.sort.innerHTML = `
      <option value="friends_desc">フレンドが多い順</option>
      <option value="users_desc">参加人数が多い順</option>`;
    elements.sort.value = Object.values(SORTS).includes(state.sort)
      ? state.sort
      : SORTS.FRIENDS_DESC;
    elements.sort.setAttribute('aria-label', 'インスタンスの並び順');
  }
}

function updateTabButtons() {
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

function getFriendSidebarRows() {
  const filter = elements.friendFilter?.value || 'all';
  const query = String(elements.friendSearch?.value || '').trim().toLocaleLowerCase('ja-JP');

  const filtered = state.friends.filter((friend) => {
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
    const haystack = [friend.displayName, friend.username, friend.id]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('ja-JP');
    return haystack.includes(query);
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
      return compareFriendNames(a, b);
    });
  }

  if (filter === 'all' || filter === 'joinable') {
    return filtered.sort((a, b) => {
      const favoriteDifference = Number(state.favorites.has(b.id)) - Number(state.favorites.has(a.id));
      if (favoriteDifference) return favoriteDifference;
      return compareFriendNames(a, b);
    });
  }

  return filtered.sort(compareFriendNames);
}

function friendAvatarUrl(friend) {
  return safeImageUrl(
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
    ? safeImageUrl(entry.world?.thumbnailImageUrl || entry.instanceData?.world?.thumbnailImageUrl || entry.instanceData?.world?.imageUrl || '')
    : '';
  const thumbContent = thumb
    ? `<img class="friend-sidebar-location-thumb-image" src="${escapeHtml(thumb)}" loading="lazy" decoding="async" alt="">`
    : `<div class="friend-sidebar-location-thumb-placeholder friend-location-thumb-placeholder">${renderFriendLocationPlaceholderIcon({ isPrivate, isWebsite })}</div>`;
  const statusText = isWebsite
    ? 'Other Platform'
    : isPrivate
      ? 'Private'
      : permissionLabel(permission);

  return `
    <div class="friend-sidebar-location-thumb" title="${escapeHtml(locationTitle)}">
      ${thumbContent}
      <div class="friend-sidebar-location-meta">
        <span class="friend-state friend-sidebar-location-status ${permissionClass}">${escapeHtml(statusText)}</span>
        ${countText ? `<span class="friend-sidebar-location-count" title="フレンド数 / 参加人数 / 最大人数">${escapeHtml(countText)}</span>` : ''}
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
    ? `<img class="friend-avatar" src="${escapeHtml(avatarUrl)}" alt="">`
    : '<div class="friend-avatar"></div>';
  const showLocation = state.sidebarMode === 'location';
  const locationData = !isWebsite && !isPrivate && location && location !== 'offline'
    ? ` data-location="${escapeHtml(entry?.location || location)}"`
    : '';
  const loadingClass = showLocation && entry && needsHydration(entry)
    ? ' friend-sidebar-location-loading'
    : '';
  const noPreviewClass = isWebsite || isPrivate ? ' friend-sidebar-no-preview' : '';

  return `
    <div class="friend-item${loadingClass}${noPreviewClass}" data-friend-id="${escapeHtml(friend.id)}"${locationData} tabindex="0" role="button" aria-label="${escapeHtml(name)}">
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
  if (state.sidebarMode !== 'location' || !elements.friendList) return;

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

function scheduleSidebarHydrationSync() {
  queueMicrotask(() => syncSidebarHydration());
}

function renderFriendSidebar() {
  if (!elements.friendList || !elements.friendCount) return;
  disconnectSidebarHydrationObserver();
  const previousScroll = elements.friendList.scrollTop;
  const rows = getFriendSidebarRows();

  const visibleCount = rows.length;
  const onlineFriendCount = state.friends.length;
  elements.friendCount.textContent = `${visibleCount} / ${onlineFriendCount}`;
  elements.friendCount.setAttribute(
    'aria-label',
    `表示中 ${visibleCount}人 / オンラインフレンド総数 ${onlineFriendCount}人`,
  );
  elements.friendList.innerHTML = rows.map(renderFriendSidebarItem).join('');
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
    if (replacement) node.replaceWith(replacement);
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
  if (status.className === 'online-website') return 'Other Platform';
  const location = resolveFriendLocation(friend);
  const permission = entry?.permission || classifyPermission(location);
  if (permission === PERMISSIONS.PRIVATE || location === 'private') return 'Private';
  const worldName = entry?.world?.name || entry?.instanceData?.world?.name || '';
  if (worldName) return worldName;
  if (entry?.worldId && entry.worldId !== 'offline' && entry.worldId !== 'private') return 'ワールド情報を取得中…';
  return permissionLabel(permission);
}

function friendLocationSortKey(friend) {
  const entry = reverseEntryForFriend(friend);
  const status = onlineStatusInfo(friend);
  const location = resolveFriendLocation(friend);
  const permission = entry?.permission || classifyPermission(location);

  // 居場所順は、通常インスタンスをワールド名順で先に表示し、
  // その後に Private、最後に Other Platform を並べる。
  if (status.className === 'online-website') {
    return '2\u0000Other Platform';
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
    return rows.sort((a, b) => friendLocationSortKey(a).localeCompare(friendLocationSortKey(b), 'ja') || compareFriendNames(a, b));
  }
  return rows.sort(compareFriendNames);
}

function getReverseFriendGroups() {
  const showOtherPlatform = elements.showOnWebsite?.checked !== false;
  const onlineFriends = state.friends.filter((friend) => {
    if (!friendIsOnline(friend)) return false;
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
  const ungrouped = { id: 'ungrouped', label: 'その他', memberIds: new Set(), friends: [] };

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
    ? `<img class="friend-location-avatar" src="${escapeHtml(avatarUrl)}" loading="lazy" alt="${escapeHtml(name)}">`
    : '<div class="friend-location-avatar friend-location-avatar-empty"></div>';
  const profileUrl = CONFIG.DEBUG_MODE ? '' : buildUserProfileUrl(friend.id);
  const avatarContent = profileUrl
    ? `<a class="friend-location-profile-link" href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener noreferrer" title="VRChat公式プロフィールを開く">${avatar}</a>`
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
    ? safeImageUrl(entry.world?.thumbnailImageUrl || entry.instanceData?.world?.thumbnailImageUrl || entry.instanceData?.world?.imageUrl || '')
    : '';
  const thumbContent = thumb
    ? `<img class="friend-location-thumb" src="${escapeHtml(thumb)}" loading="lazy" decoding="async" alt="">`
    : `<div class="friend-location-thumb friend-location-thumb-placeholder">${renderFriendLocationPlaceholderIcon({ isPrivate, isWebsite })}</div>`;
  const simpleStatusText = isWebsite
    ? 'Other Platform'
    : isPrivate
      ? 'Private'
      : permissionLabel(permission);
  const simpleCountText = !isWebsite && !isPrivate && countText ? countText : '';
  const thumbOverlay = `
    <div class="friend-location-thumb-simple-meta">
      <span class="friend-state friend-location-thumb-simple-status ${permissionClass}">${escapeHtml(simpleStatusText)}</span>
      ${simpleCountText ? `<span class="friend-location-thumb-simple-count" title="フレンド数 / 参加人数 / 最大人数">${escapeHtml(simpleCountText)}</span>` : ''}
    </div>
    <div class="friend-location-thumb-simple-title" title="${escapeHtml(locationTitle)}">${escapeHtml(locationTitle)}</div>`;
  const thumbWrapped = worldUrl
    ? `<a class="friend-location-thumb-link" href="${escapeHtml(worldUrl)}" target="_blank" rel="noopener noreferrer" title="ワールドページを開く">${thumbContent}${thumbOverlay}</a>`
    : `<div class="friend-location-thumb-link">${thumbContent}${thumbOverlay}</div>`;

  const locationMeta = isWebsite
    ? `<span class="friend-state friend-location-permission ${permissionClass}">Other Platform</span>`
    : isPrivate
      ? `<span class="friend-state friend-location-permission ${permissionClass}">Private</span>`
      : `<span class="friend-state friend-location-permission ${permissionClass}">${escapeHtml(permissionLabel(permission))}</span>${region ? `<span class="friend-location-region">${escapeHtml(region)}</span>` : ''}${countText ? `<span class="friend-location-count" title="フレンド数 / 参加人数 / 最大人数">${escapeHtml(countText)}</span>` : ''}`;

  const locationName = launchUrl
    ? `<a class="friend-location-world-link" href="${escapeHtml(launchUrl)}" target="_blank" rel="noopener noreferrer" title="VRChat公式Launchページを開く">${escapeHtml(locationTitle)}</a>`
    : `<span class="friend-location-world-name" title="${escapeHtml(locationTitle)}">${escapeHtml(locationTitle)}</span>`;

  const locationData = entry?.location && !isPrivate ? ` data-location="${escapeHtml(entry.location)}"` : '';
  const previewDisabledClass = isPrivate || isWebsite ? ' friend-location-no-preview' : '';
  return `
    <article class="friend-location-item${entry && needsHydration(entry) ? ' friend-location-loading' : ''}${previewDisabledClass}" data-friend-id="${escapeHtml(friend.id)}"${locationData}>
      <div class="friend-location-avatar-wrap">
        ${avatarContent}
        <span class="online-dot ${status.className} friend-location-online-dot" title="${escapeHtml(status.label)}" aria-label="${escapeHtml(status.label)}">●</span>
        ${renderFavoriteActionButton(friend.id, 'friend-location-favorite')}
      </div>
      <div class="friend-location-copy">
        <div class="friend-location-name-line">
          ${profileUrl ? `<a class="friend-location-name" href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(name)}</a>` : `<span class="friend-location-name">${escapeHtml(name)}</span>`}
        </div>
        <div class="friend-location-world-line">${locationName}</div>
        <div class="friend-location-meta">${locationMeta}</div>
      </div>
      ${thumbWrapped}
    </article>`;
}

function renderFriendLocationView() {
  const groups = getReverseFriendGroups();
  const sections = groups.map((group, index) => {
    const isFavoriteGroup = index < 3;
    const collapsed = state.collapsedFriendGroups.has(group.id);
    const icon = isFavoriteGroup ? '★' : '●';
    const rows = collapsed
      ? ''
      : group.friends.length
        ? group.friends.map(renderFriendLocationItem).join('')
        : '<div class="friend-location-section-empty">オンラインのフレンドはいません</div>';
    return `
      <section class="friend-location-section${collapsed ? ' is-collapsed' : ''}" data-favorite-group="${escapeHtml(group.id)}">
        <button class="friend-location-section-header" type="button"
                data-friend-group-toggle="${escapeHtml(group.id)}"
                aria-expanded="${String(!collapsed)}"
                title="${collapsed ? '展開' : '折り畳む'}">
          <span class="friend-location-section-title">
            <span class="friend-location-section-chevron" aria-hidden="true">${collapsed ? '▶' : '▼'}</span>
            <span class="friend-location-section-icon${isFavoriteGroup ? ' is-favorite' : ''}" aria-hidden="true">${icon}</span>
            ${escapeHtml(group.label)}
          </span>
          <span class="friend-location-section-count">${group.friends.length}人</span>
        </button>
        ${collapsed ? '' : `<div class="friend-location-grid">${rows}</div>`}
      </section>`;
  }).join('');

  return `<div class="friend-location-view">${sections}</div>`;
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

function renderParticipantList(entry, { showAll = false } = {}) {
  const participantState = showAll ? { ...state, tab: TABS.ALL } : state;
  const participants = sortParticipants(
    entry,
    participantsForEntry(entry, participantState, friendMap()),
    state,
  );
  if (!participants.length) {
    const empty = !showAll && state.tab === TABS.FAVORITE_ONLY
      ? '表示対象のFavoriteフレンドはいません'
      : '表示対象のユーザーはいません';
    return `<div class="participant-empty">${escapeHtml(empty)}</div>`;
  }

  const ownerId = instanceOwnerId(entry);
  return `<div class="participant-list">${participants.map((user) => {
    const name = user.displayName || user.username || user.id;
    const src = safeImageUrl(
      user.profilePicOverride
        || user.currentAvatarThumbnailImageUrl
        || user.userIcon
        || user.iconUrl
        || user.imageUrl
        || '',
    );
    const profileUrl = buildUserProfileUrl(user.id);
    const avatar = src
      ? `<img class="participant-avatar" src="${escapeHtml(src)}" loading="lazy" alt="${escapeHtml(name)}">`
      : '<div class="participant-avatar participant-avatar-empty"></div>';
    const avatarLink = profileUrl
      ? `<a class="participant-profile-link" href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener noreferrer" title="VRChat公式プロフィールを開く">${avatar}</a>`
      : avatar;
    const isOwner = Boolean(ownerId && ownerId === user.id);
    const isFriend = friendMap().has(user.id);
    const ownerBadge = isOwner
      ? '<span class="owner-badge" title="Instance Owner">Owner</span>'
      : '';
    const foafBadge = isOwner && !isFriend && isFoafPresentInEntry(entry, user)
      ? '<span class="foaf-badge" title="Friend of a Friend">FOAF</span>'
      : '';
    const favoriteBadge = isFriend
      ? renderFavoriteActionButton(user.id, 'favorite-badge-participant')
      : '';

    return `
      <div class="participant" title="${escapeHtml(name)}">
        <div class="participant-avatar-wrap">
          ${avatarLink}${ownerBadge}${foafBadge}${favoriteBadge}
        </div>
        <div class="participant-name">${escapeHtml(name)}</div>
      </div>`;
  }).join('')}</div>`;
}

function renderPrivateInstance(entry, { showAll = false } = {}) {
  const favoriteMode = !showAll && (state.tab === TABS.FAVORITE_PLUS || state.tab === TABS.FAVORITE_ONLY);
  const visibleFriends = showAll
    ? entry.friends
    : favoriteMode
      ? entry.friends.filter((friend) => state.favorites.has(friend.id))
      : entry.friends;

  return `
    <article class="private-card${instanceIsHighlighted(entry) ? ' instance-highlight' : ''}" data-location="${escapeHtml(entry.location)}" aria-label="Private">
      <div class="private-label">Private</div>
      <div class="private-users">
        ${visibleFriends.map((friend) => {
          const name = friend.displayName || friend.username || friend.id;
          const src = friendAvatarUrl(friend);
          const profileUrl = CONFIG.DEBUG_MODE ? '' : buildUserProfileUrl(friend.id);
          const privateAvatar = src
            ? `<img class="private-avatar" src="${escapeHtml(src)}" loading="lazy" alt="${escapeHtml(name)}">`
            : `<div class="private-avatar private-avatar-empty" aria-label="${escapeHtml(name)}"></div>`;
          const privateAvatarLink = profileUrl
            ? `<a class="private-profile-link" href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener noreferrer" title="VRChat公式プロフィールを開く">${privateAvatar}</a>`
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
        ${visibleFriends.length === 0 ? `<div class="private-empty">${favoriteMode ? 'Favoriteフレンドはいません' : '表示対象のユーザーはいません'}</div>` : ''}
      </div>
    </article>`;
}

function renderInstanceCard(entry, { preview = false } = {}) {
  if (entry.permission === PERMISSIONS.PRIVATE) return renderPrivateInstance(entry, { showAll: preview });

  const worldName = entry.world?.name
    || entry.instanceData?.world?.name
    || entry.worldId
    || 'World information unavailable';
  const thumb = safeImageUrl(
    entry.world?.thumbnailImageUrl
      || entry.instanceData?.world?.thumbnailImageUrl
      || '',
  );
  const worldUrl = entry.debug ? '' : buildWorldUrl(entry);
  const launchUrl = entry.debug ? '' : buildInstanceLaunchUrl(entry);
  const groupName = entry.groupName
    || entry.instanceData?.group?.name
    || entry.instanceData?.groupName
    || (entry.groupId ? 'グループ名取得中…' : '');
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

  return `
    <article class="card${hydrated ? '' : ' card-loading'}${instanceIsHighlighted(entry) ? ' instance-highlight' : ''}" data-location="${escapeHtml(entry.location)}">
      ${worldUrl ? `<a class="thumb-wrap thumb-clickable" href="${escapeHtml(worldUrl)}" target="_blank" rel="noopener noreferrer" title="ワールドページを開く">` : '<div class="thumb-wrap">'}
        ${thumb
          ? `<img class="thumb" src="${escapeHtml(thumb)}" loading="eager" decoding="async" alt="">`
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
      <button class="invite-me-button invite-me-button-simple" type="button" data-location="${escapeHtml(entry.location)}" title="このインスタンスへ自分宛てのInvite Meを送信" ${entry.debug || !entry.worldId || !entry.instanceId ? 'disabled' : ''}>Invite Me</button>

      <div class="info-panel">
        <div class="instance-title-line">
          ${launchUrl
            ? `<a class="instance-title-name instance-title-name-link" href="${escapeHtml(launchUrl)}" target="_blank" rel="noopener noreferrer" title="VRChat公式Launchページを開く">${escapeHtml(worldName)}</a>`
            : `<span class="instance-title-name" title="${escapeHtml(worldName)}">${escapeHtml(worldName)}</span>`}
          ${entry.groupId ? `<span class="instance-title-separator">/</span><span class="instance-title-group" title="${escapeHtml(groupName)}">${escapeHtml(groupName)}</span>` : ''}
        </div>

        <div class="summary-row">
          <div class="summary-item permission-summary"><svg class="summary-globe" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="1.8"/>
            <path d="M2.8 10h14.4M10 2.5c2.1 2 3.2 4.5 3.2 7.5S12.1 15.5 10 17.5M10 2.5C7.9 4.5 6.8 7 6.8 10s1.1 5.5 3.2 7.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg><span class="summary-value">${escapeHtml(permissionLabel(entry.permission))}${entry.region ? ` / ${escapeHtml(regionLabel(entry.region))}` : ''}</span></div>
          <div class="summary-item">${renderSummaryPeopleIcon('world')}<span class="summary-value">${escapeHtml(userCountText)}</span></div>
          <div class="summary-item friend-count-summary">${renderSummaryPeopleIcon('friends')}<span class="summary-value">${escapeHtml(String(friendCount))}</span><button class="invite-me-button invite-me-button-normal" type="button" data-location="${escapeHtml(entry.location)}" title="このインスタンスへ自分宛てのInvite Meを送信" ${entry.debug || !entry.worldId || !entry.instanceId ? 'disabled' : ''}>Invite Me</button></div>
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
    showActionToast('DEBUG MODE: ダミーインスタンスにはInvite Meを送信しません。', { delay: 2600 });
    return;
  }
  if (button.disabled) return;

  button.disabled = true;
  button.classList.add('is-loading');
  button.textContent = '送信中…';
  try {
    await repository.inviteMyselfTo(location);
    button.textContent = 'Invited';
    button.classList.add('is-success');
    showActionToast('Invite Meを送信しました', { delay: 2200 });
    window.setTimeout(() => {
      if (!button.isConnected) return;
      button.textContent = 'Invite Me';
      button.classList.remove('is-success', 'is-loading');
      button.disabled = false;
    }, 1800);
  } catch (error) {
    console.warn('Could not send Invite Me:', location, error);
    button.textContent = 'Invite Me';
    button.classList.remove('is-loading');
    button.disabled = false;
    const message = error?.status === 401
      ? 'VRChatのログインセッションが無効です。'
      : error?.status === 404
        ? 'このインスタンスは存在しないか、Invite Meを送信できません。'
        : `Invite Meの送信に失敗しました${error?.status ? ` (${error.status})` : ''}`;
    showActionToast(message, { error: true, delay: 5600 });
  }
}

function getCurrentInstanceEntry(location, fallback = null) {
  return state.instances.find((entry) => entry.location === location) || fallback;
}

function needsHydration(entry) {
  if (!entry || entry.debug || entry.permission === PERMISSIONS.PRIVATE) return false;

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
  return needsNonFriendOwnerProfile(entry, friendMap())
    || needsInstanceDetailsForFoaf(entry, state, friendMap())
    || shouldFetchNonFriendOwner(entry, state, friendMap());
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
      node.replaceWith(replacement);
      if (needsHydration(currentEntry)) hydrationController.observeNode(replacement);
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
  node.replaceWith(replacement);
  elements.list.scrollTop = scrollTop;
  if (needsHydration(currentEntry)) hydrationController.observeNode(replacement);

  // Re-center the focused card after asynchronous hydration replaced its DOM
  // node. This neutralizes layout shifts caused by the completed request.
  if (state.highlight.location === currentEntry.location && Date.now() < state.highlight.until) {
    requestAnimationFrame(() => scrollInstanceCardIntoView(currentEntry.location, 'auto'));
  }
}

async function hydrateInstance(location, fallbackEntry) {
  if (!location) return;
  let currentEntry = getCurrentInstanceEntry(location, fallbackEntry);
  if (!currentEntry || currentEntry.permission === PERMISSIONS.PRIVATE) return;

  try {
    let data = currentEntry.instanceData;
    if (!data) {
      try {
        data = await repository.fetchInstance(location);
      } catch (error) {
        currentEntry = getCurrentInstanceEntry(location, currentEntry);
        currentEntry.instanceFetchFailed = true;
        currentEntry.foafChecked = true;
        replaceCardInDom(currentEntry);
        throw error;
      }
    }

    // A successful Instance response completes the one-time FOAF presence
    // check. If the response omits `users`, FOAF is simply not displayable;
    // never requeue the same request forever.
    currentEntry = getCurrentInstanceEntry(location, currentEntry);
    const changed = !currentEntry.instanceData || currentEntry.instanceData !== data;
    currentEntry.instanceFetchFailed = false;
    currentEntry.foafChecked = true;
    mergeInstanceData(currentEntry, data);

    if (!currentEntry.world && !currentEntry.worldFetchFailed
      && currentEntry.worldId && currentEntry.worldId !== 'offline' && currentEntry.worldId !== 'private') {
      try {
        const world = await repository.fetchWorld(currentEntry.worldId);
        currentEntry = getCurrentInstanceEntry(location, currentEntry);
        if (world) {
          currentEntry.world = world;
          currentEntry.worldFetchFailed = false;
        } else {
          currentEntry.worldFetchFailed = true;
        }
      } catch {
        currentEntry = getCurrentInstanceEntry(location, currentEntry);
        currentEntry.worldFetchFailed = true;
      }
    }

    if (needsNonFriendOwnerProfile(currentEntry, friendMap())
      || shouldFetchNonFriendOwner(currentEntry, state, friendMap())) {
      const ownerId = instanceOwnerId(currentEntry);
      const ownerUser = await repository.fetchUser(ownerId);
      currentEntry = getCurrentInstanceEntry(location, currentEntry);
      currentEntry.ownerUserLoaded = true;
      if (ownerUser) currentEntry.ownerUser = ownerUser;
    }

    replaceCardInDom(currentEntry);
  } catch (error) {
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
  ).length;
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
  const gridWidth = (columns * avatarSize) + ((columns - 1) * 4);
  preview.style.setProperty('--friend-preview-columns', String(columns));
  preview.style.setProperty('--friend-preview-grid-width', `${gridWidth}px`);
  preview.innerHTML = renderInstanceCard(entry, { preview: true });
  preview.classList.remove('hidden');
  requestAnimationFrame(positionFriendInstancePreview);
}

function refreshFriendInstancePreview(location) {
  if (!location || state.friendPreview.location !== location) return;
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

function scheduleFriendInstancePreview(item, pointerX, pointerY) {
  if (!isValidFriendPreviewAnchor(item)) return;
  if (
    item.classList.contains('friend-item')
    && state.friendPreview.sidebarSuppressedFriendId
    && item.dataset.friendId === state.friendPreview.sidebarSuppressedFriendId
  ) return;
  if (elements.favoriteMenu && !elements.favoriteMenu.classList.contains('hidden')) return;
  clearFriendPreviewTimer('open');
  clearFriendPreviewTimer('close');

  const friend = state.friendIndex.get(item.dataset.friendId);
  if (!friend) return;
  const status = onlineStatusInfo(friend);
  const location = resolveFriendLocation(friend);
  const permission = classifyPermission(location);
  if (status.className === 'online-website' || permission === PERMISSIONS.PRIVATE || location === 'private') return;

  const entry = reverseEntryForFriend(friend);
  if (!entry) return;
  state.friendPreview.pointerX = Number(pointerX) || 0;
  state.friendPreview.pointerY = Number(pointerY) || 0;

  state.friendPreview.openTimer = window.setTimeout(() => {
    state.friendPreview.openTimer = null;
    if (!isValidFriendPreviewAnchor(item)) return;

    const currentEntry = getCurrentInstanceEntry(entry.location, entry);
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
  if (state.collapsedFriendGroups.has(groupId)) {
    state.collapsedFriendGroups.delete(groupId);
  } else {
    state.collapsedFriendGroups.add(groupId);
  }
  hideFriendInstancePreview({ immediate: true });
  render({ resetScroll: false });
}

function onFriendViewControlClick(event) {
  const toggle = event.target.closest('[data-friend-group-toggle]');
  if (!toggle || !elements.list?.contains(toggle)) return;
  event.preventDefault();
  toggleFriendLocationGroup(toggle.dataset.friendGroupToggle || '');
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
  state.favoriteMenu.anchor = null;
  state.favoriteMenu.busy = false;
  if (restoreFocus && anchor?.isConnected) anchor.focus();
}

function positionFavoriteMenu(anchor) {
  const menu = elements.favoriteMenu;
  if (!menu || !anchor?.isConnected || menu.classList.contains('hidden')) return;
  const edge = 8;
  const gap = 5;
  const rect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  let left = rect.right - menuRect.width;
  let top = rect.bottom + gap;
  if (left < edge) left = rect.left;
  if (left + menuRect.width > window.innerWidth - edge) left = window.innerWidth - menuRect.width - edge;
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
    ? `<div class="favorite-menu-separator" role="separator"></div><button class="favorite-menu-item favorite-menu-remove" type="button" role="menuitem" data-favorite-remove="true" data-favorite-user-id="${escapeHtml(userId)}"><span class="favorite-menu-check" aria-hidden="true"></span><span class="favorite-menu-label">Favoriteを外す</span></button>`
    : '';
  menu.innerHTML = `${groupRows}${removeRow}`;
  menu.classList.remove('hidden');
  state.favoriteMenu.userId = userId;
  state.favoriteMenu.anchor = anchor;
  requestAnimationFrame(() => positionFavoriteMenu(anchor));
}

async function applyFavoriteMutation({ userId, groupName = '', remove = false } = {}) {
  if (!userId || state.favoriteMenu.busy) return;
  if (CONFIG.DEBUG_MODE) {
    showActionToast('DEBUG MODE: Favorite情報はVRChatへ変更しません。', { delay: 2600 });
    closeFavoriteMenu();
    return;
  }
  const currentRecord = state.favoriteRecords.get(userId) || null;
  const currentGroup = favoriteGroupForUser(userId);
  if (!remove && currentGroup === groupName && state.favorites.has(userId)) {
    closeFavoriteMenu();
    return;
  }

  state.favoriteMenu.busy = true;
  elements.favoriteMenu?.querySelectorAll('button').forEach((button) => { button.disabled = true; });
  showActionToast(remove ? 'Favoriteを外しています…' : 'Favoriteを更新中…', { delay: 0 });
  try {
    const result = remove
      ? await repository.removeFriendFavorite(currentRecord)
      : await repository.setFriendFavoriteGroup(userId, groupName, currentRecord);
    applyFavoriteState(result.favoriteState);
    closeFavoriteMenu();
    render({ resetScroll: false });
    if (result.syncFailed) {
      const action = remove ? 'Favoriteを外しました' : 'Favoriteを更新しました';
      showActionToast(`${action}（再同期に失敗しました。次回更新時に再確認します）`, { delay: 5200 });
    } else {
      showActionToast(remove ? 'Favoriteを外しました' : 'Favoriteを更新しました', { delay: 2200 });
    }
  } catch (error) {
    console.warn('Could not update Favorite:', userId, error);
    state.favoriteMenu.busy = false;
    elements.favoriteMenu?.querySelectorAll('button').forEach((button) => { button.disabled = false; });
    const rollback = error?.favoriteRollbackFailed ? '（元のFavorite Listへの復元にも失敗しました）' : '';
    const message = error?.status === 401
      ? 'VRChatのログインセッションが無効です。'
      : error?.status === 403
        ? 'このフレンドのFavoriteを変更できません。'
        : `Favoriteの更新に失敗しました${error?.status ? ` (${error.status})` : ''}${rollback}`;
    showActionToast(message, { error: true, delay: 5600 });
  }
}

function onFavoriteUiClick(event) {
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
  hideFriendInstancePreview({ immediate: true });
  closeFavoriteMenu();
  const friendScroll = elements.friendList?.scrollTop || 0;
  const rightScroll = resetScroll ? 0 : elements.list?.scrollTop || 0;
  hydrationController.disconnect();

  updateTabButtons();
  renderFriendSidebar();

  const manifest = globalThis.chrome?.runtime?.getManifest?.();
  const appVersion = manifest?.version_name || manifest?.version || '1.5.3';
  const credit = `<div class="app-credit">VRChat Friends &amp; Group Instance Viewer v${escapeHtml(appVersion)} created by <a href="https://x.com/mos_vrc" target="_blank" rel="noopener noreferrer">@mos_vrc</a></div>`;
  if (state.viewMode === VIEW_MODES.FRIENDS) {
    elements.list.innerHTML = `${renderFriendLocationView()}${credit}`;
  } else {
    const data = getVisibleInstances();
    if (!data.length) {
      elements.list.innerHTML = `<div class="empty">表示できるインスタンスはありません。</div>${credit}`;
    } else {
      elements.list.innerHTML = `${data.map(renderInstanceCard).join('')}${credit}`;
    }
  }

  elements.friendList.scrollTop = friendScroll;
  elements.list.scrollTop = rightScroll;
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
    setTransientStatus(
      targetTab === TABS.FAVORITE_PLUS
        ? 'このフレンドのインスタンスはFavorite+には表示されません'
        : 'このフレンドのインスタンスは「すべて」には表示されません',
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
    elements.updatedAt.textContent = '更新: --:--:--';
    elements.updatedAt.title = '最終更新';
    return;
  }

  const date = new Date(state.lastLoadedAt);
  const time = [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
  const label = `更新: ${time}`;
  elements.updatedAt.textContent = label;
  elements.updatedAt.title = state.dataFromCache ? `${label}（一部キャッシュ）` : label;
}

async function refreshGroupDataInBackground(userId) {
  try {
    const groupInstances = await repository.fetchGroupInstances(userId);
    state.instances = buildLocations(
      createFriendLocationMap(state.friends),
      groupInstances,
      locationCacheReader,
    );
    const focusRemaining = Math.max(0, state.highlight.until - Date.now());
    if (state.highlight.location && focusRemaining > 0) {
      setTimeout(() => {
        if (state.highlight.location) render();
      }, focusRemaining + 16);
    } else {
      render();
    }
    state.dataFromCache = Boolean(repository.usedStaleFallback);
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
        const group = await repository.fetchGroup(groupId);
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
    if (error?.status === 401) throw error;
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
  setFriendState(debug.friends);
  state.favorites = debug.favorites;
  state.favoriteRecords = new Map();
  setFavoriteGroupState(debug.favoriteGroups);
  state.instances = debug.instances;
  state.lastLoadedAt = Date.now();
  state.dataFromCache = false;
  elements.login?.classList.add('hidden');
  render();
  updateLoadedAtLabel();
  setStatus(`DEBUG MODE: 各${Math.max(1, Math.floor(Number(CONFIG.DEBUG_FRIEND_COUNT) || 20))}人・Favorite ${CONFIG.DEBUG_FAVORITE_COUNT}人 / 3インスタンス（Public・Group・Private）`);
}

async function load() {
  if (CONFIG.DEBUG_MODE) {
    loadDebugData();
    return;
  }
  if (state.loading) return;
  state.loading = true;
  state.dataFromCache = false;
  state.lastLoadedAt = 0;
  repository.usedStaleFallback = false;
  elements.login?.classList.add('hidden');
  setStatus('VRChatログインセッションを確認中…');

  try {
    // Authentication must complete before any account-scoped cache can be used.
    const user = await repository.fetchMe();
    state.user = user;

    // Do not paint stale cached lists first. Fetch the time-sensitive primary
    // datasets first so the first interactive render reflects current data (or
    // a same-account fallback only when the live request fails).
    setStatus('フレンド情報を更新中…');
    const [friends, favoriteState] = await Promise.all([
      repository.fetchFriends(),
      repository.fetchFavorites(),
    ]);

    setFriendState(normalizeFriends(friends));
    applyFavoriteState(favoriteState);
    state.instances = buildLocations(
      createFriendLocationMap(state.friends),
      [],
      locationCacheReader,
    );

    state.lastLoadedAt = repository.primaryDataUpdatedAt || Date.now();
    // Repository exposes whether a primary dataset had to fall back to stale
    // same-account data. Keep that information visible without blocking the UI.
    state.dataFromCache = Boolean(repository.usedStaleFallback);
    render();
    updateLoadedAtLabel();
    setStatus('');

    // Group Instances are secondary data for this screen. Load them after the
    // first interactive paint so tab switching and friend clicks remain
    // responsive even while group data is being fetched.
    void refreshGroupDataInBackground(user.id).catch((error) => {
      if (error?.status === 401) {
        state.instances = [];
        setFriendState([]);
        state.favorites = new Set();
        state.favoriteRecords = new Map();
        setFavoriteGroupState([]);
        setStatus('VRChatのログインセッションが無効です。VRChat公式サイトで再ログインしてください。', true);
      }
    });
  } catch (error) {
    if (error?.status === 401) {
      state.instances = [];
      setFriendState([]);
      state.favorites = new Set();
      state.favoriteRecords = new Map();
      setFavoriteGroupState([]);
      elements.list.innerHTML = '';
      elements.login?.classList.remove('hidden');
      setStatus('VRChatのログインセッションが無効です。VRChat公式サイトで再ログインしてください。', true);
    } else {
      setStatus(`取得に失敗しました: ${error?.message || error}`, true);
    }
  } finally {
    state.loading = false;
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
    if (!['light', 'ash', 'dark-blue', 'dark'].includes(theme) || theme === state.theme) return;
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
  state.autoRefreshMinutes = [10, 30].includes(minutes) ? minutes : 0;
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

document.addEventListener('click', (event) => {
  if (elements.settingsPanel?.classList.contains('hidden')) return;
  if (event.target.closest('.toolbar-options')) return;
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

elements.friendSearch?.addEventListener('input', () => renderFriendSidebar());
elements.friendFilter?.addEventListener('change', () => {
  state.requestedFriendFilter = elements.friendFilter.value || 'favorite';
  persistUiPreferences();
  renderFriendSidebar();
});
elements.showOnWebsite?.addEventListener('change', () => {
  persistUiPreferences();
  renderFriendSidebar();
  if (state.viewMode === VIEW_MODES.FRIENDS) render({ resetScroll: false });
});
elements.clearFriendSearch?.addEventListener('click', () => {
  if (!elements.friendSearch) return;
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
elements.list?.addEventListener('click', onFriendViewControlClick);
elements.list?.addEventListener('click', onInviteMeClick);
elements.list?.addEventListener('mouseover', onFriendLocationMouseOver);
elements.list?.addEventListener('mousemove', onFriendLocationMouseMove, { passive: true });
elements.list?.addEventListener('mouseout', onFriendLocationMouseOut);
elements.list?.addEventListener('scroll', () => hideFriendInstancePreview({ immediate: true }), { passive: true });
elements.friendInstancePreview?.addEventListener('mouseenter', () => clearFriendPreviewTimer('close'));
elements.friendInstancePreview?.addEventListener('mouseleave', () => hideFriendInstancePreview());
elements.friendInstancePreview?.addEventListener('click', onInviteMeClick);
window.addEventListener('resize', () => {
  hideFriendInstancePreview({ immediate: true });
  closeFavoriteMenu();
});
elements.friendList?.addEventListener('keydown', onFriendListKeydown);
elements.loginButton?.addEventListener('click', () => {
  window.open(CONFIG.LOGIN_URL, '_blank', 'noopener,noreferrer');
});

restoreUiPreferences();
applyMainSortOptions();
updateTabButtons();
scheduleAutoRefresh();
if (!CONFIG.DEBUG_MODE) void ensureApiUserAgentRule();
void load();
