#!/usr/bin/env node
// 핵심 집합 색인 자 → Telegram (한국어). 매주 목요일 06:41 KST (index-core-set.yml).
//
// 10-28 전수 조사의 "잣대 교체": 사이트 전체 색인 수 대신, 결과를 보기 전에 고정한
// 집합(data/index-core-set.json — 영문, 노출이 있던 페이지 + 참조형 허브 + 직접 경험
// 글)의 색인%·28일 노출%·정체(90일+ 미재크롤)·코호트 재크롤률을 같은 자로 잰다.
// 계산은 lib/core-set.mjs(순수), 여기는 네트워크·장부·알림뿐.
//
// 집합 구성원 = 파일의 urls(고정) ∪ 직접 경험 글(자동: 본문에 /editor-photos/ 가 있는
// 공개 글). 직접 경험 글은 올라갈 때마다 저절로 'firsthand' 그룹에 들어온다 — 손으로
// 집합 파일을 고칠 일이 없다(바뀌는 페이지는 처음부터 자동 반영).
//
// 장부 data/logs/index-core-set.jsonl: 실행마다 한 줄(요약 + URL 별 상태·마지막 크롤·
// 노출). 첫 줄이 기준선(코호트 시작), 마지막 줄이 지난 주. 둘 다 여기서 읽는다.
//
// 못 본 것은 통과가 아니다: 검사 실패가 20% 를 넘으면 알림에 '측정 불완전'을 박고,
// 403 이면 권한 안내 1회, 429 면 그 자리에서 멈추고 부분 결과로 보고한다.
//
//   GSC_SERVICE_ACCOUNT_JSON (또는 로컬 GSC_KEY_FILE) · GSC_SITE_URL · TELEGRAM_*
//   node scripts/audit-index-core-set.mjs            # 측정 + 장부 + 알림
//   node scripts/audit-index-core-set.mjs --dry      # 측정만, 장부·알림 없음
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { getAccessToken, query, day } from './lib/gsc.mjs';
import { sendTelegram } from './lib/telegram.mjs';
import { summarize, judgeCohort, formatReport } from './lib/core-set.mjs';

// CORE_SET_FILE / CORE_SET_LEDGER 는 배관 시험용 — 실운영은 기본 경로뿐.
const SET_PATH = process.env.CORE_SET_FILE || 'data/index-core-set.json';
const LEDGER = process.env.CORE_SET_LEDGER || 'data/logs/index-core-set.jsonl';
const POSTS_DIR = 'src/content/posts';
const SITE = 'https://wanderatlasguides.com';
const dry = process.argv.includes('--dry');

function serviceAccount() {
  if (process.env.GSC_SERVICE_ACCOUNT_JSON) return JSON.parse(process.env.GSC_SERVICE_ACCOUNT_JSON);
  if (process.env.GSC_KEY_FILE && existsSync(process.env.GSC_KEY_FILE)) return JSON.parse(readFileSync(process.env.GSC_KEY_FILE, 'utf8'));
  return null;
}

