import { PERMISSIONS, TABS } from './config.js';

export const PERMISSION_LABELS = Object.freeze({
  [PERMISSIONS.PUBLIC]: 'Public',
  [PERMISSIONS.FRIENDS]: 'Friends',
  [PERMISSIONS.FRIEND_PLUS]: 'Friends+',
  [PERMISSIONS.INVITE]: 'Invite',
  [PERMISSIONS.INVITE_PLUS]: 'Invite+',
  [PERMISSIONS.GROUP]: 'Group',
  [PERMISSIONS.GROUP_PLUS]: 'Group+',
  [PERMISSIONS.GROUP_PUBLIC]: 'Group Public',
  [PERMISSIONS.PRIVATE]: 'Private',
  [PERMISSIONS.OFFLINE]: 'Offline',
  [PERMISSIONS.UNKNOWN]: 'Unknown',
});

const ONLINE_STATUS = Object.freeze({
  JOIN_ME: { className: 'online-join-me', label: 'Join Me' },
  ONLINE: { className: 'online-active', label: 'Online' },
  ASK_ME: { className: 'online-ask-me', label: 'Ask Me' },
  DND: { className: 'online-dnd', label: 'Do Not Disturb' },
  WEBSITE: { className: 'online-website', label: 'Other Platform' },
  OFFLINE: { className: 'online-offline', label: 'Offline' },
});

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const ALLOWED_IMAGE_HOSTS = Object.freeze(new Set([
  'vrchat.com',
  'api.vrchat.cloud',
  'files.vrchat.cloud',
]));

/**
 * Only allow images served by VRChat-controlled hosts. Dynamic image URLs
 * come from API responses, so they are validated before entering an <img> src.
 */
export function safeImageUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  try {
    const url = new URL(rawUrl, 'https://vrchat.com/');
    if (url.protocol !== 'https:') return '';
    const host = url.hostname.toLowerCase();
    if (!ALLOWED_IMAGE_HOSTS.has(host)) return '';
    return url.href;
  } catch {
    return '';
  }
}

export function parseLocation(location) {
  if (!location || typeof location !== 'string') return null;
  if (location === 'private') return { worldId: 'private', instanceId: 'private' };
  if (location === 'offline') return { worldId: 'offline', instanceId: 'offline' };
  const separator = location.indexOf(':');
  if (separator < 0) return null;
  return {
    worldId: location.slice(0, separator),
    instanceId: location.slice(separator + 1),
  };
}

export function parseGroupId(location) {
  const match = /~group\(([^)]+)\)/.exec(location || '');
  return match?.[1] || undefined;
}

export function parseGroupAccessType(location) {
  const match = /~groupAccessType\((members|plus|public)\)/.exec(location || '');
  return match?.[1] || 'members';
}

export function parseRegion(location) {
  const match = /~region\(([^)]+)\)/.exec(location || '');
  return match?.[1] || undefined;
}

export function regionLabel(region) {
  if (!region) return '';
  return region === 'use' ? 'USE' : region === 'usw' ? 'USW' : String(region).toUpperCase();
}

export function resolveFriendLocation(friend) {
  if (!friend) return '';
  if (friend.location === 'traveling') return friend.travelingToLocation || '';
  return friend.location || '';
}

export function normalizeFriends(friends) {
  const seen = new Set();
  return (Array.isArray(friends) ? friends : []).filter((friend) => {
    if (!friend?.id || seen.has(friend.id)) return false;
    seen.add(friend.id);
    return true;
  }).map((friend) => {
    if (friend.location !== 'traveling') return friend;
    return { ...friend, location: friend.travelingToLocation || '' };
  });
}

export function deriveCanJoin(friend) {
  const location = resolveFriendLocation(friend);
  return Boolean(location && location !== 'offline' && location !== 'private');
}

export function parseUserOwnerId(location) {
  const match = /(hidden|friends|private)\(([^)]+)\)/.exec(location || '');
  const id = match?.[2];
  return typeof id === 'string' && id.startsWith('usr_') ? id : undefined;
}

