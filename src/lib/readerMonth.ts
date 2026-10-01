// "This month" by the READER's calendar, not the build's.
//
// Pages are rebuilt several times a day but on the UTC date, so on the first
// of a month in Asia — until the first build after 09:00 KST — every "this
// month" said last month (owner, 10-01: the home's "Now · September" on
// October 1). A component renders one variant per month it can answer for
// (the build's month and the next), each marked
//
//   <el data-mv-group="some-block" data-mv="2026-10">…</el>
//
// with every variant but the build's `hidden`, and imports showReaderMonth()
// in its <script>. A variant with nothing to show carries data-mv-empty, so
// the reader's month still hides the build's stale one.

/** "YYYY-MM" of a date's UTC calendar — the build side. */
export const monthKeyUTC = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/** The first day of the month after `d` (UTC). */
export const nextMonthUTC = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));

/** Show, in every group, the variant for the reader's month — when the group has one. */
export function showReaderMonth(root: ParentNode = document) {
  const n = new Date();
  const key = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  const groups = new Map<string, HTMLElement[]>();
  for (const el of root.querySelectorAll<HTMLElement>('[data-mv-group]')) {
    const g = el.dataset.mvGroup || '';
    groups.set(g, [...(groups.get(g) ?? []), el]);
  }
  for (const els of groups.values()) {
    if (!els.some((e) => e.dataset.mv === key)) continue;
    for (const e of els) e.hidden = e.dataset.mv !== key || e.hasAttribute('data-mv-empty');
  }
}
