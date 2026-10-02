// Cities a reader keeps for later ("가고 싶은 도시", 2026-10-02). One list for
// every surface that saves or shows them — the regions index, each city hub,
// /my-trip and the header count — so a heart pressed anywhere shows up
// everywhere. Slugs only: the name, photo and links are read in the reader's
// language from /trip-data/<lang>/saved-cities.json, never from storage.
//
// Kept apart from wa_trip_v1 on purpose: that list holds PLACES (hours, quiet
// times, coordinates) in the Save button's shape, and /my-trip's day planner,
// filters and share link all assume that shape.
export const CITY_KEY = 'wa_saved_regions_v1';
export const CHANGE_EVENT = 'wa-trip-change';

export function readCities(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CITY_KEY) || '[]');
    // The first version (regions index, 10-02 morning) stored {s, n, h}.
    return Array.isArray(v) ? [...new Set(v.map((x) => (typeof x === 'string' ? x : x?.s)).filter(Boolean))] : [];
  } catch { return []; }
}

export function writeCities(list: string[]): void {
  try { localStorage.setItem(CITY_KEY, JSON.stringify([...new Set(list)])); } catch { /* private mode: nothing to keep */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function toggleCity(slug: string): boolean {
  const list = readCities();
  const on = !list.includes(slug);
  writeCities(on ? [...list, slug] : list.filter((s) => s !== slug));
  return on;
}

/** Re-run `paint` whenever the list changes, here or in another tab. */
export function onCitiesChange(paint: () => void): void {
  window.addEventListener(CHANGE_EVENT, paint);
  // key === null is localStorage.clear() in another tab.
  window.addEventListener('storage', (e) => { if (e.key === null || e.key === CITY_KEY || e.key === 'wa_trip_v1') paint(); });
}