export function extractHumanOwnerId(instanceData, location = '') {
  const candidates = [
    instanceData?.ownerId,
    instanceData?.creatorId,
    instanceData?.owner?.id,
    instanceData?.creator?.id,
    instanceData?.hidden,
    instanceData?.friends,
    instanceData?.private,
    parseUserOwnerId(location),
  ];
  return candidates.find((value) => typeof value === 'string' && value.startsWith('usr_'));
}

export function classifyPermission(location, instanceData = null) {
  const parsed = parseLocation(location);
  if (!parsed) return PERMISSIONS.UNKNOWN;
  if (parsed.worldId === 'private') return PERMISSIONS.PRIVATE;
  if (parsed.worldId === 'offline' || !parsed.instanceId) return PERMISSIONS.OFFLINE;

  const groupId = instanceData?.ownerId?.startsWith?.('grp_') ? instanceData.ownerId : parseGroupId(location);
  const groupAccess = instanceData?.groupAccessType || (groupId ? parseGroupAccessType(location) : undefined);
  if (instanceData?.type === 'group' || groupId || groupAccess) {
    if (groupAccess === 'public') return PERMISSIONS.GROUP_PUBLIC;
    if (groupAccess === 'plus') return PERMISSIONS.GROUP_PLUS;
    return PERMISSIONS.GROUP;
  }

  const instanceId = parsed.instanceId;
  if (instanceId.includes('hidden')) return PERMISSIONS.FRIEND_PLUS;
  if (instanceId.includes('friends')) return PERMISSIONS.FRIENDS;
  if (instanceId.includes('private')) {
    return instanceId.includes('canRequestInvite') ? PERMISSIONS.INVITE_PLUS : PERMISSIONS.INVITE;
  }
  if (instanceId.includes('public') || !instanceId.includes('~')) return PERMISSIONS.PUBLIC;
  if (/~region\((?:jp|us|use|usw|eu)\)/.test(instanceId)) return PERMISSIONS.PUBLIC;
  return PERMISSIONS.UNKNOWN;
}

export function permissionLabel(permission) {
  return PERMISSION_LABELS[permission] || permission || 'Unknown';
}

export function permissionBadgeClass(permission) {
  const normalized = permission || PERMISSIONS.UNKNOWN;
  return `perm-${normalized.replace(/_/g, '-').replace(/\+/g, '-plus')}`;
}

export function onlineStatusInfo(friend) {
  const rawStatus = String(friend?.status || friend?.state || '').trim().toLowerCase();
  const platform = String(friend?.platform || '').trim().toLowerCase();

  // `platform: "web"` is the current-platform signal we can use for the
  // website activity state. `last_platform` is intentionally ignored because
  // it describes the last platform used, not necessarily the current one.
  if (platform === 'web'
    || rawStatus === 'on website' || rawStatus === 'on_website' || rawStatus === 'web') {
    return ONLINE_STATUS.WEBSITE;
  }

  switch (rawStatus) {
    case 'active':
    case 'online':
      return ONLINE_STATUS.ONLINE;
    case 'join me':
    case 'join_me':
      return ONLINE_STATUS.JOIN_ME;
    case 'ask me':
    case 'ask_me':
      return ONLINE_STATUS.ASK_ME;
    case 'busy':
    case 'do not disturb':
    case 'do_not_disturb':
      return ONLINE_STATUS.DND;
    case 'offline':
    case '':
      return ONLINE_STATUS.OFFLINE;
    default:
      return ONLINE_STATUS.OFFLINE;
  }
}

export function friendStateText(friend) {
  // `location: "offline"` is also used when a friend is active on the
  // VRChat website. In that case the visible secondary label should describe
  // the actual activity state instead of the location-derived permission.
  if (onlineStatusInfo(friend).className === ONLINE_STATUS.WEBSITE.className) {
    return ONLINE_STATUS.WEBSITE.label;
  }
  return permissionLabel(classifyPermission(resolveFriendLocation(friend)));
}

export function friendIsOnline(friend) {
  return onlineStatusInfo(friend).className !== ONLINE_STATUS.OFFLINE.className;
}

