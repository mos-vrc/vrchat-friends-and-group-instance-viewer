import { abortError, waitUntil, waitForVisible } from './request-policy.js';
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

export class VrchatApiClient {
  constructor(baseUrl = CONFIG.API_BASE) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.controller = new AbortController();
  }

  abort() { this.controller.abort(); }

  async fetchJson(path, options = {}) {
    const url = /^https?:\/\//i.test(path) ? path : `${this.baseUrl}${path}`;
    const method = (options.method || 'GET').toUpperCase();
    const signal = this.controller.signal;
    let attempt = 0;
    while (true) {
      if (signal.aborted) throw abortError();
      if (method === 'GET') await waitForVisible(signal);
      let response;
      try { response = await fetchUsingVrchatSession(url, {
        method, headers: options.headers,
        body: typeof options.body === 'string' ? options.body : undefined,
      }); } catch (error) {
        if (signal.aborted) throw abortError();
        error.outcomeUnknown = method !== 'GET' && error?.code !== 'INVALID_URL';
        throw error;
      }
      if (signal.aborted) throw abortError();
      if (response.deferred) {
        await waitUntil(Math.max(Date.now() + 25, response.retryAt), signal);
        continue;
      }
      if (response.ok) {
        if (response.status === 204 || !response.text.trim()) return null;
        try { return JSON.parse(response.text); }
        catch {
          const error = new ApiError(response.status, 'VRChat API returned invalid JSON');
          error.outcomeUnknown = method !== 'GET';
          throw error;
        }
      }
      // Retry rejected writes only for 429. Never replay an uncertain write.
      const canRetry = response.status === 429 || (method === 'GET' && response.status >= 500);
      if (canRetry && attempt < CONFIG.API_MAX_RETRIES) {
        const fallback = Date.now() + 1000 * (2 ** attempt);
        attempt += 1;
        await waitUntil(Math.max(fallback, response.retryAt), signal);
        continue;
      }
      const error = new ApiError(response.status, response.code === 'TIMEOUT'
        ? '通信がタイムアウトしました。時間をおいて再試行してください。'
        : `VRChat API ${response.status}`);
      error.code = response.code;
      error.outcomeUnknown = method !== 'GET' && (response.outcomeUnknown || response.status === 0 || response.status >= 500);
      throw error;
    }
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
      const current = byFavoriteId.get(favoriteId) || { favoriteId, tags: [], recordIds: [] };
      const tags = Array.isArray(item?.tags) ? item.tags.filter((tag) => typeof tag === 'string') : [];
      const recordId = typeof item?.id === 'string' && item.id.startsWith('fvrt_') ? item.id : '';
      current.tags = [...new Set([...current.tags, ...tags])];
      if (recordId) current.recordIds = [...new Set([...current.recordIds, recordId])];
      byFavoriteId.set(favoriteId, current);
    }
    return [...byFavoriteId.values()].slice(0, CONFIG.MAX_FAVORITES);
  }

  fetchFavoriteGroups() {
    return this.fetchJson('/favorite/groups?type=friend&n=100&offset=0');
  }

  addFriendFavorite(userId, tags) {
    if (typeof userId !== 'string' || !userId.startsWith('usr_')) throw new Error('Invalid friend user ID.');
    const normalizedTags = [...new Set((Array.isArray(tags) ? tags : []).filter((tag) => FRIEND_FAVORITE_GROUP_SLOTS.includes(tag)))];
    if (!normalizedTags.length) throw new Error('A Favorite List is required.');
    return this.fetchJson('/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'friend', favoriteId: userId, tags: normalizedTags }),
    });
  }

  removeFavoriteRecord(favoriteRecordId) {
    if (typeof favoriteRecordId !== 'string' || !favoriteRecordId.startsWith('fvrt_')) {
      throw new Error('Invalid Favorite record ID.');
    }
    return this.fetchJson(`/favorites/${encodeURIComponent(favoriteRecordId)}`, { method: 'DELETE' });
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

function normalizeFavoriteCacheData(items, rawGroups, fallbackGroups = []) {
  const favoriteItems = Array.isArray(items)
    ? items
      .filter((item) => item?.favoriteId)
      .map((item) => ({
        favoriteId: item.favoriteId,
        tags: Array.isArray(item.tags) ? item.tags.filter((tag) => typeof tag === 'string') : [],
        recordIds: Array.isArray(item.recordIds)
          ? item.recordIds.filter((id) => typeof id === 'string' && id.startsWith('fvrt_'))
          : (typeof item.id === 'string' && item.id.startsWith('fvrt_') ? [item.id] : []),
      }))
    : [];

  const groupsByName = new Map(
    (Array.isArray(rawGroups) ? rawGroups : [])
      .filter((group) => group && (group.type === 'friend' || !group.type))
      .map((group) => [group.name, group]),
  );
  const fallbackGroupsByName = new Map(
    (Array.isArray(fallbackGroups) ? fallbackGroups : [])
      .filter((group) => group?.name)
      .map((group) => [group.name, group]),
  );

  const groups = FRIEND_FAVORITE_GROUP_SLOTS.map((name, index) => {
    const source = groupsByName.get(name) || {};
    const fallback = fallbackGroupsByName.get(name) || {};
    const displayName = source.displayName
      || source.display_name
      || fallback.displayName
      || fallback.display_name
      || `Favorite List ${index + 1}`;
    const memberIds = favoriteItems
      .filter((item) => item.tags.includes(name))
      .map((item) => item.favoriteId);
    return { name, displayName, memberIds: [...new Set(memberIds)] };
  });

  return {
    ids: [...new Set(favoriteItems.map((item) => item.favoriteId))],
    groups,
    records: favoriteItems.map((item) => ({
      favoriteId: item.favoriteId,
      tags: [...new Set(item.tags)],
      recordIds: [...new Set(item.recordIds)],
    })),
  };
}

function favoriteStateFromCachedData(cached) {
  if (Array.isArray(cached)) {
    return {
      ids: new Set(cached.filter(Boolean)),
      groups: FRIEND_FAVORITE_GROUP_SLOTS.map((name, index) => ({
        name,
        displayName: `Favorite List ${index + 1}`,
        memberIds: new Set(),
      })),
      records: new Map(),
    };
  }

  const ids = Array.isArray(cached?.ids) ? cached.ids.filter(Boolean) : [];
  const cachedGroups = Array.isArray(cached?.groups) ? cached.groups : [];
  const groupsByName = new Map(cachedGroups.map((group) => [group?.name, group]));
  const groups = FRIEND_FAVORITE_GROUP_SLOTS.map((name, index) => {
    const source = groupsByName.get(name) || {};
    return {
      name,
      displayName: source.displayName || `Favorite List ${index + 1}`,
      memberIds: new Set(Array.isArray(source.memberIds) ? source.memberIds.filter(Boolean) : []),
    };
  });
  const rawRecords = Array.isArray(cached?.records) ? cached.records : [];
  const records = new Map(rawRecords
    .filter((item) => item?.favoriteId)
    .map((item) => [item.favoriteId, {
      favoriteId: item.favoriteId,
      tags: [...new Set(Array.isArray(item.tags) ? item.tags.filter((tag) => typeof tag === 'string') : [])],
      recordIds: [...new Set(Array.isArray(item.recordIds) ? item.recordIds.filter((id) => typeof id === 'string' && id.startsWith('fvrt_')) : [])],
    }]));
  return { ids: new Set(ids), groups, records };
}

function favoriteCacheDataFromState(state) {
  return {
    ids: [...state.ids],
    groups: state.groups.map((group) => ({
      name: group.name,
      displayName: group.displayName,
      memberIds: [...group.memberIds],
    })),
    records: [...state.records.values()].map((record) => ({
      favoriteId: record.favoriteId,
      tags: [...new Set(record.tags || [])],
      recordIds: [...new Set(record.recordIds || [])],
    })),
  };
}

function applyLocalFavoriteMutation(cached, { userId, groupName = '', remove = false, createdRecord = null } = {}) {
  const state = favoriteStateFromCachedData(cached);
  if (!userId) return state;

  state.ids.delete(userId);
  state.records.delete(userId);
  state.groups.forEach((group) => group.memberIds.delete(userId));

  if (!remove) {
    state.ids.add(userId);
    const recordId = typeof createdRecord?.id === 'string' && createdRecord.id.startsWith('fvrt_')
      ? createdRecord.id
      : '';
    const tags = Array.isArray(createdRecord?.tags)
      ? createdRecord.tags.filter((tag) => FRIEND_FAVORITE_GROUP_SLOTS.includes(tag))
      : [groupName];
    const normalizedTags = tags.length ? [...new Set(tags)] : [groupName];
    state.records.set(userId, {
      favoriteId: userId,
      tags: normalizedTags,
      recordIds: recordId ? [recordId] : [],
    });
    const group = state.groups.find((candidate) => candidate.name === groupName);
    group?.memberIds.add(userId);
  }
  return state;
}

export class DataRepository {
  constructor(api, storage) {
    this.epoch = 0;
    this.disposed = false;
    this.inflight = new Map();
    this.rawApi = api;
    this.api = new Proxy(api, {
      get: (target, name) => typeof target[name] === 'function' ? async (...args) => {
        const epoch = this.epoch;
        this.assertActive(epoch);
        try {
          const result = await target[name](...args);
          this.assertActive(epoch);
          return result;
        } catch (error) {
          this.assertActive(epoch);
          throw error;
        }
      } : target[name],
    });
    this.storage = storage;
    this.userDetailCache = null;
    this.instanceCache = null;
    this.worldCache = null;
    this.groupCache = null;
    this.currentUserId = null;
    this.friendCache = null;
    this.favoriteCache = null;
    this.groupInstancesCache = null;
    this.usedStaleFallback = false;
    this.primaryDataUpdatedAt = 0;
  }

  assertActive(epoch = this.epoch) {
    if (this.disposed || epoch !== this.epoch) throw abortError();
  }

  dispose() {
    this.disposed = true;
    this.epoch += 1;
    this.rawApi.abort?.();
    this.inflight.clear();
    for (const cache of [this.userDetailCache, this.instanceCache, this.worldCache, this.groupCache]) cache?.dispose();
  }

  singleFlight(key, loader) {
    if (this.inflight.has(key)) return this.inflight.get(key);
    const epoch = this.epoch;
    const task = Promise.resolve().then(() => { this.assertActive(epoch); return loader(); })
      .finally(() => { if (this.inflight.get(key) === task) this.inflight.delete(key); });
    this.inflight.set(key, task);
    return task;
  }

  setCurrentUser(userId) {
    if (!userId || typeof userId !== 'string') throw new Error('A VRChat user ID is required.');
    this.assertActive();
    this.epoch += 1;
    this.inflight.clear();
    for (const cache of [this.userDetailCache, this.instanceCache, this.worldCache, this.groupCache]) cache?.dispose();
    this.currentUserId = userId;
    this.userDetailCache = new ObjectCache(this.storage, accountCacheKey(CONFIG.USER_DETAIL_CACHE_KEY, userId), 500);
    this.instanceCache = new ObjectCache(this.storage, accountCacheKey(CONFIG.INSTANCE_CACHE_KEY, userId), 200);
    this.worldCache = new ObjectCache(this.storage, accountCacheKey(CONFIG.WORLD_CACHE_KEY, userId), 500);
    this.groupCache = new ObjectCache(this.storage, accountCacheKey(CONFIG.GROUP_CACHE_KEY, userId), 300);
    // Older unscoped detail records cannot be attributed to a logged-in account.
    for (const key of [CONFIG.USER_DETAIL_CACHE_KEY, CONFIG.INSTANCE_CACHE_KEY, CONFIG.WORLD_CACHE_KEY, CONFIG.GROUP_CACHE_KEY]) this.storage.remove?.(key);
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
    this.assertActive();
    if (!this.currentUserId || !this.friendCache || !this.favoriteCache || !this.groupInstancesCache) {
      throw new Error('Current VRChat user is not initialized.');
    }
  }

  fetchUser(userId) {
    this.requireCurrentUser();
    return this.singleFlight('fetchUser:' + userId, () => this.fetchUserUncached(userId));
  }

  async fetchUserUncached(userId) {
    if (!userId) return null;
    const cached = this.userDetailCache.getRecord(userId, CONFIG.USER_DETAIL_CACHE_TTL_MS, CONFIG.GROUP_FAILURE_CACHE_TTL_MS);
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
      if (error?.name === 'AbortError') throw error;
      if ([403, 404].includes(error?.status)) {
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
    return this.instanceCache?.get(location, CONFIG.INSTANCE_CACHE_TTL_MS) ?? null;
  }

  getCachedWorld(worldId) {
    return this.worldCache?.get(worldId, CONFIG.WORLD_CACHE_TTL_MS) ?? null;
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
      if (error?.name === 'AbortError') throw error;
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

  async fetchFavoritesStrict() {
    this.requireCurrentUser();
    const items = await this.api.fetchFavorites();
    let rawGroups = [];
    let fallbackGroups = [];
    try {
      rawGroups = await this.api.fetchFavoriteGroups();
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      if (error?.status === 401) throw error;
      const cached = this.favoriteCache.getStaleRecord()?.data;
      fallbackGroups = Array.isArray(cached?.groups) ? cached.groups : [];
    }
    const cachedData = normalizeFavoriteCacheData(items, rawGroups, fallbackGroups);
    this.favoriteCache.set(cachedData);
    this.primaryDataUpdatedAt = Math.max(this.primaryDataUpdatedAt, Date.now());
    return favoriteStateFromCachedData(cachedData);
  }

  async fetchFavorites() {
    this.requireCurrentUser();
    // Fetch both friend favorites and their editable Favorite List metadata.
    // Favorites carry internal list tags (group_0..), while /favorite/groups
    // provides the user-edited display names for those lists.
    try {
      return await this.fetchFavoritesStrict();
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
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

  async syncFavoritesAfterMutation(localMutation) {
    try {
      return { favoriteState: await this.fetchFavoritesStrict(), syncFailed: false, syncError: null };
    } catch (syncError) {
      if (syncError?.name === 'AbortError') throw syncError;
      const cached = this.favoriteCache.getStaleRecord()?.data;
      const favoriteState = applyLocalFavoriteMutation(cached, localMutation);
      this.favoriteCache.set(favoriteCacheDataFromState(favoriteState));
      return { favoriteState, syncFailed: true, syncError };
    }
  }

  async setFriendFavoriteGroup(userId, groupName, currentRecord = null) {
    this.requireCurrentUser();
    if (!FRIEND_FAVORITE_GROUP_SLOTS.includes(groupName)) throw new Error('Invalid Favorite List.');
    const oldRecordIds = [...new Set(Array.isArray(currentRecord?.recordIds) ? currentRecord.recordIds : [])];
    const oldTags = [...new Set(Array.isArray(currentRecord?.tags)
      ? currentRecord.tags.filter((tag) => FRIEND_FAVORITE_GROUP_SLOTS.includes(tag))
      : [])];
    if (oldTags.length === 1 && oldTags[0] === groupName && oldRecordIds.length) {
      return { favoriteState: await this.fetchFavoritesStrict(), syncFailed: false, syncError: null };
    }

    const deletedIds = [];
    try {
      for (const recordId of oldRecordIds) {
        await this.api.removeFavoriteRecord(recordId);
        deletedIds.push(recordId);
      }
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      if (error?.outcomeUnknown) { error.favoriteOutcomeUnknown = true; throw error; }
      // A partial delete is rare, but if it occurs, try to restore the old list.
      if (deletedIds.length && oldTags.length) {
        try {
          await this.api.addFriendFavorite(userId, oldTags);
          await this.fetchFavoritesStrict().catch(() => null);
        } catch (rollbackError) {
          error.favoriteRollbackFailed = true;
          console.warn('Could not restore previous Favorite after delete failure:', rollbackError);
        }
      }
      throw error;
    }

    let createdRecord = null;
    try {
      createdRecord = await this.api.addFriendFavorite(userId, [groupName]);
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      if (error?.outcomeUnknown) { error.favoriteOutcomeUnknown = true; throw error; }
      // Only an actual write failure triggers rollback. A later refresh failure
      // must never undo an already-successful Favorite move.
      if (deletedIds.length && oldTags.length) {
        try {
          await this.api.addFriendFavorite(userId, oldTags);
          await this.fetchFavoritesStrict().catch(() => null);
        } catch (rollbackError) {
          error.favoriteRollbackFailed = true;
          console.warn('Could not restore previous Favorite after move failure:', rollbackError);
        }
      }
      throw error;
    }

    return this.syncFavoritesAfterMutation({
      userId,
      groupName,
      remove: false,
      createdRecord,
    });
  }

  async removeFriendFavorite(currentRecord) {
    this.requireCurrentUser();
    const recordIds = [...new Set(Array.isArray(currentRecord?.recordIds) ? currentRecord.recordIds : [])];
    if (!recordIds.length) throw new Error('Favorite record ID is unavailable. Refresh and try again.');
    const userId = currentRecord?.favoriteId || '';
    for (const recordId of recordIds) await this.api.removeFavoriteRecord(recordId);
    return this.syncFavoritesAfterMutation({ userId, remove: true });
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
      if (error?.name === 'AbortError') throw error;
      if (error?.status === 401) throw error;
      const cached = this.groupInstancesCache.getStale();
      if (cached?.userId === userId && Array.isArray(cached.items)) {
        this.usedStaleFallback = true;
        return cached.items;
      }
      return [];
    }
  }

  fetchGroup(groupId) {
    this.requireCurrentUser();
    return this.singleFlight('fetchGroup:' + groupId, () => this.fetchGroupUncached(groupId));
  }

  async fetchGroupUncached(groupId) {
    if (!groupId) return null;
    const cached = this.groupCache.getRecord(groupId, CONFIG.GROUP_CACHE_TTL_MS, CONFIG.GROUP_FAILURE_CACHE_TTL_MS);
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
      if (error?.name === 'AbortError') throw error;
      if ([403, 404].includes(error?.status)) {
        this.groupCache.setRecord(groupId, null, { status: error.status });
      }
      if (error?.status === 401) throw error;
      return null;
    }
  }

  fetchInstance(location) {
    this.requireCurrentUser();
    return this.singleFlight('fetchInstance:' + location, () => this.fetchInstanceUncached(location));
  }

  async fetchInstanceUncached(location) {
    const cached = this.instanceCache.get(location, CONFIG.INSTANCE_CACHE_TTL_MS);
    if (cached !== null) return cached;
    const data = await this.api.fetchInstance(location);
    this.instanceCache.set(location, data);
    return data;
  }

  fetchWorld(worldId) {
    this.requireCurrentUser();
    return this.singleFlight('fetchWorld:' + worldId, () => this.fetchWorldUncached(worldId));
  }

  async fetchWorldUncached(worldId) {
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
