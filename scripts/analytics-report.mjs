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

async function cfReport() {
  if (!CF_API_TOKEN || !CF_ACCOUNT_ID) {
    console.error('CF_API_TOKEN / CF_ACCOUNT_ID missing.');
    return;
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
    await sendTelegram(`📊 Wander Atlas — 분석 리포트 오류\n${e.message}`);
    return;
  }

  if (json.errors || !json.data?.viewer?.accounts?.[0]) {
    const msg = JSON.stringify(json.errors || json).slice(0, 350);
    console.error('GraphQL error:', msg);
    await sendTelegram(`📊 Wander Atlas — 분석 리포트 실패 (${dayLabel})\nAPI 응답: ${msg}`);
    return;
  }

  const a = json.data.viewer.accounts[0];
  const t = a.totals?.[0] ?? { count: 0, sum: { visits: 0 } };
  const pageviews = t.count ?? 0;
  const visits = t.sum?.visits ?? 0;
  const countries = (a.countries ?? []).map((c) => `${koCountry(c.dimensions.countryName)} ${c.count}`).join(' · ') || '—';
  const pages = (a.pages ?? []).map((p) => `  • ${pageLabel(p.dimensions.requestPath)} — ${p.count}`).join('\n') || '  —';

  const text = `📊 Wander Atlas — 일일 분석 (${dayLabel} UTC)
👀 페이지뷰: ${pageviews.toLocaleString()}
🧑 방문: ${visits.toLocaleString()}
🌍 상위 국가: ${countries}
🔥 인기 페이지:
${pages}`;

  console.log(text);
  await sendTelegram(text);
}

// ── Plausible (cookieless) — detailed, event-level report incl. affiliate clicks ──
const { PLAUSIBLE_API_KEY, PLAUSIBLE_SITE_ID } = process.env;
async function pla(path) {
  const r = await fetch(`https://plausible.io/api/v1/stats/${path}`, {
    headers: { Authorization: `Bearer ${PLAUSIBLE_API_KEY}` },
  });
  if (!r.ok) throw new Error(`Plausible ${r.status}: ${(await r.text()).slice(0, 120)}`);
  return r.json();
}

async function plausibleReport() {
  if (!PLAUSIBLE_API_KEY || !PLAUSIBLE_SITE_ID) {
    console.log('Plausible env missing — skipping Plausible report.');
    return;
  }
  const s = encodeURIComponent(PLAUSIBLE_SITE_ID);
  const q = `site_id=${s}&period=day&date=${dayLabel}`;
  try {
    const agg = await pla(`aggregate?${q}&metrics=visitors,pageviews,bounce_rate,visit_duration`);
    const pages = await pla(`breakdown?${q}&property=event:page&metrics=visitors&limit=5`);
    const sources = await pla(`breakdown?${q}&property=visit:source&metrics=visitors&limit=5`);
    let clicks = 0;
    try {
      const g = await pla(`aggregate?${q}&metrics=events&filters=${encodeURIComponent('event:name==Affiliate click')}`);
      clicks = g.results?.events?.value ?? 0;
    } catch (e) { console.log('affiliate-click metric skipped:', e.message); }

    const R = agg.results ?? {};
    const dur = Math.round((R.visit_duration?.value ?? 0));
    const topPages = (pages.results ?? []).map((p) => `  • ${pageLabel(p.page)} — ${p.visitors}`).join('\n') || '  —';
    const topSrc = (sources.results ?? []).map((x) => `${koSource(x.source)} ${x.visitors}`).join(' · ') || '—';
    const text = `📈 Wander Atlas — 상세 분석 · Plausible (${dayLabel} UTC)
👥 방문자: ${(R.visitors?.value ?? 0).toLocaleString()}
👀 페이지뷰: ${(R.pageviews?.value ?? 0).toLocaleString()}
↩️ 이탈률: ${R.bounce_rate?.value ?? 0}% · ⏱️ 평균 체류: ${dur}초
🖱️ 제휴 링크 클릭: ${clicks}
🌐 유입원: ${topSrc}
🔥 인기 페이지:
${topPages}`;
    console.log(text);
    await sendTelegram(text);
  } catch (e) {
    console.error('Plausible report failed:', e.message);
    await sendTelegram(`📈 Wander Atlas — Plausible 리포트 오류\n${e.message}`);
  }
}

async function main() {
  await cfReport();
  await plausibleReport();
}

main().catch((e) => { console.error(e); });