// 프론트매터 두 값만 — gray-matter 없이 읽어 워크플로가 npm ci 를 안 해도 되게(index-coverage.yml 과 같은 꼴).
function frontmatter(raw) {
  const fm = raw.replace(/\r/g, '').split('\n---')[0];
  const pick = (k) => (fm.match(new RegExp(`^${k}:\\s*(.+)$`, 'm')) || [])[1]?.trim().replace(/^['"]|['"]$/g, '');
  const date = (k) => (pick(k) || '').slice(0, 10) || null;
  return { country: pick('country'), draft: pick('draft') === 'true', pubDate: date('pubDate'), firsthandOn: date('firsthandOn') };
}

// 직접 경험 글: 공개된 글 중 본문에 에디터 사진 경로가 있는 것. 검사는 올라가는 즉시
// 하되, 고정 집합 밖의 글은 분모(fixed:false)에 넣지 않는다 — 분모가 매주 바뀌면 비율을
// 주 단위로 비교할 수 없다(코덱스 10-28). '바뀐 날'(since)은 현장메모 업로드가 찍는
// firsthandOn, 없으면 코호트 시작 이후 발행된 새 글은 발행일, 그 전 글은 코호트 시작일.
function firsthandPosts(cohortStart) {
  const out = [];
  for (const f of readdirSync(POSTS_DIR)) {
    if (!f.endsWith('.md')) continue;
    const raw = readFileSync(`${POSTS_DIR}/${f}`, 'utf8');
    if (!raw.includes('/editor-photos/')) continue;
    const { country, draft, pubDate, firsthandOn } = frontmatter(raw);
    if (draft) continue;
    const since = firsthandOn || (pubDate && cohortStart && pubDate >= cohortStart ? pubDate : cohortStart);
    out.push({ url: `${SITE}/posts/${f.replace(/\.md$/, '')}/`, kind: 'posts', country, since });
  }
  return out;
}

// 사진 보강 그룹(자동): 주간 본문 사진 순찰(backfill-gallery)이 코호트 시작 이후 실제로
// 사진을 더한 글. 그 순찰은 이 자의 staleUrls(색인됐지만 90일+ 미재크롤)를 먼저 돌므로,
// '진짜 내용(검증된 사진)이 더해진 정체 글이 다시 크롤되는가'를 비교군과 함께 잰다.
// since = 사진이 들어간 날(lastTried) — 그 전의 크롤은 성과가 아니다.
function photoRefreshPosts(cohortStart) {
  const p = 'data/gallery-retry.json';
  if (!existsSync(p) || !cohortStart) return [];
  const state = JSON.parse(readFileSync(p, 'utf8'));
  return Object.entries(state)
    .filter(([, v]) => v?.added && v.lastTried && v.lastTried.slice(0, 10) >= cohortStart)
    .map(([slug, v]) => ({ url: `${SITE}/posts/${slug}/`, since: v.lastTried.slice(0, 10) }));
}

function readLedger() {
  if (!existsSync(LEDGER)) return [];
  return readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
const toMap = (entry) => new Map(Object.entries(entry?.perUrl || {}).map(([u, v]) => [u, { coverageState: v[0], lastCrawlTime: v[1] }]));

async function inspectAll(token, site, members) {
  const rows = [];
  let denied = false;
  let quota = false;
  for (const m of members) {
    if (denied || quota) { rows.push({ ...m, error: true }); continue; }
    let j = null;
    for (let attempt = 0; attempt < 2 && !j; attempt++) {
      const res = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ inspectionUrl: m.url, siteUrl: site }),
      });
      // 403 은 두 얼굴이다: 권한 부족(forbidden/PERMISSION_DENIED)과 한도 초과
      // (quotaExceeded/rateLimitExceeded 도 403 으로 온다). 섞어 읽으면 한도에 걸린 날
      // "권한을 올려라"고 안내하고 장부도 안 남는다 — 사유를 읽어 가른다.
      if (res.status === 403 || res.status === 429) {
        let reason = '';
        try { const e = await res.json(); reason = e?.error?.errors?.[0]?.reason || e?.error?.status || ''; } catch { /* 본문 없음 */ }
        if (res.status === 429 || /quota|rateLimit/i.test(reason)) { quota = true; break; }
        if (res.status === 403 && (!reason || /forbidden|PERMISSION_DENIED|insufficientPermissions/i.test(reason))) { denied = true; break; }
        throw new Error(`URL 검사 ${res.status} ${reason} — 예상 밖 오류, 실행을 실패로 둔다`);
      }
      if (res.ok) j = await res.json();
      else await new Promise((r) => setTimeout(r, 1500));
    }
    if (!j) { rows.push({ ...m, error: true }); continue; }
    const s = j.inspectionResult?.indexStatusResult || {};
    rows.push({ ...m, coverageState: s.coverageState || '', lastCrawlTime: s.lastCrawlTime || null });
    await new Promise((r) => setTimeout(r, 350)); // 600/min 한도의 한참 아래
  }
  return { rows, denied, quota };
}

async function impressions28d(token, site) {
  // 양끝 포함 28일(-30..-3). GSC 는 ~3일 늦게 확정된다.
  const body = { startDate: day(-30), endDate: day(-3), dimensions: ['page'], rowLimit: 25000 };
  // GSC 는 www·슬래시 없는 변형을 따로 센다(10-28 표본 354 중 9). 집합은 정규 주소뿐이므로
  // 변형의 노출을 정규 주소에 합친다 — 안 그러면 그 페이지는 '노출 0'으로 읽힌다.
  const canon = (u) => String(u).replace(/^https:\/\/www\./, 'https://').replace(/\/?$/, '/');
  const m = new Map();
  for (let startRow = 0; ; startRow += 25000) {
    const r = await query(token, site, { ...body, startRow });
    const got = r?.rows ?? [];
    for (const x of got) { const k = canon(x.keys[0]); m.set(k, (m.get(k) ?? 0) + (x.impressions ?? 0)); }
    if (got.length < 25000) break;
  }
  return m;
}

