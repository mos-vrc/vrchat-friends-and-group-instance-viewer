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
  sidebarCollapsed: false,
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
  },
  favoriteMenu: {
    userId: '',
    anchor: null,
    busy: false,
  },
};

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
    sidebarCollapsed: state.sidebarCollapsed,
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
  state.sidebarCollapsed = prefs.sidebarCollapsed === true;
  applyInstanceSize();
  applyInstanceDisplay();
  applyTheme();
  applySidebarCollapsed();
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

function applySidebarCollapsed() {
  const collapsed = Boolean(state.sidebarCollapsed);
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  if (!elements.sidebarToggle) return;
  elements.sidebarToggle.textContent = collapsed ? '›' : '‹';
  elements.sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
  const label = collapsed ? 'フレンド一覧を表示' : 'フレンド一覧を隠す';
  elements.sidebarToggle.setAttribute('aria-label', label);
  elements.sidebarToggle.title = label;
}

function toggleFriendSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  applySidebarCollapsed();
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

function renderFriendSidebar() {
  if (!elements.friendList || !elements.friendCount) return;
  const previousScroll = elements.friendList.scrollTop;
  const rows = getFriendSidebarRows();

  const visibleCount = rows.length;
  const onlineFriendCount = state.friends.length;
  elements.friendCount.textContent = `${visibleCount} / ${onlineFriendCount}`;
  elements.friendCount.setAttribute(
    'aria-label',
    `表示中 ${visibleCount}人 / オンラインフレンド総数 ${onlineFriendCount}人`,
  );
  elements.friendList.innerHTML = rows.map((friend) => {
    const name = friend.displayName || friend.username || friend.id;
    const status = onlineStatusInfo(friend);
    const permission = classifyPermission(resolveFriendLocation(friend));
    const avatarUrl = friendAvatarUrl(friend);
    const avatar = avatarUrl
      ? `<img class="friend-avatar" src="${escapeHtml(avatarUrl)}" alt="">`
      : '<div class="friend-avatar"></div>';

    return `
      <div class="friend-item" data-friend-id="${escapeHtml(friend.id)}" tabindex="0" role="button" aria-label="${escapeHtml(name)}">
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
      </div>`;
  }).join('');

  elements.friendList.scrollTop = previousScroll;
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