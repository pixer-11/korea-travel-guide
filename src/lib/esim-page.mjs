// The eSIM country page's computed parts (redesign 2026-10-05, from the owner's
// "UAE eSIM 개선안" mock-up). Pure functions, shared by the page's build and its
// in-browser script, and tested in esim-page.test.mjs.

/**
 * Which option suits a trip — the mock's rule of thumb, stated on the page as a
 * rule of thumb: several people sharing one connection → pocket WiFi; a short
 * trip where convenience beats cost → carrier roaming; otherwise a travel eSIM.
 * @param {{ people: 'solo' | 'small' | 'group', days: number, prio: 'cost' | 'share' | 'ease' }} q
 * @returns {'esim' | 'wifi' | 'roam'}
 */
export function recommend({ people, days, prio }) {
  if (people === 'group' || (people === 'small' && prio === 'share')) return 'wifi';
  if (Number(days) <= 3 && prio === 'ease') return 'roam';
  return 'esim';
}

/**
 * How each option fares on the comparison's five rows, as the mock draws them:
 * g = in its favour, w = watch out, b = against it. Fixed facts about the three
 * kinds of connection, the same in every country.
 */
export const CMP_MARKS = {
  esim: { Setup: 'g', Share: 'w', Battery: 'g', Cost: 'g', Risk: 'w' },
  wifi: { Setup: 'w', Share: 'g', Battery: 'w', Cost: 'w', Risk: 'b' },
  roam: { Setup: 'g', Share: 'g', Battery: 'g', Cost: 'b', Risk: 'b' },
};

// The one tip per country the page lifts into its "know this first" card. Most
// countries lead their tip list with it already (index 0, the default); these
// lead with something gentler and keep the real catch further down. A country
// added later simply uses its first tip until someone points it elsewhere.
const ALERT_TIP = {
  thailand: 2,          // boats between islands are dead zones
  vietnam: 1,           // mountain passes: prefer Viettel, still dead zones
  'united-states': 2,   // rural routes: which network the eSIM uses
  china: 2,             // ask the provider which apps work on its China plan
  spain: 2,             // Morocco is not in the EU zone
  taiwan: 2,            // Taroko and the alpine roads lose signal
  malaysia: 1,          // Borneo is not KL
  india: 3,             // data-only eSIMs cannot receive Indian SMS codes
  germany: 1,           // local SIMs need an ID check by law
};

/** Index of the tip the alert card shows, always inside the list (or -1 for none). */
export function alertTipIndex(slug, tips) {
  const n = Array.isArray(tips) ? tips.length : 0;
  if (!n) return -1;
  const i = ALERT_TIP[slug] ?? 0;
  return i >= 0 && i < n ? i : 0;
}

/**
 * Good months as runs, wrapping over the new year: [11,12,1,2,3] → [[11,3]],
 * [4,5,10] → [[4,5],[10,10]]. Months are 1–12.
 * @param {number[]} months
 * @returns {[number, number][]}
 */
export function monthRuns(months) {
  const set = new Set((months ?? []).filter((m) => m >= 1 && m <= 12));
  if (!set.size) return [];
  if (set.size === 12) return [[1, 12]];
  // Start each run at a month whose predecessor is not in the set.
  const prev = (m) => (m === 1 ? 12 : m - 1);
  const next = (m) => (m === 12 ? 1 : m + 1);
  const runs = [];
  for (let m = 1; m <= 12; m++) {
    if (!set.has(m) || set.has(prev(m))) continue;
    let e = m;
    while (set.has(next(e))) e = next(e);
    runs.push([m, e]);
  }
  return runs;
}
