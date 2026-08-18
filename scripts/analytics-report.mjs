#!/usr/bin/env node
// Pulls yesterday's Cloudflare Web Analytics (RUM) for the account and sends a
// summary to Telegram. Runs in CI (env from GitHub secrets). Never fails the job.
const { CF_API_TOKEN, CF_ACCOUNT_ID, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;

function isoDay(offset) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString();
}
const start = isoDay(-1); // yesterday 00:00 UTC
const end = isoDay(0); // today 00:00 UTC
const dayLabel = start.slice(0, 10);

// Turn a raw URL path (e.g. "/regions/seoul/") into a readable Korean label so the
// Telegram report is skimmable instead of a wall of slugs.
const LANG = { ko: '한국어', ja: '일본어', es: '스페인어', zh: '중국어' };
const deslug = (s) => s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// Everything the user reads must be Korean, including place names. Reuse the
// site's own place table (src/i18n/places.json) for country/city names, and the
// Korean post translations for article titles, so the report never shows a raw
// English slug like "South Korea (국가)" or "Hanoi Hanoi Old Quarter".
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const readJson = (rel) => {
  try { return JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')); }
  catch { return {}; }
};
const PLACES = readJson('../src/i18n/places.json');
const koPlace = (englishName) => PLACES[englishName]?.ko || englishName;
const I18N_KO = fileURLToPath(new URL('../src/content/i18n/ko/', import.meta.url));
function koPostTitle(slug) {
  try {
    const fm = readFileSync(join(I18N_KO, `${slug}.md`), 'utf8').split('---')[1] || '';
    const m = /(?:^|\n)title:[ \t]*(?:'((?:[^']|'')*)'|"([^"]*)"|([^\n]+))/.exec(fm);
    const v = m ? (m[1]?.replace(/''/g, "'") ?? m[2] ?? m[3] ?? '').trim() : '';
    return v || null;
  } catch { return null; }
}
// Cloudflare returns ISO-2 country codes; show the Korean name (fall back to the
// code for anywhere not listed).
const COUNTRY_KO = {
  KR: '대한민국', US: '미국', JP: '일본', CN: '중국', VN: '베트남', TH: '태국', GB: '영국',
  FR: '프랑스', DE: '독일', IN: '인도', SG: '싱가포르', PH: '필리핀', ID: '인도네시아',
  MY: '말레이시아', TW: '대만', HK: '홍콩', MO: '마카오', AU: '호주', NZ: '뉴질랜드',
  CA: '캐나다', ES: '스페인', IT: '이탈리아', TR: '튀르키예', AE: '아랍에미리트',
  SA: '사우디아라비아', QA: '카타르', RU: '러시아', BR: '브라질', MX: '멕시코',
  AR: '아르헨티나', CL: '칠레', CO: '콜롬비아', PE: '페루', NL: '네덜란드', BE: '벨기에',
  CH: '스위스', AT: '오스트리아', SE: '스웨덴', NO: '노르웨이', DK: '덴마크', FI: '핀란드',
  IE: '아일랜드', PT: '포르투갈', GR: '그리스', PL: '폴란드', CZ: '체코', HU: '헝가리',
  RO: '루마니아', UA: '우크라이나', IL: '이스라엘', EG: '이집트', ZA: '남아프리카공화국',
  NG: '나이지리아', KE: '케냐', PK: '파키스탄', BD: '방글라데시', LK: '스리랑카',
  NP: '네팔', MM: '미얀마', KH: '캄보디아', LA: '라오스', MN: '몽골', KZ: '카자흐스탄',
};
const koCountry = (code) => COUNTRY_KO[String(code || '').toUpperCase()] || code || '기타';
// Plausible's referrer buckets are English labels, not data we control.
const koSource = (s) => {
  const v = String(s || '').trim();
  if (!v || /^direct/i.test(v) || v === 'None') return '직접 유입';
  return v;
};
function pageLabel(path) {
  const p = (path || '/').replace(/\/+$/, '') || '/';
  if (p === '/') return '홈';
  let m;
  if ((m = p.match(/^\/(ko|ja|es|zh)$/))) return `홈 (${LANG[m[1]]})`;
  if ((m = p.match(/^\/(ko|ja|es|zh)\/(.+)/))) return `${pageLabel('/' + m[2])} · ${LANG[m[1]]}`;
  const FIXED = {
    '/flights': '항공권', '/contact': '문의', '/about': '소개·편집정책',
    '/privacy': '개인정보', '/terms': '이용약관', '/destinations': '여행지 전체',
    '/regions': '지역 전체', '/free/trip-checklist': '여행 체크리스트',
  };
  if (FIXED[p]) return FIXED[p];
  if ((m = p.match(/^\/destinations\/(.+)/))) return `${koPlace(deslug(m[1]))} (국가)`;
  if ((m = p.match(/^\/regions\/(.+)/))) return `${koPlace(deslug(m[1]))} (지역)`;
  if ((m = p.match(/^\/essentials\/(.+)/))) {
    const ESS_KO = {
      Visa: '비자·입국', Transport: '교통·이동', Money: '돈·비용',
      'Best Time To Visit': '가기 좋은 시기', Emergency: '응급·도움',
    };
    const label = deslug(m[1]);
    return `필수정보: ${ESS_KO[label] || koPlace(label)}`;
  }
  // Prefer the Korean translation's title; fall back to the slug if that post
  // hasn't been translated yet.
  if ((m = p.match(/^\/posts\/(.+)/))) return `글: ${koPostTitle(m[1]) || deslug(m[1])}`;
  return p;
}

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) { console.log('Telegram secrets missing — skipping send.'); return; }
  const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) console.error('Telegram send failed:', JSON.stringify(j));
  else console.log('Telegram sent.');
}

