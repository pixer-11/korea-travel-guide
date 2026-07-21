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

async function main() {
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
    await sendTelegram(`📊 Wander Atlas — analytics report ERROR\n${e.message}`);
    return;
  }

  if (json.errors || !json.data?.viewer?.accounts?.[0]) {
    const msg = JSON.stringify(json.errors || json).slice(0, 350);
    console.error('GraphQL error:', msg);
    await sendTelegram(`📊 Wander Atlas — analytics report FAILED (${dayLabel})\nAPI said: ${msg}`);
    return;
  }

  const a = json.data.viewer.accounts[0];
  const t = a.totals?.[0] ?? { count: 0, sum: { visits: 0 } };
  const pageviews = t.count ?? 0;
  const visits = t.sum?.visits ?? 0;
  const countries = (a.countries ?? []).map((c) => `${c.dimensions.countryName || '??'} ${c.count}`).join(' · ') || '—';
  const pages = (a.pages ?? []).map((p) => `  • ${p.dimensions.requestPath} — ${p.count}`).join('\n') || '  —';

  const text = `📊 Wander Atlas — daily analytics (${dayLabel} UTC)
👀 page views: ${pageviews.toLocaleString()}
🧑 visits: ${visits.toLocaleString()}
🌍 top countries: ${countries}
🔥 top pages:
${pages}`;

  console.log(text);
  await sendTelegram(text);
}

main().catch((e) => { console.error(e); });
