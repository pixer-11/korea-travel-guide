#!/usr/bin/env node
// PROGRAMMATIC-PAGE INDEX COVERAGE → Telegram (Korean).
//
// Growth research B5 (2026-08-13): the failure mode of programmatic SEO in
// travel is quiet — Google silently declines to index thin pages, nothing
// alarms, and the site's "coverage" is fiction. The published guardrail from
// travel-pSEO practice: below ~80% indexation a page type is a quality alert.
//
// Bulk indexation isn't queryable, so this SAMPLES: n URLs per page type from
// the live sitemap through the URL Inspection API (quota 2,000/day — four
// buckets x 60 = 240, far under). A weekly seed rotates the sample so repeated
// runs walk different URLs. Impressions would undercount (indexed-but-unshown
// pages exist), inspection is the honest signal.
//
// Auth: same service-account JWT flow as gsc-report.mjs, but the inspection
// endpoint needs the FULL webmasters scope — if the account's Search Console
// role is too low the API answers 403, and this script says so in Korean
// instead of pretending coverage is fine (no silent caps).
//
//   GSC_SERVICE_ACCOUNT_JSON · GSC_SITE_URL · TELEGRAM_BOT_TOKEN · TELEGRAM_CHAT_ID
//   node scripts/audit-index-coverage.mjs [--per 60] [--quiet-ok]
import { createSign, createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { sendTelegram } from './lib/telegram.mjs';

const { GSC_SERVICE_ACCOUNT_JSON, GSC_SITE_URL } = process.env;
const SITE = 'https://wanderatlasguides.com';
const PER = Number(process.argv.includes('--per') ? process.argv[process.argv.indexOf('--per') + 1] : 60);
const THRESHOLD = 0.8;

// Page types under watch. `programmatic` buckets alarm below the threshold;
// `posts` rides along as a control — if the control ALSO cratered, the story
// is site-wide (a penalty, a sitemap break), not thin programmatic pages.
const BUCKETS = [
  { key: 'when-to-go', match: (u) => u.includes('/tools/when-to-go/'), programmatic: true },
  { key: 'itinerary', match: (u) => /\/itinerary\/[a-z0-9-]+/.test(u), programmatic: true },
  { key: 'esim', match: (u) => u.includes('/tools/esim/'), programmatic: true },
  { key: 'posts', match: (u) => /\/posts\/[a-z0-9-]+/.test(u), programmatic: false },
];

const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function getAccessToken(sa, scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const jwt = `${header}.${claim}.${b64url(signer.sign(sa.private_key))}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const j = await res.json();
  if (!j.access_token) throw new Error(`token: ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token;
}

// Link previews stay on (no opts): this report is plain text with nothing to
// expand, and that is what it always did. A refusal throws — the weekly
// coverage number is the whole errand.
async function tg(text) {
  if (!(await sendTelegram(text))) console.log('[TG 미설정]\n' + text);
}

// Deterministic weekly shuffle: same Monday → same sample (a re-run debugs the
// same URLs), next week → a different walk of the list.
const weekSeed = () => { const d = new Date(); const onejan = new Date(d.getFullYear(), 0, 1); return `${d.getFullYear()}w${Math.ceil((((d - onejan) / 864e5) + onejan.getDay() + 1) / 7)}`; };
const seededSort = (arr, seed) => arr
  .map((u) => [createHash('sha1').update(seed + u).digest('hex'), u])
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([, u]) => u);

