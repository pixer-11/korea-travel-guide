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
  const countries = (a.countries ?? []).map((c) => `${c.dimensions.countryName || '??'} ${c.count}`).join(' · ') || '—';
  const pages = (a.pages ?? []).map((p) => `  • ${p.dimensions.requestPath} — ${p.count}`).join('\n') || '  —';

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
    const topPages = (pages.results ?? []).map((p) => `  • ${p.page} — ${p.visitors}`).join('\n') || '  —';
    const topSrc = (sources.results ?? []).map((x) => `${x.source || 'Direct'} ${x.visitors}`).join(' · ') || '—';
    const text = `📈 Wander Atlas — 상세 분석 · Plausible (${dayLabel} UTC)
👥 방문자: ${(R.visitors?.value ?? 0).toLocaleString()}
👀 페이지뷰: ${(R.pageviews?.value ?? 0).toLocaleString()}
↩️ 이탈률: ${R.bounce_rate?.value ?? 0}% · ⏱️ 평균체류: ${dur}s
🖱️ 제휴 클릭(Affiliate click): ${clicks}
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