export function isUserOfflineEquivalent(user) {
  if (!user || typeof user !== 'object') return false;

  const rawStatus = String(user.status ?? '').trim().toLowerCase();
  const rawState = String(user.state ?? '').trim().toLowerCase();
  const platform = String(user.platform ?? '').trim().toLowerCase();
  const hasActivityFields = [
    'status', 'state', 'platform', 'location', 'last_platform', 'last_activity', 'last_login',
  ].some((key) => Object.prototype.hasOwnProperty.call(user, key));

  if (!hasActivityFields) return false;
  if (platform === 'web') return false;
  if (rawStatus === 'active' || rawStatus === 'online' || rawStatus === 'join me' || rawStatus === 'join_me'
    || rawStatus === 'ask me' || rawStatus === 'ask_me' || rawStatus === 'busy'
    || rawStatus === 'do not disturb' || rawStatus === 'do_not_disturb') return false;
  if (rawState === 'active' || rawState === 'online') return false;

  return onlineStatusInfo(user).className === ONLINE_STATUS.OFFLINE.className;
}

/**
 * A non-friend owner is considered FOAF only when the Instance response
 * explicitly lists that owner in its `users` field. User-profile activity
 * fields are not used to infer presence because non-friend location/status
 * may be restricted or stale.
 */
export function isFoafPresentInEntry(entry, user) {
  if (!entry?.location || !user?.id) return false;
  const apiUsers = Array.isArray(entry.instanceData?.users) ? entry.instanceData.users : null;
  if (!apiUsers) return false;
  return apiUsers.some((candidate) => {
    const candidateId = typeof candidate === 'string' ? candidate : candidate?.id;
    return candidateId === user.id;
  });
}

export function normalizeUser(user, friendMap = null) {
  if (!user) return null;
  if (typeof user === 'string') {
    const friend = friendMap?.get(user);
    return friend || { id: user, displayName: user };
  }
  return user;
}

export function uniqueUsers(users) {
  const seen = new Set();
  return (users || []).filter((user) => {
    if (!user?.id || seen.has(user.id)) return false;
    seen.add(user.id);
    return true;
  });
}

export function effectiveInstanceUserCount(entry, friendMap = new Map()) {
  if (!entry) return 0;

  const reportedCounts = [
    entry.users,
    entry.instanceData?.n_users,
    entry.instanceData?.userCount,
  ]
    .filter(Number.isFinite)
    .map((value) => Math.max(0, Math.trunc(value)));

  const apiUsers = Array.isArray(entry.instanceData?.users)
    ? entry.instanceData.users
      .map((user) => normalizeUser(user, friendMap))
      .filter(Boolean)
    : [];

  // Friends grouped into `entry.friends` come from the current friend-location
  // list, so they are known to be present at this exact location. An Instance
  // `users` list, when available, is also explicit presence data. The total
  // user count must never be lower than this deduplicated known-present set.
  const knownPresentCount = uniqueUsers([
    ...(entry.friends || []),
    ...apiUsers,
  ]).length;

  return Math.max(knownPresentCount, ...reportedCounts, 0);
}

export function slimWorld(world) {
  if (!world || typeof world !== 'object') return null;
  return {
    id: world.id,
    name: world.name || world.id,
    thumbnailImageUrl: world.thumbnailImageUrl || world.imageUrl || '',
    capacity: Number.isFinite(world.capacity) ? world.capacity : undefined,
    hardCapacity: deriveHardCapacity(world.capacity),
  };
}

export function deriveHardCapacity(capacity) {
  if (!Number.isFinite(capacity)) return undefined;
  return capacity === 1 ? 1 : 2 * capacity;
}

