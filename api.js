import { CONFIG } from './config.js';
import { ObjectCache, ValueCache, accountCacheKey } from './storage.js';
import { slimWorld } from './domain.js';
import { fetchUsingVrchatSession } from './session.js';

export class ApiError extends Error {
  constructor(status, message = `VRChat API ${status}`) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

class RequestGate {
  constructor(intervalMs) {
    this.intervalMs = intervalMs;
    this.nextAllowedAt = 0;
    this.tail = Promise.resolve();
  }

  acquire() {
    const ticket = this.tail.then(async () => {
      const delay = Math.max(0, this.nextAllowedAt - Date.now());
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      this.nextAllowedAt = Date.now() + this.intervalMs;
    });
    this.tail = ticket.catch(() => {});
    return ticket;
  }
}

export class VrchatApiClient {
  constructor(baseUrl = CONFIG.API_BASE) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.gate = new RequestGate(CONFIG.API_MIN_INTERVAL_MS);
  }

  async fetchJson(path, options = {}) {
    const url = /^https?:\/\//i.test(path) ? path : `${this.baseUrl}${path}`;

    for (let attempt = 0; attempt <= CONFIG.API_MAX_RETRIES; attempt += 1) {
      await this.gate.acquire();

      const response = await fetchUsingVrchatSession(url, {
        method: options.method || 'GET',
        headers: {
          Accept: 'application/json',
          ...(options.headers || {}),
        },
        body: typeof options.body === 'string' ? options.body : undefined,
      });

      if (response.ok) {
        try {
          return JSON.parse(response.text);
        } catch {
          throw new ApiError(response.status, 'VRChat API returned invalid JSON');
        }
      }

      if (response.status !== 429 || attempt >= CONFIG.API_MAX_RETRIES) {
        throw new ApiError(response.status);
      }

      const retryAfter = Number(response.headers?.['retry-after']);
      const backoffMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 1000 * (2 ** attempt);
      await new Promise((resolve) => setTimeout(resolve, Math.min(backoffMs, 15000)));
    }

    throw new ApiError(599, 'VRChat API request failed');
  }

  fetchMe() {
    return this.fetchJson('/auth/user');
  }

  fetchFriendsPage(offset) {
    return this.fetchJson(`/auth/user/friends?n=100&offset=${offset}&offline=false&v=2`);
  }

  async fetchFriends() {
    const friends = [];
    for (let offset = 0; offset < CONFIG.MAX_FRIENDS; offset += 100) {
      const page = await this.fetchFriendsPage(offset);
      const rows = Array.isArray(page) ? page : [];
      friends.push(...rows);
      if (rows.length < 100) break;
    }
    return dedupeById(friends).slice(0, CONFIG.MAX_FRIENDS);
  }

  async fetchFavorites() {
    const favorites = [];
    for (let offset = 0; offset < CONFIG.MAX_FAVORITES; offset += 100) {
      const page = await this.fetchJson(`/favorites?type=friend&n=100&offset=${offset}`);
      const rows = Array.isArray(page) ? page : [];
      favorites.push(...rows);
      if (rows.length < 100) break;
    }

    const byFavoriteId = new Map();
    for (const item of favorites) {
      const favoriteId = item?.favoriteId;
      if (!favoriteId) continue;
      const current = byFavoriteId.get(favoriteId) || { favoriteId, tags: [] };
      const tags = Array.isArray(item?.tags) ? item.tags.filter((tag) => typeof tag === 'string') : [];
      current.tags = [...new Set([...current.tags, ...tags])];
      byFavoriteId.set(favoriteId, current);
    }
    return [...byFavoriteId.values()].slice(0, CONFIG.MAX_FAVORITES);
  }

  fetchFavoriteGroups() {
    return this.fetchJson('/favorite/groups?type=friend&n=100&offset=0');
  }

  fetchGroupInstances(userId) {
    return this.fetchJson(`/users/${encodeURIComponent(userId)}/instances/groups`);
  }

  inviteMyselfTo(location) {
    const encodedPath = encodeInstancePath(location);
    return this.fetchJson(`/invite/myself/to/${encodedPath}`, { method: 'POST' });
  }

