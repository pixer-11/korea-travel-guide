// Read a Google Search Console coverage export and judge it against a baseline.
//
// GSC's API does not expose index coverage at all — the only way to this number
// is the Export button on Indexing > Pages. So the judging cannot be automated
// end to end; what CAN be removed is the interpretation, which is where a month
// of wishful reading would otherwise happen. The baseline (with its thresholds)
// is written down BEFORE the result is known; this file only applies it.
//
// Pure functions: parsing and verdict. The file/zip handling lives in the script.

// The export's chart CSV has a Korean header and a UTF-8 BOM, and its rows are a
// step function — GSC refreshes coverage every few days, so a value repeats until
// the next refresh. Rows before the first refresh have empty coverage columns.
export function parseCoverageCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const head = splitCsvLine(lines[0]);
  const iDate = 0;
  const iNot = head.findIndex((h) => /색인이 생성되지 않은|not indexed/i.test(h));
  const iIdx = head.findIndex((h) => /색인 생성됨|^indexed/i.test(h));
  if (iNot < 0 || iIdx < 0) return [];

  const out = [];
  for (const line of lines.slice(1)) {
    const c = splitCsvLine(line);
    const date = c[iDate];
    const notIndexed = Number(c[iNot]);
    const indexed = Number(c[iIdx]);
    if (!date || !c[iNot] || !c[iIdx] || !Number.isFinite(notIndexed) || !Number.isFinite(indexed)) continue;
    out.push({ date, indexed, notIndexed });
  }
  return out;
}

// Minimal CSV splitter — the export quotes only fields containing commas.
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (ch === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// Collapse the step function to the points where a value actually changed, so a
// slope is measured over real refreshes rather than over repeated readings.
export function refreshPoints(series) {
  const out = [];
  for (const p of series) {
    const last = out[out.length - 1];
    if (!last || last.indexed !== p.indexed || last.notIndexed !== p.notIndexed) out.push(p);
  }
  return out;
}

const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

// `since` matters more than it looks. A full export starts with the launch crawl
// (2,450 -> 5,232 indexed in one day), and including it reports "+111 indexed/day"
// for a site whose indexed count has not moved in a month. The baseline's slope is
// measured from 07-25 for exactly that reason, so a comparison against it must use
// the same kind of window or the two numbers are not about the same thing.
// Returns null when the window holds fewer than two refreshes — no slope exists,
// and inventing one from a single point is how a flat month reads as progress.
export function slope(series, key, since = null) {
  const pts = refreshPoints(series).filter((p) => !since || p.date >= since);
  if (pts.length < 2) return null;
  const a = pts[0], b = pts[pts.length - 1];
  const d = days(a.date, b.date);
  return d > 0 ? (b[key] - a[key]) / d : null;
}

// The verdict. Thresholds come from the baseline file, never from here — this
// function must not be able to move the goalposts it is checking.
export function judge(latest, baseline) {
  const base = baseline.latest;
  const t = baseline.verdict.thresholds;
  const dIdx = latest.indexed - base.indexed;
  const dNot = latest.notIndexed - base.notIndexed;

  // Before the agreed date there is no verdict to give. Without this guard an
  // export taken the same week reads as "no-effect" — the throttle's failure
  // state — purely because nothing has had time to happen, which is exactly the
  // misreading the written-down thresholds exist to prevent.
  if (latest.date < baseline.verdict.judgeOn) {
    return {
      level: 'too-early',
      key: 'tooEarly',
      meaning: `판정일은 ${baseline.verdict.judgeOn} 이다. 그 전 수치는 아직 결론이 아니다 (GSC 커버리지는 며칠에 한 번만 갱신된다).`,
      deltaIndexed: dIdx, deltaNotIndexed: dNot, baseline: base, latest,
    };
  }

  // Order matters: a throttle that never took effect makes every other reading
  // meaningless, so it is checked first.
  let level, key, meaning;
  if (latest.notIndexed > 10000) {
    level = 'invalid'; key = 'throttleNotApplied'; meaning = t.throttleNotApplied;
  } else if (latest.indexed > 5300) {
    level = 'win'; key = 'win'; meaning = t.win;
  } else if (latest.notIndexed < base.notIndexed) {
    level = 'partial'; key = 'drainingButNotIndexing'; meaning = t.drainingButNotIndexing;
  } else {
    level = 'no-effect'; key = 'intakeWasNotTheConstraint'; meaning = t.intakeWasNotTheConstraint;
  }
  return { level, key, meaning, deltaIndexed: dIdx, deltaNotIndexed: dNot, baseline: base, latest };
}