export function buildLocations(friendMap, groupInstances, cacheReader = {}) {
  const byLocation = new Map();
  const getCachedInstance = typeof cacheReader.getCachedInstance === 'function'
    ? cacheReader.getCachedInstance.bind(cacheReader)
    : () => null;
  const getCachedWorld = typeof cacheReader.getCachedWorld === 'function'
    ? cacheReader.getCachedWorld.bind(cacheReader)
    : () => null;

  for (const [location, friends] of friendMap.entries()) {
    const parsed = parseLocation(location) || {};
    byLocation.set(location, {
      location,
      source: 'friend',
      friends: [...friends],
      instanceData: getCachedInstance(location),
      world: parsed.worldId ? getCachedWorld(parsed.worldId) : null,
    });
  }

  for (const raw of Array.isArray(groupInstances) ? groupInstances : []) {
    const location = raw?.location || raw?.instanceId;
    if (!location) continue;
    const current = byLocation.get(location);
    const instanceData = current?.instanceData || raw;
    const parsed = parseLocation(location) || {};
    byLocation.set(location, {
      location,
      source: current ? 'friend+group' : 'group',
      friends: current?.friends || [],
      instanceData,
      world: current?.world || getCachedWorld(parsed.worldId) || slimWorld(raw?.world),
    });
  }

  return [...byLocation.values()].map((entry) => {
    const parsed = parseLocation(entry.location) || {};
    const data = entry.instanceData || {};
    const groupId = data.ownerId?.startsWith?.('grp_') ? data.ownerId : parseGroupId(entry.location);
    const ownerId = extractHumanOwnerId(data, entry.location);
    const groupAccessType = data.groupAccessType || (groupId ? parseGroupAccessType(entry.location) : undefined);
    const permission = classifyPermission(entry.location, { ...data, ownerId: groupId || ownerId || data.ownerId, groupAccessType });
    const userCount = Number.isFinite(data.n_users) ? data.n_users : Number.isFinite(data.userCount) ? data.userCount : undefined;
    const normalized = {
      ...entry,
      worldId: parsed.worldId,
      instanceId: parsed.instanceId,
      instanceName: data.displayName || data.name || '',
      region: data.photonRegion || data.region || parseRegion(entry.location),
      permission,
      permissionLabel: permissionLabel(permission),
      groupId,
      ownerId,
      groupName: data.groupName || data.group?.name || '',
      groupAccessType,
      users: userCount,
      capacity: Number.isFinite(data.capacity) ? data.capacity : entry.world?.capacity,
      world: entry.world || slimWorld(data.world),
    };
    normalized.users = effectiveInstanceUserCount(normalized);
    return normalized;
  });
}

export function mergeInstanceData(entry, data) {
  if (!entry || !data) return false;
  const parsed = parseLocation(entry.location) || {};
  entry.instanceData = data;
  entry.worldId = data.worldId || parsed.worldId;
  entry.instanceId = data.instanceId || data.id || parsed.instanceId;
  entry.instanceName = data.displayName || data.name || entry.instanceName || '';
  entry.region = data.photonRegion || data.region || parseRegion(entry.location);
  entry.permission = classifyPermission(entry.location, data);
  entry.permissionLabel = permissionLabel(entry.permission);
  entry.groupId = data.ownerId?.startsWith?.('grp_') ? data.ownerId : (parseGroupId(entry.location) || entry.groupId);
  entry.ownerId = extractHumanOwnerId(data, entry.location) || entry.ownerId;
  entry.groupName = data.groupName || data.group?.name || entry.groupName || '';
  entry.groupAccessType = data.groupAccessType || (entry.groupId ? parseGroupAccessType(entry.location) : entry.groupAccessType);
  entry.users = Number.isFinite(data.n_users) ? data.n_users : Number.isFinite(data.userCount) ? data.userCount : entry.users;
  entry.users = effectiveInstanceUserCount(entry);
  entry.capacity = Number.isFinite(data.capacity) ? data.capacity : entry.capacity;
  if (data.world) entry.world = slimWorld(data.world) || entry.world;
  return true;
}

export function instanceOwnerId(entry) {
  const ownerId = entry?.ownerId || extractHumanOwnerId(entry?.instanceData, entry?.location);
  return typeof ownerId === 'string' && ownerId.startsWith('usr_') ? ownerId : undefined;
}

export function isFavoriteUser(user, favorites) {
  return Boolean(user?.id && favorites?.has(user.id));
}

export function instanceHasFavorite(entry, favorites, friendMap = new Map()) {
  if (!entry?.location) return false;
  const currentFriends = friendMap ? [...friendMap.values()] : [];

  // Favorite+ is based on a Favorite friend who is currently at this exact
  // location. The instance owner is deliberately NOT an eligibility signal: 
  // an instance owner remains the creator of the instance even after leaving
  // it, so ownerId alone can point at a Favorite friend who is now elsewhere.
  return currentFriends.some((friend) => (
    friend?.id
    && favorites?.has(friend.id)
    && resolveFriendLocation(friend) === entry.location
  ));
}