  fetchGroup(groupId) {
    return this.fetchJson(`/groups/${encodeURIComponent(groupId)}`);
  }

  fetchInstance(location) {
    const encodedPath = encodeInstancePath(location);
    return this.fetchJson(`/instances/${encodedPath}`);
  }

  fetchWorld(worldId) {
    return this.fetchJson(`/worlds/${encodeURIComponent(worldId)}`);
  }

  fetchUser(userId) {
    return this.fetchJson(`/users/${encodeURIComponent(userId)}`);
  }
}

function isValidInviteLocation(location) {
  if (typeof location !== 'string' || !location) return false;
  const separator = location.indexOf(':');
  if (separator <= 0 || separator === location.length - 1) return false;
  const worldId = location.slice(0, separator);
  return worldId.startsWith('wrld_') && location !== 'private' && location !== 'offline';
}

const FRIEND_FAVORITE_GROUP_SLOTS = Object.freeze(['group_0', 'group_1', 'group_2']);

function normalizeFavoriteCacheData(items, rawGroups) {
  const favoriteItems = Array.isArray(items)
    ? items
      .filter((item) => item?.favoriteId)
      .map((item) => ({
        favoriteId: item.favoriteId,
        tags: Array.isArray(item.tags) ? item.tags.filter((tag) => typeof tag === 'string') : [],
      }))
    : [];

  const groupsByName = new Map(
    (Array.isArray(rawGroups) ? rawGroups : [])
      .filter((group) => group && (group.type === 'friend' || !group.type))
      .map((group) => [group.name, group]),
  );

  const groups = FRIEND_FAVORITE_GROUP_SLOTS.map((name, index) => {
    const source = groupsByName.get(name) || {};
    const displayName = source.displayName || source.display_name || `グループ${index + 1}`;
    const memberIds = favoriteItems
      .filter((item) => item.tags.includes(name))
      .map((item) => item.favoriteId);
    return { name, displayName, memberIds: [...new Set(memberIds)] };
  });

  return {
    ids: [...new Set(favoriteItems.map((item) => item.favoriteId))],
    groups,
  };
}

function favoriteStateFromCachedData(cached) {
  if (Array.isArray(cached)) {
    return {
      ids: new Set(cached.filter(Boolean)),
      groups: FRIEND_FAVORITE_GROUP_SLOTS.map((name, index) => ({
        name,
        displayName: `グループ${index + 1}`,
        memberIds: new Set(),
      })),
    };
  }

  const ids = Array.isArray(cached?.ids) ? cached.ids.filter(Boolean) : [];
  const cachedGroups = Array.isArray(cached?.groups) ? cached.groups : [];
  const groupsByName = new Map(cachedGroups.map((group) => [group?.name, group]));
  const groups = FRIEND_FAVORITE_GROUP_SLOTS.map((name, index) => {
    const source = groupsByName.get(name) || {};
    return {
      name,
      displayName: source.displayName || `グループ${index + 1}`,
      memberIds: new Set(Array.isArray(source.memberIds) ? source.memberIds.filter(Boolean) : []),
    };
  });
  return { ids: new Set(ids), groups };
}

export class DataRepository {
  constructor(api, storage) {
    this.api = api;
    this.storage = storage;
    this.userDetailCache = new ObjectCache(storage, CONFIG.USER_DETAIL_CACHE_KEY, 500);
    this.instanceCache = new ObjectCache(storage, CONFIG.INSTANCE_CACHE_KEY, 200);
    this.worldCache = new ObjectCache(storage, CONFIG.WORLD_CACHE_KEY, 500);
    this.groupCache = new ObjectCache(storage, CONFIG.GROUP_CACHE_KEY, 300);
    this.currentUserId = null;
    this.friendCache = null;
    this.favoriteCache = null;
    this.groupInstancesCache = null;
    this.usedStaleFallback = false;
    this.primaryDataUpdatedAt = 0;
  }

