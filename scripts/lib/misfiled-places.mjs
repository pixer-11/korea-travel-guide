// Venues whose own guide said they are not in the region they were searched
// under — so the generator never pays to write them there again.
//
// Why a ledger and not just the place id. Until 2026-11-06 such a guide was
// written, translated four times, held by the region gate, and left on disk
// as a draft; the patrol then re-checked it every day ("wrong-region 결함이
// 여전함") and could never fix it, because only a different region fixes it.
// The draft's place id also kept the venue from ever being written where it
// belongs (Mtirala National Park, 19 km from Batumi's guides, held under
// Akhaltsikhe 91 km away). Now the guide is not written, and the venue is
// barred from THAT region only: a later search under the right region still
// finds it.
import { readFileSync, writeFileSync } from 'node:fs';

export const MISFILED_FILE = new URL('../../data/misfiled-places.json', import.meta.url);

const COMMENT = 'Venues barred from a region because their own guide said they are not there. Written by scripts/generate.mjs; see scripts/lib/misfiled-places.mjs.';

/** @returns {{_comment:string, places:Record<string,{name:string,country:string,regions:string[],why:string,date:string}>}} */
export function readMisfiled(file = MISFILED_FILE) {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    return { _comment: COMMENT, places: j?.places && typeof j.places === 'object' ? j.places : {} };
  } catch { return { _comment: COMMENT, places: {} }; }
}

/** place id → Set of regions it must not be filed under. */
export function barredRegions(store) {
  const out = new Map();
  for (const [id, e] of Object.entries(store?.places ?? {})) out.set(id, new Set(e?.regions ?? []));
  return out;
}

/** Adds one verdict (pure). The same venue under a second wrong region keeps both. */
export function addMisfiled(store, { placeId, name = '', country = '', region, why = '', date }) {
  if (!placeId || !region) return store;
  const places = { ...(store?.places ?? {}) };
  const prev = places[placeId];
  const regions = [...new Set([...(prev?.regions ?? []), region])];
  places[placeId] = { name: name || prev?.name || '', country: country || prev?.country || '', regions, why: why || prev?.why || '', date: date || prev?.date || '' };
  return { _comment: COMMENT, places: Object.fromEntries(Object.entries(places).sort(([a], [b]) => a.localeCompare(b))) };
}

export function writeMisfiled(store, file = MISFILED_FILE) {
  writeFileSync(file, JSON.stringify(store, null, 2) + '\n', 'utf8');
}