export function currentFriendParticipants(entry, friendMap = new Map()) {
  const apiUsers = Array.isArray(entry?.instanceData?.users)
    ? entry.instanceData.users.map((user) => normalizeUser(user, friendMap)).filter(Boolean)
    : [];
  const combined = uniqueUsers([...(entry?.friends || []), ...apiUsers]);
  const friendIds = new Set(friendMap ? friendMap.keys() : []);
  return combined.filter((user) => friendIds.has(user?.id));
}

export function instanceUserCountForSort(entry, friendMap = new Map()) {
  return effectiveInstanceUserCount(entry, friendMap);
}

export function friendsCountForEntry(entry, state, friendMap = new Map()) {
  let friends = currentFriendParticipants(entry, friendMap);
  if (state.tab === TABS.FAVORITE_ONLY || state.tab === TABS.FAVORITE_PLUS) {
    if (state.tab === TABS.FAVORITE_ONLY) {
      friends = friends.filter((friend) => state.favorites.has(friend.id));
    }
  }
  return uniqueUsers(friends).length;
}

export function needsInstanceDetailsForFoaf(entry, state, friendMap = new Map()) {
  if (!entry || !state || state.tab !== TABS.FAVORITE_PLUS) return false;
  const ownerId = instanceOwnerId(entry);
  if (!ownerId || friendMap.has(ownerId)) return false;
  // A group-instance summary or a cached partial instance may have an owner
  // but no `users` list. Fetch the full Instance object so FOAF presence can
  // be verified instead of inferred.
  if (Array.isArray(entry.instanceData?.users)) return false;
  return !entry.foafChecked && !entry.instanceFetchFailed;
}

export function needsNonFriendOwnerProfile(entry, friendMap = new Map()) {
  if (!entry) return false;
  const ownerId = instanceOwnerId(entry);
  if (!ownerId || friendMap.has(ownerId)) return false;
  const isGroupInstance = [
    PERMISSIONS.GROUP,
    PERMISSIONS.GROUP_PLUS,
    PERMISSIONS.GROUP_PUBLIC,
  ].includes(entry.permission);
  if (!isGroupInstance) return false;
  return !entry.ownerUser && !entry.ownerUserLoaded;
}

export function shouldFetchNonFriendOwner(entry, state, friendMap = new Map()) {
  if (!entry || !state || state.tab !== TABS.FAVORITE_PLUS) return false;
  const ownerId = instanceOwnerId(entry);
  if (!ownerId || friendMap.has(ownerId)) return false;
  if (entry.ownerUser || entry.ownerUserLoaded) return false;

  // Only an explicit owner ID in Instance `users` qualifies as FOAF presence.
  if (!Array.isArray(entry.instanceData?.users)) return false;
  return entry.instanceData.users.some((candidate) => {
    const candidateId = typeof candidate === 'string' ? candidate : candidate?.id;
    return candidateId === ownerId;
  });
}

