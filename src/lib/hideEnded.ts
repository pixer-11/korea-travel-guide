// Hide event links that have ended by the READER's calendar date.
//
// Pages are rebuilt several times a day, but on the UTC date: from midnight in
// Asia until the first build after 09:00 KST, an event that closed yesterday
// still stood in "on now" lists (owner, 2026-10-01 01:00 KST — three "Ended"
// cards under "Ending soon"). Mark an element with data-ev-end="YYYY-MM-DD"
// and import this from the component's <script>; the next build drops the
// event from the HTML for good.
const DAY = 86_400_000;

export function hideEnded(root: ParentNode = document) {
  const n = new Date();
  const today = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / DAY;
  for (const el of root.querySelectorAll<HTMLElement>('[data-ev-end]')) {
    const end = Date.parse(el.dataset.evEnd || '') / DAY;
    if (Number.isFinite(end) && end < today) el.hidden = true;
  }
}
