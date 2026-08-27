#!/usr/bin/env node
// Judge a fresh GSC coverage export against the baseline captured on 2026-08-27.
//
// Why this exists as a tool rather than a note. On 2026-08-27 the indexed count
// was found to have sat at ~5,232 for a month while the not-indexed pile grew
// 162/day — every page made since 07-25 landed unread. Publishing was throttled
// from ~330 to 25 URLs/day as an experiment, to be judged on 09-10. The failure
// mode that experiment invites is a hopeful reading of an ambiguous number two
// weeks later, so the thresholds were written down BEFORE the result existed
// (data/index-coverage-baseline.json) and this only applies them.
//
// GSC's API does not expose coverage — the owner exports it by hand from
// Indexing > Pages > Export. Pass the CSV, the unzipped folder, or the .zip.
//
//   node scripts/judge-index-coverage.mjs <path-to-csv|folder|zip>
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseCoverageCsv, slope, judge } from './lib/coverage.mjs';

const BASELINE = 'data/index-coverage-baseline.json';

// The export's filenames are localized, so find the chart CSV by its CONTENT.
// Matching on a name would break the moment the console language changes.
function findSeries(dir) {
  for (const f of readdirSync(dir)) {
    if (!f.toLowerCase().endsWith('.csv')) continue;
    const s = parseCoverageCsv(readFileSync(join(dir, f), 'utf8'));
    if (s.length) return s;
  }
  return null;
}

function load(target) {
  const st = statSync(target);
  if (st.isDirectory()) return findSeries(target);
  if (target.toLowerCase().endsWith('.zip')) {
    // Windows' bundled tar (bsdtar) reads zip; the GNU tar that ships with Git
    // Bash does not, and it is the one first on PATH there — so try the system
    // one by absolute path first, and say so plainly if neither works rather
    // than dying in a stack trace.
    const candidates = [
      process.env.SystemRoot ? join(process.env.SystemRoot, 'System32', 'tar.exe') : null,
      'tar',
    ].filter(Boolean);
    const dir = mkdtempSync(join(tmpdir(), 'cov-'));
    try {
      for (const tar of candidates) {
        try { execFileSync(tar, ['-xf', target, '-C', dir], { stdio: 'ignore' }); }
        catch { continue; }
        return findSeries(dir);
      }
      console.error('이 환경의 tar 가 zip 을 못 푼다. 압축을 직접 풀고 그 폴더를 주면 된다:');
      console.error(`  node scripts/judge-index-coverage.mjs "<압축 푼 폴더>"`);
      process.exit(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  const s = parseCoverageCsv(readFileSync(target, 'utf8'));
  return s.length ? s : null;
}

// Crawl requests come from a different GSC screen (Settings > Crawl stats) and
// cannot be exported with coverage, so they arrive as a flag. Without this the
// 'backfired' verdict — the only one that can say we made things worse — is
// unreachable, which is how it shipped this morning.
const crawlArg = process.argv.find((a) => a.startsWith('--crawl='));
const crawlRequests = crawlArg ? Number(crawlArg.slice(8)) : null;
if (crawlArg && !Number.isFinite(crawlRequests)) {
  console.error(`--crawl 값이 숫자가 아니다: ${crawlArg.slice(8)}`);
  process.exit(2);
}

const target = process.argv.find((a) => !a.startsWith('--') && a !== process.argv[0] && a !== process.argv[1]);
if (!target) {
  console.error('사용법: node scripts/judge-index-coverage.mjs <CSV | 폴더 | zip> [--crawl=<90일 크롤 요청 수>]');
  console.error('  커버리지: GSC → 색인 생성 → 페이지 → 내보내기');
  console.error('  크롤 수: GSC → 설정 → 크롤링 통계 → 총 크롤링 요청 횟수 (없으면 생략 가능)');
  process.exit(2);
}

const series = load(target);
if (!series?.length) {
  console.error(`색인 커버리지 CSV를 찾지 못했다: ${target}`);
  console.error('내보내기 안의 "차트" CSV가 필요하다(날짜·색인 생성됨·색인이 생성되지 않은 페이지).');
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const latest = { ...series[series.length - 1], ...(crawlRequests != null ? { crawlRequests } : {}) };
const v = judge(latest, baseline);

const icon = { win: '🎯', partial: '🟡', 'no-effect': '⛔', invalid: '⚠️', 'too-early': '⏳', backfired: '🔻' }[v.level] ?? '•';
const sign = (n) => `${n > 0 ? '+' : ''}${n}`;

console.log(`${icon} 색인 커버리지 판정 — 기준 ${baseline.latest.date} → 관측 ${latest.date}`);
console.log('');
console.log(`  색인됨      ${baseline.latest.indexed} → ${latest.indexed}  (${sign(v.deltaIndexed)})`);
console.log(`  미색인      ${baseline.latest.notIndexed} → ${latest.notIndexed}  (${sign(v.deltaNotIndexed)})`);

// Measure the slope over the SAME kind of window the baseline used: from the
// baseline's last reading onward. Measuring from the file's first row would drag
// in the launch crawl and report growth for a site that has been flat.
const since = baseline.latest.date;
const sIdx = slope(series, 'indexed', since);
const sNot = slope(series, 'notIndexed', since);
console.log('');
if (sIdx == null) {
  console.log(`  기울기: ${since} 이후 갱신이 아직 2회 미만이라 계산할 수 없다.`);
} else {
  console.log(`  ${since} 이후 기울기: 색인 ${sIdx.toFixed(2)}/일 · 미색인 ${sNot.toFixed(1)}/일`);
}
console.log(`  스로틀 이전 기울기: 색인 ${baseline.slopePerDay.indexed}/일 · 미색인 ${baseline.slopePerDay.notIndexed}/일  (${baseline.slopePerDay.window})`);

console.log('');
if (crawlRequests == null && v.level !== 'too-early') {
  console.log(`  ⚠️ 크롤 요청 수를 안 줬다 — "더 나빠졌는가" 축은 판정하지 못했다.`);
  console.log(`     GSC → 설정 → 크롤링 통계에서 총 요청 수를 읽어 --crawl=<숫자> 로 다시 돌릴 것.`);
  console.log(`     08-27 기준값: ${baseline.crawlStats?.totalRequests90d ?? '?'}`);
  console.log('');
}
console.log(`  판정: ${v.key}`);
console.log(`  ${v.meaning}`);
console.log('');
console.log(`  * 기준은 결과를 보기 전(${baseline.capturedOn})에 ${BASELINE} 에 적어둔 것이다.`);

// --record stamps the verdict into the baseline, which is what stops the 09-10
// reminder. Without it the reminder keeps firing every morning of its window even
// after the judgement was made, because nothing else writes `judgedOn`.
if (process.argv.includes('--record')) {
  if (v.level === 'too-early') {
    console.log('');
    console.log('  --record 무시: 아직 판정일 전이라 기록할 것이 없다.');
  } else {
    baseline.verdict.judgedOn = latest.date;
    baseline.verdict.judgedAs = { level: v.level, key: v.key, indexed: latest.indexed, notIndexed: latest.notIndexed, crawlRequests: crawlRequests ?? null };
    writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log('');
    console.log(`  ✅ 판정을 ${BASELINE} 에 기록했다 (judgedOn: ${latest.date}) — 리마인더가 멈춘다.`);
    console.log('     커밋해야 자동화에도 반영된다.');
  }
}

// A judgement is information, not a failure — always exit 0 except on a bad read.