export function participantsForEntry(entry, state, friendMap) {
  if ((state.tab === TABS.FAVORITE_PLUS || state.tab === TABS.FAVORITE_ONLY)
    && !instanceHasFavorite(entry, state.favorites, friendMap)) {
    return [];
  }

  const apiUsers = Array.isArray(entry?.instanceData?.users)
    ? entry.instanceData.users.map((user) => normalizeUser(user, friendMap))
    : [];
  const combined = uniqueUsers([...(entry?.friends || []), ...apiUsers]);
  const ownerId = instanceOwnerId(entry);
  const ownerKnown = ownerId
    ? [
        ...(entry?.ownerUser ? [entry.ownerUser] : []),
        ...(entry.instanceData?.owner && typeof entry.instanceData.owner === 'object' ? [entry.instanceData.owner] : []),
        ...apiUsers,
        ...(entry?.friends || []),
      ].find((user) => user?.id === ownerId) || null
    : null;

  if (state.tab === TABS.FAVORITE_PLUS || state.tab === TABS.FAVORITE_ONLY) {
    const friendIds = new Set(state.friends.map((friend) => friend.id).filter(Boolean));
    const selectedFriends = combined
      .filter((user) => friendIds.has(user.id))
      .filter((user) => state.tab !== TABS.FAVORITE_ONLY || state.favorites.has(user.id));

    // A non-friend owner is allowed to be shown, but only when this instance
    // has at least one qualifying Favorite friend. This prevents a Favorite+
    // card from containing only an unrelated non-friend owner.
    const selected = [...selectedFriends];
    if (selectedFriends.length > 0 && ownerKnown && !friendIds.has(ownerKnown.id)
      && isFoafPresentInEntry(entry, ownerKnown)) {
      selected.unshift(ownerKnown);
    }
    return uniqueUsers(selected);
  }

  const withKnownOwner = ownerKnown && !combined.some((user) => user?.id === ownerKnown.id)
    ? [ownerKnown, ...combined]
    : combined;
  return uniqueUsers(withKnownOwner);
}

export function sortParticipants(entry, participants, state) {
  const ownerId = instanceOwnerId(entry);
  const friendIds = new Set(state.friends.map((friend) => friend.id).filter(Boolean));
  const rank = (user) => {
    if (ownerId && user?.id === ownerId) return 0;
    if (isFavoriteUser(user, state.favorites)) return 1;
    if (user?.id && friendIds.has(user.id)) return 2;
    return 3;
  };

  return [...(participants || [])].sort((a, b) => {
    const rankDiff = rank(a) - rank(b);
    if (rankDiff) return rankDiff;
    return String(a?.displayName || a?.username || a?.id || '').localeCompare(
      String(b?.displayName || b?.username || b?.id || ''),
      'ja',
    );
  });
}

export function filterAndSortInstances(instances, state, friendMap) {
  let data = [...(instances || [])];
  if (state.tab === TABS.FAVORITE_PLUS || state.tab === TABS.FAVORITE_ONLY) {
    data = data.filter((entry) => instanceHasFavorite(entry, state.favorites, friendMap));
  } else if (state.tab === TABS.GROUPS) {
    data = data.filter((entry) => Boolean(entry.groupId));
  }

  const privateInstances = data.filter((entry) => entry.permission === PERMISSIONS.PRIVATE);
  const sortable = data.filter((entry) => entry.permission !== PERMISSIONS.PRIVATE);

  // Precompute all comparator inputs once. The previous implementation called
  // friendsCountForEntry()/instanceUserCountForSort() repeatedly from Array.sort
  // comparators; with many instances that becomes unnecessarily expensive.
  const decorated = sortable.map((entry, index) => ({
    entry,
    index,
    friendCount: friendsCountForEntry(entry, state, friendMap),
    userCount: instanceUserCountForSort(entry, friendMap),
  }));

  const byNameThenOrder = (a, b) => {
    const nameDiff = String(a.entry.world?.name || a.entry.worldId || '').localeCompare(
      String(b.entry.world?.name || b.entry.worldId || ''),
      'ja',
    );
    return nameDiff || a.index - b.index;
  };

  if (state.sort === 'users_desc') {
    decorated.sort((a, b) => (
      b.userCount - a.userCount
      || b.friendCount - a.friendCount
      || byNameThenOrder(a, b)
    ));
  } else {
    const friendVisibilityRank = (item) => item.friendCount > 0 ? 0 : 1;
    decorated.sort((a, b) => (
      friendVisibilityRank(a) - friendVisibilityRank(b)
      || b.friendCount - a.friendCount
      || b.userCount - a.userCount
      || byNameThenOrder(a, b)
    ));
  }

  return decorated.map((item) => item.entry).concat(privateInstances);
}

export function createFriendLocationMap(friends) {
  const map = new Map();
  for (const friend of friends || []) {
    const location = resolveFriendLocation(friend);
    if (!location || location === 'offline') continue;
    const current = map.get(location);
    if (current) current.push(friend);
    else map.set(location, [friend]);
  }
  return map;
}