  setCurrentUser(userId) {
    if (!userId || typeof userId !== 'string') throw new Error('A VRChat user ID is required.');
    this.currentUserId = userId;
    // A login/account switch starts a new primary-data lifecycle. Do not carry
    // stale-fallback state or a previous account's timestamp into the new one.
    this.usedStaleFallback = false;
    this.primaryDataUpdatedAt = 0;
    this.friendCache = new ValueCache(
      this.storage,
      accountCacheKey(CONFIG.FRIEND_CACHE_KEY, userId),
      CONFIG.FRIEND_CACHE_TTL_MS,
    );
    this.favoriteCache = new ValueCache(
      this.storage,
      accountCacheKey(CONFIG.FAVORITE_CACHE_KEY, userId),
      CONFIG.FAVORITE_CACHE_TTL_MS,
    );
    this.groupInstancesCache = new ValueCache(
      this.storage,
      accountCacheKey(CONFIG.GROUP_INSTANCES_CACHE_KEY, userId),
      CONFIG.GROUP_INSTANCES_CACHE_TTL_MS,
    );
  }

  requireCurrentUser() {
    if (!this.currentUserId || !this.friendCache || !this.favoriteCache || !this.groupInstancesCache) {
      throw new Error('Current VRChat user is not initialized.');
    }
  }

  async fetchUser(userId) {
    if (!userId) return null;
    const cached = this.userDetailCache.getRecord(userId, CONFIG.USER_DETAIL_CACHE_TTL_MS);
    if (cached) return cached.data;

    try {
      const data = await this.api.fetchUser(userId);
      const normalized = {
        id: data?.id || userId,
        displayName: data?.displayName || data?.username || userId,
        username: data?.username || '',
        iconUrl: data?.iconUrl || '',
        userIcon: data?.userIcon || '',
        currentAvatarThumbnailImageUrl: data?.currentAvatarThumbnailImageUrl || '',
        profilePicOverride: data?.profilePicOverride || '',
        imageUrl: data?.imageUrl || '',
        isFriend: Boolean(data?.isFriend),
        location: data?.location || '',
        travelingToLocation: data?.travelingToLocation || '',
        status: data?.status || '',
        statusDescription: data?.statusDescription || '',
        state: data?.state || '',
        platform: data?.platform || '',
        last_platform: data?.last_platform || '',
      };
      this.userDetailCache.set(userId, normalized);
      return normalized;
    } catch (error) {
      if (error?.status >= 400 && error.status < 500) {
        this.userDetailCache.setRecord(userId, null, { status: error.status });
      }
      if (error?.status === 401) throw error;
      return null;
    }
  }

  getCachedFriends() {
    return this.friendCache?.get() || null;
  }

  getCachedFavorites() {
    return this.favoriteCache?.get() || null;
  }

  getCachedGroupInstances(userId) {
    if (!userId || userId !== this.currentUserId || !this.groupInstancesCache) return [];
    const data = this.groupInstancesCache.get();
    if (!data || data.userId !== userId) return [];
    return Array.isArray(data.items) ? data.items : [];
  }

  getCachedInstance(location) {
    return this.instanceCache.get(location, CONFIG.INSTANCE_CACHE_TTL_MS);
  }

  getCachedWorld(worldId) {
    return this.worldCache.get(worldId, CONFIG.WORLD_CACHE_TTL_MS);
  }

  async fetchMe() {
    const user = await this.api.fetchMe();
    if (!user?.id) throw new ApiError(200, 'VRChat account information did not include a user ID');
    this.setCurrentUser(user.id);
    return user;
  }

  async fetchFriends() {
    this.requireCurrentUser();
    // Friend status is time-sensitive (including `Other Platform`). Always ask
    // VRChat for the current friend list on a normal load/reload. Keep the
    // same-account cache only as a transient-error fallback.
    try {
      const friends = await this.api.fetchFriends();
      this.friendCache.set(friends);
      this.primaryDataUpdatedAt = Math.max(this.primaryDataUpdatedAt, Date.now());
      return friends;
    } catch (error) {
      if (error?.status === 401) throw error;
      const record = this.friendCache.getStaleRecord();
      const cached = record?.data;
      if (Array.isArray(cached)) {
        this.usedStaleFallback = true;
        if (Number.isFinite(record?.cachedAt)) this.primaryDataUpdatedAt = Math.max(this.primaryDataUpdatedAt, record.cachedAt);
        return cached;
      }
      throw error;
    }
  }