// Both collectors RETURN data (or null); main() composes ONE Telegram message.
// Why two sources at all: Cloudflare RUM counts visitors that ad/tracker blockers
// hide from Plausible (so its totals are the truer volume), while only Plausible
// records behaviour — bounce, dwell time, affiliate clicks, referrer. Merging
// gives one honest picture instead of two messages the reader has to reconcile.
async function cfReport() {
  if (!CF_API_TOKEN || !CF_ACCOUNT_ID) {
    console.error('CF_API_TOKEN / CF_ACCOUNT_ID missing.');
    return null;
  }

  const filter = `{ datetime_geq: "${start}", datetime_leq: "${end}" }`;
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${CF_ACCOUNT_ID}" }) {
        totals: rumPageloadEventsAdaptiveGroups(filter: ${filter}, limit: 1) {
          count
          sum { visits }
        }
        pages: rumPageloadEventsAdaptiveGroups(filter: ${filter}, orderBy: [count_DESC], limit: 5) {
          count
          dimensions { requestPath }
        }
        countries: rumPageloadEventsAdaptiveGroups(filter: ${filter}, orderBy: [count_DESC], limit: 5) {
          count
          dimensions { countryName }
        }
      }
    }
  }`;

  let json;
  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    json = await res.json();
  } catch (e) {
    console.error('Cloudflare fetch failed:', e.message);
    return { error: e.message };
  }

  if (json.errors || !json.data?.viewer?.accounts?.[0]) {
    const msg = JSON.stringify(json.errors || json).slice(0, 200);
    console.error('GraphQL error:', msg);
    return { error: msg };
  }

  const a = json.data.viewer.accounts[0];
  const t = a.totals?.[0] ?? { count: 0, sum: { visits: 0 } };
  const pageviews = t.count ?? 0;
  const visits = t.sum?.visits ?? 0;
  const countries = (a.countries ?? []).map((c) => `${koCountry(c.dimensions.countryName)} ${c.count}`).join(' · ') || '—';
  const pages = (a.pages ?? []).map((p) => `  • ${pageLabel(p.dimensions.requestPath)} — ${p.count}`).join('\n') || '  —';

  return { pageviews, visits, countries, pages };
}

// ── Plausible (cookieless) — detailed, event-level report incl. affiliate clicks ──
//
// Two doors into the same numbers:
//   1. Stats API v1 (Bearer key) — a BUSINESS-plan feature. The account is on
//      Starter (paid through 2027-08-17), so since the trial ended every call
//      returns 402 "does not have access". It is tried first only so that an
//      upgrade would be picked up without a code change.
//   2. The public dashboard's own query endpoint — the owner switched the
//      dashboard to public on 2026-08-17, and the browser reads it through
//      POST /api/stats/<site>/query/ with no auth. Verified 2026-08-18: same
//      visitors/bounce/duration/sources/goal counts as the dashboard shows.
//      This is what actually runs today. If the owner ever turns the public
//      toggle off, this door closes too and the report says so.
// Until 2026-08-18 the report tried door 1 alone and printed a "수집 실패 402"
// line every day for a lock that no one was going to open.
const { PLAUSIBLE_API_KEY, PLAUSIBLE_SITE_ID } = process.env;
async function pla(path) {
  const r = await fetch(`https://plausible.io/api/v1/stats/${path}`, {
    headers: { Authorization: `Bearer ${PLAUSIBLE_API_KEY}` },
  });
  if (!r.ok) throw new Error(`Plausible ${r.status}: ${(await r.text()).slice(0, 120)}`);
  return r.json();
}

