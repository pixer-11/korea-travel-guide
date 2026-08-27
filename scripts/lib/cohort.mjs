// Did the pages that were earning impressions last week still earn them this week?
//
// Site totals hide this. A week can lose 60% of its impressions while the average
// position IMPROVES, because the pages ranking 60-95 drop out of the sample and the
// survivors' better positions are all that's left to average. That is exactly what
// 08-13~24 did — totals 1,599 → 728 while average position went 67 → 54 — and no
// existing report would have called it: gsc-report.mjs prints the week's totals and
// its near-miss list, neither of which changes shape when the tail dies.
//
// So measure the cohort instead: take the pages that earned real impressions in the
// earlier window, and ask how many of them earned anything in the later one. Pure
// functions here; the network and the Telegram text live in the script.

// Group a page URL into the buckets we actually reason about. The site's traffic
// splits along these lines (posts vs the programmatic when-to-go tool pages), and a
// decline confined to one bucket is a different diagnosis from a site-wide one.
export function kindOf(url) {
  const path = String(url).replace(/^https?:\/\/[^/]+/, '');
  for (const k of ['/posts/', '/tools/', '/regions/', '/destinations/', '/events/', '/itineraries/', '/continents/']) {
    if (path.includes(k)) return k.replace(/\//g, '');
  }
  return 'other';
}

export function langOf(url) {
  const m = String(url).match(/^https?:\/\/[^/]+\/([a-z]{2})\//);
  return m && ['ko', 'ja', 'es', 'zh'].includes(m[1]) ? m[1] : 'en';
}

const impressionsBy = (rows) => {
  const m = new Map();
  for (const r of rows ?? []) {
    const url = r.keys?.[0];
    if (!url) continue;
    m.set(url, (m.get(url) ?? 0) + (r.impressions ?? 0));
  }
  return m;
};

// The cohort is defined by the EARLIER window only — pages that had already proven
// they could earn impressions. Judging on the later window instead would select for
// survivors and always report health.
//
// minImpressions defends the measurement from noise: a page with a single
// impression has roughly a coin-flip chance of showing none the next week, so a
// cohort built from those measures randomness, not the site.
export function compareCohort(prevRows, nextRows, { minImpressions = 5 } = {}) {
  const prev = impressionsBy(prevRows);
  const next = impressionsBy(nextRows);

  const members = [...prev.entries()].filter(([, n]) => n >= minImpressions);
  const before = members.reduce((s, [, n]) => s + n, 0);
  const after = members.reduce((s, [u]) => s + (next.get(u) ?? 0), 0);
  const survived = members.filter(([u]) => (next.get(u) ?? 0) > 0).length;

  const bucket = (fn) => {
    const out = {};
    for (const [u, n] of members) {
      const k = fn(u);
      out[k] ??= { pages: 0, before: 0, after: 0 };
      out[k].pages += 1;
      out[k].before += n;
      out[k].after += next.get(u) ?? 0;
    }
    return out;
  };

  return {
    size: members.length,
    survived,
    survivalRate: members.length ? survived / members.length : null,
    before,
    after,
    // null rather than 0 when there is nothing to divide by — an empty cohort has no
    // delta, and reporting one as "0%" would read as "healthy".
    delta: before ? (after - before) / before : null,
    byKind: bucket(kindOf),
    byLang: bucket(langOf),
    // The biggest individual losses, for the report's "what actually fell" line.
    worst: members
      .map(([u, n]) => ({ url: u, before: n, after: next.get(u) ?? 0 }))
      .filter((r) => r.after < r.before)
      .sort((a, b) => (b.before - b.after) - (a.before - a.after))
      .slice(0, 5),
  };
}

// Turn the numbers into one of three states.
//
// The thresholds are honest about their pedigree: they come from ONE observed
// decline (-60% over 08-13~24) and no measured baseline of normal week-to-week
// variance, because the site has never tracked this before. They are deliberately
// loose so the first months of running this build that baseline instead of crying
// wolf — every run appends to data/impression-cohort.json, and once a few months of
// deltas exist the alarm line should be re-cut from the actual distribution rather
// than from this guess. Until then, treat "경보" as "go look", not as a verdict.
export const ALARM_DELTA = -0.35;
export const WATCH_DELTA = -0.20;
export const MIN_COHORT = 30;

export function verdict(c) {
  if (c.size < MIN_COHORT) {
    return { level: 'insufficient', reason: `코호트 ${c.size}개 — 판정하기엔 표본이 작다(최소 ${MIN_COHORT})` };
  }
  if (c.delta <= ALARM_DELTA) {
    return { level: 'alarm', reason: `노출이 ${(c.delta * 100).toFixed(0)}% 줄었다` };
  }
  if (c.delta <= WATCH_DELTA) {
    return { level: 'watch', reason: `노출이 ${(c.delta * 100).toFixed(0)}% 줄었다 — 다음 주도 같으면 경보` };
  }
  return { level: 'ok', reason: `노출 ${(c.delta * 100).toFixed(0)}%` };
}
