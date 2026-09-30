export const CONFIG = Object.freeze({
  // Local UI/debug mode. Set DEBUG_MODE to true to render synthetic data only.
  // No VRChat API requests are made while this mode is enabled.
  DEBUG_MODE: false,
  DEBUG_FRIEND_COUNT: 20,
  DEBUG_FAVORITE_COUNT: 2,
  API_BASE: 'https://vrchat.com/api/1',
  LOGIN_URL: 'https://vrchat.com/login',
  WORLD_PAGE_BASE: 'https://vrchat.com/home/world',
  LAUNCH_PAGE: 'https://vrchat.com/home/launch',
  MAX_FRIENDS: 1000,
  MAX_FAVORITES: 1000,
  MAX_GROUP_LOOKUPS: 100,
  GROUP_LOOKUP_CONCURRENCY: 2,
  HYDRATE_CONCURRENCY: 2,
  INITIAL_HYDRATE_COUNT: 4,
  HYDRATE_PRELOAD_PX: 420,
  FOCUS_HYDRATION_DELAY_MS: 1050,
  API_MIN_INTERVAL_MS: 250,
  API_MAX_RETRIES: 3,
  WORLD_CACHE_TTL_MS: 7 * 24 * 60 * 60 * 1000,
  INSTANCE_CACHE_TTL_MS: 30 * 1000,
  USER_DETAIL_CACHE_TTL_MS: 24 * 60 * 60 * 1000,
  FRIEND_CACHE_TTL_MS: 15 * 1000,
  FAVORITE_CACHE_TTL_MS: 60 * 1000,
  GROUP_INSTANCES_CACHE_TTL_MS: 30 * 1000,
  GROUP_CACHE_TTL_MS: 24 * 60 * 60 * 1000,
  GROUP_FAILURE_CACHE_TTL_MS: 10 * 60 * 1000,
  UI_PREFERENCES_KEY: 'vrc_friends_and_group_instance_viewer_ui_preferences_v2',
  WORLD_CACHE_KEY: 'vrc_friends_and_group_instance_viewer_world_cache_v1',
  INSTANCE_CACHE_KEY: 'vrc_friends_and_group_instance_viewer_instance_cache_v1',
  USER_DETAIL_CACHE_KEY: 'vrc_friends_and_group_instance_viewer_user_detail_cache_v2',
  FRIEND_CACHE_KEY: 'vrc_friends_and_group_instance_viewer_friend_cache_v2',
  FAVORITE_CACHE_KEY: 'vrc_friends_and_group_instance_viewer_favorite_cache_v3',
  GROUP_INSTANCES_CACHE_KEY: 'vrc_friends_and_group_instance_viewer_group_instances_cache_v2',
  GROUP_CACHE_KEY: 'vrc_friends_and_group_instance_viewer_group_cache_v1',
});

export const PERMISSIONS = Object.freeze({
  PUBLIC: 'public',
  FRIENDS: 'friends',
  FRIEND_PLUS: 'friend+',
  INVITE: 'invite',
  INVITE_PLUS: 'invite+',
  GROUP: 'group',
  GROUP_PLUS: 'group_plus',
  GROUP_PUBLIC: 'group_public',
  PRIVATE: 'private',
  OFFLINE: 'offline',
  UNKNOWN: 'unknown',
});

export const TABS = Object.freeze({
  FAVORITE_PLUS: 'favorite_plus',
  FAVORITE_ONLY: 'favorite_only',
  ALL: 'all',
  GROUPS: 'groups',
});

export const SORTS = Object.freeze({
  FRIENDS_DESC: 'friends_desc',
  USERS_DESC: 'users_desc',
});
