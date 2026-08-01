// Clamp a post's STORED busyness hours to its stored opening hours, editing the
// raw frontmatter text in place (no YAML re-dump — a reserialize once broke
// translation files, so only the four hour lines are ever touched).
//
// Two YAML shapes exist in the wild and both are handled:
//   flow  (backfill-busyness.mjs):  `    weekdayQuiet: [9, 10, 11]`
//   block (generate.mjs assemble):  `    weekdayQuiet:\n      - 9\n      - 10`
// An unrecognized shape is left untouched — never corrupt data to clamp it.
//
// Used by repair-busyness-hours.mjs (site-wide repair) and by
// backfill-place-details.mjs (a post can gain openingHours DAYS after its
// busyness was stored, which is exactly when an unclamped window appears).
import yaml from 'js-yaml';
import { clampBusynessHours } from '../../src/lib/hours.mjs';

const KEYS = ['weekdayQuiet', 'weekdayBusy', 'weekendQuiet', 'weekendBusy'];

function replaceHourKey(raw, key, arr) {
  const nl = raw.includes('\r\n') ? '\r\n' : '\n';
  const flow = new RegExp(String.raw`^[ ]{4}${key}:[ \t]*\[[^\]\r\n]*\][ \t]*\r?\n`, 'm');
  const block = new RegExp(String.raw`^[ ]{4}${key}:[ \t]*\r?\n(?:[ ]{6}-[^\r\n]*\r?\n)+`, 'm');
  const rep = arr.length ? `    ${key}: [${arr.join(', ')}]${nl}` : '';
  if (flow.test(raw)) return raw.replace(flow, rep);
  if (block.test(raw)) return raw.replace(block, rep);
  return null; // shape not recognized
}

/**
 * Returns { raw, changed, notes } — `raw` is the (possibly edited) file text,
 * `notes` says which hours were dropped from which key. No-op (changed:false)
 * when there is nothing to clamp or the opening hours are absent/unparseable.
 */
export function clampBusynessInRaw(raw) {
  const cut = raw.indexOf('\n---', 3);
  if (cut < 0) return { raw, changed: false, notes: [] };
  let fm;
  try { fm = yaml.load(raw.slice(4, cut)); } catch { return { raw, changed: false, notes: [] }; }
  const bz = fm?.place?.busyness;
  const lines = fm?.place?.openingHours;
  if (!bz) return { raw, changed: false, notes: [] };
  const res = clampBusynessHours(bz, lines);
  if (!res || !res.changed) return { raw, changed: false, notes: [] };

  let out = raw;
  const notes = [];
  for (const key of KEYS) {
    const before = (bz[key] ?? []).filter((h) => Number.isInteger(h));
    const after = res[key];
    if (before.length === after.length) continue;
    const edited = replaceHourKey(out, key, after);
    if (edited == null) { notes.push(`${key}: UNRECOGNIZED shape — left as is`); continue; }
    out = edited;
    const dropped = before.filter((h) => !after.includes(h));
    notes.push(`${key}: dropped ${dropped.join(',')}h (venue not open then)${after.length ? '' : ' — nothing left'}`);
  }
  return { raw: out, changed: out !== raw, notes };
}