async function main() {
  const set = JSON.parse(readFileSync(SET_PATH, 'utf8'));
  const sa = serviceAccount();
  if (!sa) { console.error('GSC_SERVICE_ACCOUNT_JSON / GSC_KEY_FILE 없음 — 건너뜀'); return; }
  const site = process.env.GSC_SITE_URL || set.siteUrl || 'sc-domain:wanderatlasguides.com';
  const today = new Date().toISOString().slice(0, 10);

  const ledger = readLedger();
  const baselineEntry = ledger[0];
  const prevEntry = ledger.at(-1);
  const cohortStart = set.cohortStart || baselineEntry?.at?.slice(0, 10) || today;

  // 구성원: 고정 목록(fixed:true, 비율의 분모) ∪ 직접 경험 글(자동; 집합 밖이면 fixed:false —
  // 검사·코호트에는 들고 비율에는 안 든다). 그룹은 Map<url, 바뀐 날>.
  const fixed = set.urls.map((u) => (typeof u === 'string' ? { url: u, kind: 'other' } : u)).map((m) => ({ ...m, fixed: true }));
  const firsthand = firsthandPosts(cohortStart);
  const byUrl = new Map(fixed.map((m) => [m.url, m]));
  for (const m of firsthand) if (!byUrl.has(m.url)) byUrl.set(m.url, { url: m.url, kind: m.kind, country: m.country, fixed: false });
  // 사진 보강 글은 집합 안의 것만 그룹에 넣는다(집합 밖 글까지 검사하면 한도만 쓴다).
  const photoRefresh = new Map(photoRefreshPosts(cohortStart).filter((m) => byUrl.has(m.url)).map((m) => [m.url, m.since]));
  const members = [...byUrl.values()];
  const groups = { firsthand: new Map(firsthand.map((m) => [m.url, m.since])), photoRefresh };
  for (const [name, urls] of Object.entries(set.groups || {})) groups[name] = new Set(urls);

  const token = await getAccessToken(sa, 'https://www.googleapis.com/auth/webmasters');
  const { rows: inspected, denied, quota } = await inspectAll(token, site, members);
  if (denied) {
    const msg = '📏 핵심 집합 색인 자를 돌릴 수 없습니다 — 서비스 계정의 서치콘솔 권한이 URL 검사에 못 미칩니다(403). 서치콘솔 → 설정 → 사용자에서 "전체" 권한으로 올려 주세요.';
    if (dry) console.log(msg); else if (!(await sendTelegram(msg))) console.log('[TG 미설정]\n' + msg);
    return; // 설정 문제는 실패 스팸이 아니라 안내 1회로
  }
  const imp = await impressions28d(token, site);
  const rows = inspected.map((r) => ({ ...r, impressions: imp.get(r.url) ?? 0 }));

  const summary = summarize(rows, {
    today, staleDays: set.staleDays ?? 90, cohortStart,
    prev: toMap(prevEntry), baseline: toMap(baselineEntry), groups,
  });
  const judge = set.thresholds?.judgeOn && today >= set.thresholds.judgeOn ? judgeCohort(summary, set.thresholds, today) : null;
  const at = new Date().toISOString();
  let text = formatReport(summary, { at, judge, thresholds: set.thresholds });
  if (quota) text = '⚠️ URL 검사 한도(429)에 걸려 중간에 멈췄다 — 아래는 부분 결과.\n' + text;

  console.log(text);
  if (dry) return;

  const perUrl = Object.fromEntries(rows.map((r) => [r.url, r.error ? ['ERROR', null, r.impressions] : [r.coverageState, r.lastCrawlTime, r.impressions]]));
  const { staleUrls, ...rest } = summary;
  mkdirSync(dirname(LEDGER), { recursive: true });
  appendFileSync(LEDGER, JSON.stringify({ at, cohortStart, summary: rest, staleUrls, judge, perUrl }) + '\n', 'utf8');
  if (!(await sendTelegram(text))) console.log('[TG 미설정]');
}

main().catch((e) => { console.error(e); process.exit(1); });