const sm = await fetch(`${SITE}/sitemap-0.xml`).then((r) => r.text());
const urls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  // English pages only: one language is a clean sample; hreflang variants
  // index (or don't) together and would triple the quota for no extra signal.
  .filter((u) => !/\/(ko|ja|es|zh)\//.test(u));

const sa = JSON.parse(GSC_SERVICE_ACCOUNT_JSON);
const token = await getAccessToken(sa, 'https://www.googleapis.com/auth/webmasters');

const results = [];
let inspected = 0;
for (const b of BUCKETS) {
  const pool = urls.filter(b.match);
  const sample = seededSort(pool, weekSeed()).slice(0, Math.min(PER, pool.length));
  // WHY a page is out matters more than the rate: "Discovered - currently
  // not indexed" means Google has not spent a single fetch on it (crawl
  // budget/authority — backlinks and time), "Crawled - currently not
  // indexed" means Google read it and declined (content — the only case
  // where "beef up thin pages" is the right prescription), "unknown" means
  // it is simply new. The 2026-08-25 alert lumped all three under "thin
  // pages need work" while every sampled esim page was in fact un-fetched.
  let indexed = 0, failed = 0, denied = false;
  const causes = { notCrawled: 0, crawledOut: 0, unknown: 0, other: 0 };
  for (const u of sample) {
    const res = await fetch(`https://searchconsole.googleapis.com/v1/urlInspection/index:inspect`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ inspectionUrl: u, siteUrl: GSC_SITE_URL }),
    });
    inspected++;
    if (res.status === 403) { denied = true; break; }
    if (!res.ok) { failed++; continue; }
    const j = await res.json();
    const verdict = j.inspectionResult?.indexStatusResult?.coverageState || '';
    if (/indexed/i.test(verdict) && !/not indexed/i.test(verdict)) indexed++;
    else if (/discovered/i.test(verdict)) causes.notCrawled++;
    else if (/crawled/i.test(verdict)) causes.crawledOut++;
    else if (/unknown/i.test(verdict)) causes.unknown++;
    else causes.other++;
    await new Promise((r) => setTimeout(r, 350)); // stay far under 600/min
  }
  results.push({ ...b, pool: pool.length, sampled: sample.length, indexed, failed, denied, causes });
  if (denied) break;
}

const denied = results.some((r) => r.denied);
if (denied) {
  await tg('🔍 색인율 감사를 돌릴 수 없습니다 — 서비스 계정의 서치콘솔 권한이 URL 검사에 못 미칩니다(403). 서치콘솔 → 설정 → 사용자에서 서비스 계정을 "전체" 권한으로 올려주세요. 올리기 전까지 색인율은 측정되지 않는 상태입니다.');
  console.log('DENIED — 권한 부족');
  process.exit(0); // 설정 문제는 실패 스팸이 아니라 안내 1회로
}

const lines = results.map((r) => {
  const rate = r.sampled ? r.indexed / r.sampled : 0;
  const pct = (rate * 100).toFixed(0);
  const flag = r.programmatic && rate < THRESHOLD ? '🚨' : '✅';
  const c = r.causes || {};
  const why = [
    c.notCrawled ? `안읽음 ${c.notCrawled}` : '',
    c.crawledOut ? `읽고거름 ${c.crawledOut}` : '',
    c.unknown ? `신규 ${c.unknown}` : '',
    c.other ? `기타 ${c.other}` : '',
  ].filter(Boolean).join(' · ');
  return `${flag} ${r.key}: 표본 ${r.sampled}/${r.pool} 중 색인 ${r.indexed} (${pct}%)${why ? ` — ${why}` : ''}${r.failed ? ` · 조회실패 ${r.failed}` : ''}`;
});
const alarms = results.filter((r) => r.programmatic && r.sampled && r.indexed / r.sampled < THRESHOLD);

mkdirSync('data/logs', { recursive: true });
writeFileSync('data/logs/index-coverage.json', JSON.stringify({ at: new Date().toISOString(), results }, null, 2) + '\n');

// The prescription must match the measured cause, not a stock phrase.
const tot = (k) => alarms.reduce((n, a) => n + (a.causes?.[k] || 0), 0);
const crawledOut = tot('crawledOut');
const notCrawled = tot('notCrawled') + tot('unknown');
const advice = crawledOut > notCrawled
  ? '구글이 읽고도 거른 페이지가 다수 — 내용 보강/정리가 맞는 처방입니다.'
  : '대부분 구글이 아직 읽지 않은 페이지(크롤 예산·신규) — 페이지 보강으로는 해결되지 않고, 백링크·시간이 처방입니다. 읽고도 거른 건은 "읽고거름" 수치로 표시됩니다.';
const head = alarms.length
  ? `🚨 프로그래매틱 페이지 색인율 경보 (${alarms.map((a) => a.key).join(', ')} — 80% 미만)\n${advice}`
  : `🔍 주간 색인율 점검 — 전 유형 정상 (80% 이상)`;
if (alarms.length || !process.argv.includes('--quiet-ok')) await tg(`${head}\n\n${lines.join('\n')}\n(표본 검사 ${inspected}건 · URL Inspection API)`);
console.log(`INDEX_COVERAGE ${results.map((r) => `${r.key}=${r.sampled ? Math.round((r.indexed / r.sampled) * 100) : 0}%`).join(' ')}`);
