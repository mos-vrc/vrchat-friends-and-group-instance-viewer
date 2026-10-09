// Recent worlds may omit inaccessible rows from a 50-entry page and may
// repeat the final page. Keep this read-only policy separate from Favorites,
// where mutations require a complete, validated snapshot.
// Keep the observed 50-slot window: inaccessible worlds can be omitted,
// so returned length cannot identify either server cap or consumed slots.
const PAGE_SIZE = 50;
const MAX_WORLDS = 1000;
const validWorld = row => row && /^wrld_[A-Za-z0-9_-]+$/.test(row.id || '') && typeof row.name === 'string';

export async function fetchRecentWorlds(api) {
  const result = [], seen = new Set();
  for (let offset = 0; offset <= MAX_WORLDS; offset += PAGE_SIZE) {
    const rows = await api.fetchJson(`/worlds/recent?n=${PAGE_SIZE}&offset=${offset}&order=descending`);
    if (!Array.isArray(rows) || rows.some(row => !validWorld(row))) throw new Error('Invalid recent worlds response');
    if (!rows.length) return result;
    let added = 0;
    for (const row of rows) {
      if (!seen.has(row.id)) { seen.add(row.id); result.push(row); added += 1; }
    }
    if (!added) return result;
    if (result.length > MAX_WORLDS) throw new Error('Recent worlds safety limit exceeded');
    // A short response can contain filtered rows, so advance by the requested
    // page size and continue until empty or no new IDs. Preserve API order.
  }
  throw new Error('Recent worlds page limit exceeded');
}
