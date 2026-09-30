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
  account: document.getElementById('account'),
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
  autoRefresh: document.getElementById('autoRefresh'),
};

const uiStorage = new JsonStorage();
const repository = new DataRepository(new VrchatApiClient(), uiStorage);

// Pass bound cache readers into pure domain code; never hand a repository object
// whose methods would lose their `this` receiver when extracted as callbacks.
const locationCacheReader = Object.freeze({
  getCachedInstance: (location) => repository.getCachedInstance(location),
  getCachedWorld: (worldId) => repository.getCachedWorld(worldId),
});

const state = {
  tab: TABS.FAVORITE_PLUS,
  sort: SORTS.FRIENDS_DESC,
  instanceSize: 'medium',
  friendSort: 'favorite_list',
  theme: 'dark-blue',
  autoRefreshMinutes: 0,
  autoRefreshTimer: null,
  sidebarCollapsed: false,
  statusTimer: null,
  user: null,
  favorites: new Set(),
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
};

function readUiPreferences() {
  const prefs = uiStorage.get(CONFIG.UI_PREFERENCES_KEY, {});
  return prefs && typeof prefs === 'object' && !Array.isArray(prefs) ? prefs : {};
}

function persistUiPreferences() {
  uiStorage.set(CONFIG.UI_PREFERENCES_KEY, {
    tab: state.tab,
    sort: state.sort,
    instanceSize: state.instanceSize,
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
  state.tab = Object.values(TABS).includes(prefs.tab) ? prefs.tab : TABS.FAVORITE_PLUS;
  state.sort = Object.values(SORTS).includes(prefs.sort) ? prefs.sort : SORTS.FRIENDS_DESC;
  state.instanceSize = ['small', 'medium', 'large'].includes(prefs.instanceSize)
    ? prefs.instanceSize
    : 'medium';
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
  applyTheme();
  applySidebarCollapsed();
  if (elements.friendSort) elements.friendSort.value = state.friendSort;
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
  if (elements.sort) elements.sort.value = state.sort;
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

function renderFriendFilterOptions() {
  if (!elements.friendFilter) return;

  const current = elements.friendFilter.value || state.requestedFriendFilter || 'favorite';
  const groupsByName = new Map(state.favoriteGroups.map((group) => [group.name, group]));
  const groupOptions = ['group_0', 'group_1', 'group_2'].map((name, index) => {
    const group = groupsByName.get(name);
    const label = group?.displayName || `グループ${index + 1}`;
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

function updateTabButtons() {
  document.querySelectorAll('.tab').forEach((button) => {
    const active = button.dataset.filter === state.tab;
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

  const friendName = (friend) => String(friend.displayName || friend.username || friend.id || '');
  const compareNames = (a, b) => friendName(a).localeCompare(friendName(b), 'ja');

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
      return compareNames(a, b);
    });
  }

  if (filter === 'all' || filter === 'joinable') {
    return filtered.sort((a, b) => {
      const favoriteDifference = Number(state.favorites.has(b.id)) - Number(state.favorites.has(a.id));
      if (favoriteDifference) return favoriteDifference;
      return compareNames(a, b);
    });
  }

  return filtered.sort(compareNames);
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
          ${state.favorites.has(friend.id) ? '<span class="favorite-badge" title="Favorite">★</span>' : ''}
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
  state.tab = Object.values(TABS).includes(tab) ? tab : TABS.FAVORITE_PLUS;
  persistUiPreferences();
  updateTabButtons();
  render({ resetScroll });
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

function renderParticipantList(entry) {
  const participants = sortParticipants(
    entry,
    participantsForEntry(entry, state, friendMap()),
    state,
  );
  if (!participants.length) {
    const empty = state.tab === TABS.FAVORITE_ONLY
      ? '表示対象のFavoriteユーザーはいません'
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
      ? `<a class="participant-profile-link" href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener noreferrer" title="VRChatプロフィールを開く">${avatar}</a>`
      : avatar;
    const isOwner = Boolean(ownerId && ownerId === user.id);
    const isFriend = friendMap().has(user.id);
    const ownerBadge = isOwner
      ? '<span class="owner-badge" title="Instance Owner">Owner</span>'
      : '';
    const foafBadge = isOwner && !isFriend && isFoafPresentInEntry(entry, user)
      ? '<span class="foaf-badge" title="Friend of a Friend">FOAF</span>'
      : '';
    const favoriteBadge = state.favorites.has(user.id)
      ? '<span class="favorite-badge favorite-badge-participant" title="Favorite">★</span>'
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

function renderPrivateInstance(entry) {
  const favoriteMode = state.tab === TABS.FAVORITE_PLUS || state.tab === TABS.FAVORITE_ONLY;
  const visibleFriends = favoriteMode
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
            ? `<a class="private-profile-link" href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener noreferrer" title="VRChatプロフィールを開く">${privateAvatar}</a>`
            : privateAvatar;
          return `
            <div class="private-user" title="${escapeHtml(name)}">
              <div class="private-avatar-wrap">
                ${privateAvatarLink}
                ${state.favorites.has(friend.id) ? '<span class="favorite-badge private-favorite-badge" title="Favorite">★</span>' : ''}
              </div>
              <div class="private-user-name">${escapeHtml(name)}</div>
            </div>`;
        }).join('')}
        ${visibleFriends.length === 0 ? `<div class="private-empty">${favoriteMode ? 'Favoriteユーザはいません' : '表示対象のユーザーはいません'}</div>` : ''}
      </div>
    </article>`;
}

function renderInstanceCard(entry) {
  if (entry.permission === PERMISSIONS.PRIVATE) return renderPrivateInstance(entry);

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
  const friendCount = state.tab === TABS.FAVORITE_ONLY
    ? uniqueUsers(entry.friends).filter((friend) => state.favorites.has(friend.id)).length
    : uniqueUsers(entry.friends).length;
  const userCountText = Number.isFinite(capacity) ? `${userCount} / ${capacity}` : `${userCount}`;
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
        <div class="people-count">${escapeHtml(Number.isFinite(capacity) ? `${userCount}/${capacity}` : `${userCount}`)}</div>
        <div class="overlay-title" title="${escapeHtml(worldName)}">${escapeHtml(worldName)}</div>
      ${worldUrl ? '</a>' : '</div>'}

      <div class="info-panel">
        <div class="instance-title-line">
          ${launchUrl
            ? `<a class="instance-title-name instance-title-name-link" href="${escapeHtml(launchUrl)}" target="_blank" rel="noopener noreferrer" title="VRChatのLaunch画面を開く">${escapeHtml(worldName)}</a>`
            : `<span class="instance-title-name" title="${escapeHtml(worldName)}">${escapeHtml(worldName)}</span>`}
          ${entry.groupId ? `<span class="instance-title-separator">/</span><span class="instance-title-group" title="${escapeHtml(groupName)}">${escapeHtml(groupName)}</span>` : ''}
        </div>

        <div class="summary-row">
          <div class="summary-item permission-summary"><svg class="summary-globe" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="1.8"/>
            <path d="M2.8 10h14.4M10 2.5c2.1 2 3.2 4.5 3.2 7.5S12.1 15.5 10 17.5M10 2.5C7.9 4.5 6.8 7 6.8 10s1.1 5.5 3.2 7.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg><span class="summary-value">${escapeHtml(permissionLabel(entry.permission))}${entry.region ? ` / ${escapeHtml(regionLabel(entry.region))}` : ''}</span></div>
          <div class="summary-item">${renderSummaryPeopleIcon('world')}<span class="summary-value">${escapeHtml(userCountText)}</span></div>
          <div class="summary-item friend-count-summary">${renderSummaryPeopleIcon('friends')}<span class="summary-value">${escapeHtml(String(friendCount))}</span><button class="invite-me-button" type="button" data-location="${escapeHtml(entry.location)}" title="このインスタンスへ自分宛てのInvite Meを送信" ${entry.debug || !entry.worldId || !entry.instanceId ? 'disabled' : ''}>Invite Me</button></div>
        </div>

        ${renderParticipantList(entry)}
      </div>
    </article>`;
}

async function onInviteMeClick(event) {
  const button = event.target.closest('.invite-me-button');
  if (!button || !elements.list.contains(button)) return;
  event.preventDefault();
  event.stopPropagation();

  const location = button.dataset.location || '';
  const entry = getCurrentInstanceEntry(location);
  if (!entry || !entry.worldId || !entry.instanceId) return;
  if (CONFIG.DEBUG_MODE || entry.debug) {
    setStatus('DEBUG MODE: ダミーインスタンスにはInvite Meを送信しません。');
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
    setTransientStatus('Invite Me を送信しました', { delay: 2200 });
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
        ? 'このインスタンスは存在しないか、Invite Me を送信できません。'
        : `Invite Me の送信に失敗しました${error?.status ? ` (${error.status})` : ''}`;
    setStatus(message, true);
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
  const node = [...elements.list.querySelectorAll('[data-location]')]
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
  const friendScroll = elements.friendList?.scrollTop || 0;
  const rightScroll = resetScroll ? 0 : elements.list?.scrollTop || 0;
  hydrationController.disconnect();

  updateTabButtons();
  renderFriendSidebar();

  const data = getVisibleInstances();
  const appVersion = globalThis.chrome?.runtime?.getManifest?.().version || '1.4.22';
  const credit = `<div class="app-credit">VRChat Friends &amp; Group Instance Viewer v${escapeHtml(appVersion)} created by <a href="https://x.com/mos_vrc" target="_blank" rel="noopener noreferrer">@mos_vrc</a></div>`;
  if (!data.length) {
    elements.list.innerHTML = `<div class="empty">表示できるインスタンスはありません。</div>${credit}`;
  } else {
    elements.list.innerHTML = `${data.map(renderInstanceCard).join('')}${credit}`;
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
  state.tab = targetTab;
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
    displayName: `グループ${index + 1}`,
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
  setFavoriteGroupState(debug.favoriteGroups);
  state.instances = debug.instances;
  state.lastLoadedAt = Date.now();
  state.dataFromCache = false;
  if (elements.account) elements.account.textContent = 'Debug Mode';
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
  setStatus('ログイン情報を確認中…');

  try {
    // Authentication must complete before any account-scoped cache can be used.
    const user = await repository.fetchMe();
    state.user = user;
    if (elements.account) elements.account.textContent = user.displayName || user.username || user.id;

    // Do not paint stale cached lists first. Fetch the time-sensitive primary
    // datasets first so the first interactive render reflects current data (or
    // a same-account fallback only when the live request fails).
    setStatus('フレンド情報を更新中…');
    const [friends, favoriteState] = await Promise.all([
      repository.fetchFriends(),
      repository.fetchFavorites(),
    ]);

    setFriendState(normalizeFriends(friends));
    state.favorites = favoriteState.ids;
    setFavoriteGroupState(favoriteState.groups);
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
        setFavoriteGroupState([]);
        setStatus('VRChatのログインセッションが無効です。VRChat公式サイトで再ログインしてください。', true);
      }
    });
  } catch (error) {
    if (error?.status === 401) {
      state.instances = [];
      setFriendState([]);
      state.favorites = new Set();
      setFavoriteGroupState([]);
      if (elements.account) elements.account.textContent = 'VRChatログインが必要です';
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
  const item = event.target.closest('.friend-item');
  if (!item || !elements.friendList.contains(item)) return;
  focusFriendInstance(state.friends.find((friend) => friend.id === item.dataset.friendId));
}

function onFriendListKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const item = event.target.closest('.friend-item');
  if (!item) return;
  event.preventDefault();
  focusFriendInstance(state.friends.find((friend) => friend.id === item.dataset.friendId));
}

document.querySelectorAll('.tab').forEach((button) => {
  button.addEventListener('click', () => {
    clearInstanceHighlight();
    setActiveTab(button.dataset.filter || TABS.FAVORITE_PLUS);
  });
});

elements.sort?.addEventListener('change', () => {
  state.sort = Object.values(SORTS).includes(elements.sort.value)
    ? elements.sort.value
    : SORTS.FRIENDS_DESC;
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

document.addEventListener('click', (event) => {
  if (elements.settingsPanel?.classList.contains('hidden')) return;
  if (event.target.closest('.toolbar-options')) return;
  setSettingsPanelOpen(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
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
});
elements.clearFriendSearch?.addEventListener('click', () => {
  if (!elements.friendSearch) return;
  elements.friendSearch.value = '';
  elements.friendSearch.focus();
  renderFriendSidebar();
});
elements.friendList?.addEventListener('click', onFriendListClick);
elements.list?.addEventListener('click', onInviteMeClick);
elements.friendList?.addEventListener('keydown', onFriendListKeydown);
elements.loginButton?.addEventListener('click', () => {
  window.open(CONFIG.LOGIN_URL, '_blank', 'noopener,noreferrer');
});

restoreUiPreferences();
updateTabButtons();
scheduleAutoRefresh();
if (!CONFIG.DEBUG_MODE) void ensureApiUserAgentRule();
void load();