  async fetchFavorites() {
    this.requireCurrentUser();
    // Fetch both friend favorites and their editable Favorite List metadata.
    // Favorites carry internal list tags (group_0..), while /favorite/groups
    // provides the user-edited display names for those lists.
    try {
      const [items, rawGroups] = await Promise.all([
        this.api.fetchFavorites(),
        this.api.fetchFavoriteGroups().catch((error) => {
          if (error?.status === 401) throw error;
          return [];
        }),
      ]);
      const cachedData = normalizeFavoriteCacheData(items, rawGroups);
      this.favoriteCache.set(cachedData);
      this.primaryDataUpdatedAt = Math.max(this.primaryDataUpdatedAt, Date.now());
      return favoriteStateFromCachedData(cachedData);
    } catch (error) {
      if (error?.status === 401) throw error;
      const record = this.favoriteCache.getStaleRecord();
      const cached = record?.data;
      if (cached != null) {
        this.usedStaleFallback = true;
        if (Number.isFinite(record?.cachedAt)) this.primaryDataUpdatedAt = Math.max(this.primaryDataUpdatedAt, record.cachedAt);
      }
      return favoriteStateFromCachedData(cached);
    }
  }

  async inviteMyselfTo(location) {
    this.requireCurrentUser();
    if (!isValidInviteLocation(location)) {
      throw new Error('Invalid instance location.');
    }
    return this.api.inviteMyselfTo(location);
  }

  async fetchGroupInstances(userId) {
    this.requireCurrentUser();
    if (userId !== this.currentUserId) throw new Error('Group instance request account mismatch.');
    try {
      const raw = await this.api.fetchGroupInstances(userId);
      const items = Array.isArray(raw) ? raw : Array.isArray(raw?.instances) ? raw.instances : [];
      this.groupInstancesCache.set({ userId, items });
      return items;
    } catch (error) {
      if (error?.status === 401) throw error;
      const cached = this.groupInstancesCache.getStale();
      if (cached?.userId === userId && Array.isArray(cached.items)) {
        this.usedStaleFallback = true;
        return cached.items;
      }
      return [];
    }
  }

  async fetchGroup(groupId) {
    if (!groupId) return null;
    const cached = this.groupCache.getRecord(groupId, CONFIG.GROUP_CACHE_TTL_MS);
    if (cached) return cached.data;

    try {
      const data = await this.api.fetchGroup(groupId);
      const normalized = {
        id: data?.id || groupId,
        groupId: data?.id || groupId,
        name: data?.name || data?.displayName || '',
        shortCode: data?.shortCode || '',
        iconUrl: data?.iconUrl || '',
      };
      this.groupCache.set(groupId, normalized);
      return normalized;
    } catch (error) {
      if (error?.status >= 400 && error.status < 500) {
        this.groupCache.setRecord(groupId, null, { status: error.status });
      }
      return null;
    }
  }

  async fetchInstance(location) {
    const cached = this.instanceCache.get(location, CONFIG.INSTANCE_CACHE_TTL_MS);
    if (cached !== null) return cached;
    const data = await this.api.fetchInstance(location);
    this.instanceCache.set(location, data);
    return data;
  }

  async fetchWorld(worldId) {
    if (!worldId || worldId === 'offline' || worldId === 'private') return null;
    const cached = this.worldCache.get(worldId, CONFIG.WORLD_CACHE_TTL_MS);
    if (cached !== null) return cached;
    const data = await this.api.fetchWorld(worldId);
    const normalized = slimWorld(data);
    this.worldCache.set(worldId, normalized);
    return normalized;
  }
}

export function encodeInstancePath(location) {
  if (!location || typeof location !== 'string') throw new Error('Invalid instance location');
  const separator = location.indexOf(':');
  if (separator < 0) throw new Error('Invalid instance location');
  const worldId = location.slice(0, separator);
  const instanceId = location.slice(separator + 1);
  return `${encodeURIComponent(worldId)}:${encodeURIComponent(instanceId)}`;
}

function dedupeById(items) {
  const seen = new Set();
  return items.filter((item) => {
    const id = item?.id;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
