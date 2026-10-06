export function normalizeSearch(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/\s+/gu, ' ').trim();
}
const searchCache = new WeakMap();
export function friendSearchText(friend) {
  const signature = [friend.displayName, friend.username, friend.id].join(' ');
  const cached = searchCache.get(friend);
  if (cached?.signature === signature) return cached.text;
  const text = normalizeSearch(signature);
  searchCache.set(friend, { signature, text });
  return text;
}
export function matchesSearch(text, query) {
  return normalizeSearch(query).split(' ').filter(Boolean).every(token => text.includes(token));
}
export function activityComparison(a, b, direction = 'recent') {
  const first = Date.parse(a.last_activity), second = Date.parse(b.last_activity);
  if (!Number.isFinite(first)) return Number.isFinite(second) ? 1 : 0;
  if (!Number.isFinite(second)) return -1;
  return direction === 'oldest' ? first - second : second - first;
}
