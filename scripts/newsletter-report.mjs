// Daily Korean Telegram report of newsletter signups. Read-only. Never throws out
// of the job (mirrors analytics-report.mjs). Requires MAILERLITE_API_TOKEN,
// TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID.
import { mailerlite } from './lib/mailerlite.mjs';

const { MAILERLITE_API_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) { console.log('Telegram secrets missing.'); return; }
  const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) console.error('Telegram failed:', JSON.stringify(j));
}

async function main() {
  if (!MAILERLITE_API_TOKEN) { console.error('MAILERLITE_API_TOKEN missing'); return; }
  const ml = mailerlite(MAILERLITE_API_TOKEN);
  let subs;
  try { subs = await ml.listActiveSubscribers(); }
  catch (e) { await sendTelegram(`✉️ Wander Atlas 뉴스레터 리포트 오류\n${e.message}`); return; }

  const total = subs.length;
  const region = (s) => (s.fields && s.fields.region) || '전체추천';
  const byRegion = {};
  for (const s of subs) byRegion[region(s)] = (byRegion[region(s)] || 0) + 1;
  const top = Object.entries(byRegion).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([r, n]) => `${r} ${n}`).join(' · ') || '—';

  const text = `✉️ Wander Atlas — 뉴스레터 구독 현황
👥 누적 구독자: ${total.toLocaleString()}명
🗺️ 지역별: ${top}`;
  console.log(text);
  await sendTelegram(text);
}

main().catch((e) => console.error(e));
