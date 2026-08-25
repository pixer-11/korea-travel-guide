// An hour cannot be quiet AND busy. When the source says both, busy wins.
//
// The stored data contradicts itself on 37 of 608 measured places (6.1%), all of
// them at the weekend: weekendQuiet and weekendBusy are derived independently
// from the venue's foot-traffic curve and can overlap at the shoulders. Lyon's
// Café Joyeux says quiet 9am-4pm and busy 11am-6pm; the hours 11-16 appear in
// both lists. Weekdays are clean (0 conflicts), so this is specific to how the
// weekend curve is folded.
//
// WHY BUSY WINS. The two errors are not symmetric. Telling a traveller a place
// is quiet when it is packed sends them at the worst possible hour — the exact
// failure this data exists to prevent. Telling them it is busy when it is calm
// only costs them an option they never knew they had. So the conservative read
// is the correct one.
//
// This lives in one place because three consumers need the same answer and were
// giving different ones: the crowd API (public, third parties integrate against
// it), the per-post page (printed "quiet 9am-5pm / busy 11am-7pm" side by side,
// which reads as broken), and the best-time heatmap — which already resolved it
// correctly, cell by cell, via `busy.has(h) ? 'busy' : quiet.has(h) ? …`. That
// implicit precedence is now explicit and shared.

/** @param {number[] | undefined} quiet @param {number[] | undefined} busy */
const without = (quiet, busy) => {
  if (!quiet?.length) return [];
  if (!busy?.length) return [...quiet];
  const drop = new Set(busy);
  return quiet.filter((h) => !drop.has(h));
};

/**
 * Resolve a stored busyness block into non-overlapping hour lists.
 *
 * Returns the same four fields, always as arrays. An hour claimed by both lists
 * is kept only in the busy one. Sorted, so callers can format ranges directly.
 *
 * @param {{weekdayQuiet?: number[], weekdayBusy?: number[], weekendQuiet?: number[], weekendBusy?: number[]} | null | undefined} b
 */
export function resolveBusyness(b) {
  const asc = (/** @type {number[]} */ xs) => [...xs].sort((x, y) => x - y);
  return {
    weekdayQuiet: asc(without(b?.weekdayQuiet, b?.weekdayBusy)),
    weekdayBusy: asc(b?.weekdayBusy ?? []),
    weekendQuiet: asc(without(b?.weekendQuiet, b?.weekendBusy)),
    weekendBusy: asc(b?.weekendBusy ?? []),
  };
}

/**
 * True when the stored block contradicts itself — an hour listed as both quiet
 * and busy. Used by the audit so the count can be tracked rather than silently
 * cleaned forever.
 *
 * @param {{weekdayQuiet?: number[], weekdayBusy?: number[], weekendQuiet?: number[], weekendBusy?: number[]} | null | undefined} b
 */
export function hasBusynessConflict(b) {
  const clash = (/** @type {number[] | undefined} */ q, /** @type {number[] | undefined} */ x) =>
    !!q?.length && !!x?.length && q.some((h) => x.includes(h));
  return clash(b?.weekdayQuiet, b?.weekdayBusy) || clash(b?.weekendQuiet, b?.weekendBusy);
}