// The dashboard's date_range wants explicit ISO instants; use the same UTC day
// as the Cloudflare figures so the two halves of the report describe one day.
async function plaPublic(body) {
  const site = PLAUSIBLE_SITE_ID;
  const r = await fetch(`https://plausible.io/api/stats/${encodeURIComponent(site)}/query/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (WanderAtlas daily report)' },
    body: JSON.stringify({
      site_id: site,
      date_range: [`${dayLabel}T00:00:00+00:00`, `${dayLabel}T23:59:59+00:00`],
      filters: [],
      dimensions: [],
      ...body,
    }),
  });
  if (!r.ok) throw new Error(`Plausible public ${r.status}: ${(await r.text()).slice(0, 120)}`);
  const j = await r.json();
  return j.results ?? [];
}

async function plausibleViaPublicDashboard() {
  const [agg] = await plaPublic({ metrics: ['visitors', 'pageviews', 'bounce_rate', 'visit_duration'] });
  const pages = await plaPublic({ metrics: ['visitors'], dimensions: ['event:page'], pagination: { limit: 5 } });
  const sources = await plaPublic({ metrics: ['visitors'], dimensions: ['visit:source'], pagination: { limit: 5 } });
  let clicks = 0;
  try {
    const [g] = await plaPublic({ metrics: ['events'], filters: [['is', 'event:goal', ['Affiliate click']]] });
    clicks = g?.metrics?.[0] ?? 0;
  } catch (e) { console.log('affiliate-click metric skipped:', e.message); }
  const [visitors = 0, pageviews = 0, bounce = 0, dur = 0] = agg?.metrics ?? [];
  return {
    visitors, pageviews, bounce, dur: Math.round(dur), clicks,
    topSrc: sources.map((x) => `${koSource(x.dimensions[0])} ${x.metrics[0]}`).join(' · ') || '—',
    topPages: pages.map((p) => `  • ${pageLabel(p.dimensions[0])} — ${p.metrics[0]}`).join('\n') || '  —',
  };
}

async function plausibleViaStatsApi() {
  const s = encodeURIComponent(PLAUSIBLE_SITE_ID);
  const q = `site_id=${s}&period=day&date=${dayLabel}`;
  const agg = await pla(`aggregate?${q}&metrics=visitors,pageviews,bounce_rate,visit_duration`);
  const pages = await pla(`breakdown?${q}&property=event:page&metrics=visitors&limit=5`);
  const sources = await pla(`breakdown?${q}&property=visit:source&metrics=visitors&limit=5`);
  let clicks = 0;
  try {
    const g = await pla(`aggregate?${q}&metrics=events&filters=${encodeURIComponent('event:name==Affiliate click')}`);
    clicks = g.results?.events?.value ?? 0;
  } catch (e) { console.log('affiliate-click metric skipped:', e.message); }

  const R = agg.results ?? {};
  const topPages = (pages.results ?? []).map((p) => `  • ${pageLabel(p.page)} — ${p.visitors}`).join('\n') || '  —';
  const topSrc = (sources.results ?? []).map((x) => `${koSource(x.source)} ${x.visitors}`).join(' · ') || '—';
  return {
    visitors: R.visitors?.value ?? 0,
    pageviews: R.pageviews?.value ?? 0,
    bounce: R.bounce_rate?.value ?? 0,
    dur: Math.round(R.visit_duration?.value ?? 0),
    clicks,
    topSrc,
    topPages,
  };
}

async function plausibleReport() {
  if (!PLAUSIBLE_SITE_ID) {
    console.log('Plausible env missing — skipping Plausible report.');
    return null;
  }
  if (PLAUSIBLE_API_KEY) {
    try { return await plausibleViaStatsApi(); }
    catch (e) { console.log('Plausible Stats API unavailable (expected on Starter):', e.message.slice(0, 80)); }
  }
  try { return await plausibleViaPublicDashboard(); }
  catch (e) {
    console.error('Plausible report failed:', e.message);
    return { error: e.message };
  }
}

// "219초" is arithmetic the reader shouldn't have to do at a glance.
const koDuration = (s) => (s >= 60 ? `${Math.floor(s / 60)}분 ${s % 60}초` : `${s}초`);

async function main() {
  const [cf, pl] = await Promise.all([cfReport(), plausibleReport()]);
  const cfOk = cf && !cf.error;
  const plOk = pl && !pl.error;

  if (!cfOk && !plOk) {
    const why = [cf?.error && `CF: ${cf.error}`, pl?.error && `Plausible: ${pl.error}`]
      .filter(Boolean).join(' | ') || '설정 없음';
    await sendTelegram(`📊 Wander Atlas — 일일 리포트 실패 (${dayLabel})\n${why}`);
    return;
  }

  const L = [`📊 Wander Atlas — 일일 리포트 (${dayLabel} UTC)`, ''];

  // Headline volume: Cloudflare when available (blocker-proof), else Plausible.
  if (cfOk) {
    L.push(`👥 방문 ${cf.visits.toLocaleString()}명 · 페이지뷰 ${cf.pageviews.toLocaleString()}`);
    if (plOk) L.push(`   └ 행동 추적 가능분: ${pl.visitors.toLocaleString()}명 (광고차단 사용자는 제외됨)`);
  } else {
    L.push(`👥 방문 ${pl.visitors.toLocaleString()}명 · 페이지뷰 ${pl.pageviews.toLocaleString()}`);
    L.push(`   └ ⚠️ 전체 집계(Cloudflare) 실패 — 실제 방문은 이보다 많습니다`);
  }

  if (plOk) {
    L.push(`⏱️ 평균 체류 ${koDuration(pl.dur)} · ↩️ 이탈률 ${pl.bounce}%`);
    L.push(`🖱️ 제휴 링크 클릭 ${pl.clicks}회`);
  }

  L.push('');
  if (cfOk) L.push(`🌍 상위 국가: ${cf.countries}`);
  if (plOk) L.push(`🌐 유입원: ${pl.topSrc}`);

  L.push('', '🔥 인기 페이지');
  L.push(cfOk ? cf.pages : pl.topPages);

  // Surface a half-failure instead of silently dropping a section.
  if (cfOk && pl?.error) L.push('', `⚠️ 행동 통계(Plausible) 수집 실패: ${pl.error.slice(0, 80)}`, '   └ 공개 대시보드(plausible.io/wanderatlasguides.com)가 꺼졌는지 확인하세요');

  const text = L.join('\n');
  console.log(text);
  await sendTelegram(text);
}

main().catch((e) => { console.error(e); });
