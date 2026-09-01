// Daily Korean Telegram report of newsletter signups. Read-only. A missing
// token or an unreadable list is reported, not fatal — but a report Telegram
// refused now fails the job, because a green tick over an undelivered report is
// how weeks of silence go unnoticed. Requires MAILERLITE_API_TOKEN,
// TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID.
import { mailerlite } from './lib/mailerlite.mjs';
import { sendTelegram } from './lib/telegram.mjs';

const { MAILERLITE_API_TOKEN } = process.env;

/** Same job as the old local copy, minus the swallowed rejection. */
async function report(text) {
  if (!(await sendTelegram(text, { disable_web_page_preview: true }))) console.log('Telegram secrets missing.');
}

async function main() {
  if (!MAILERLITE_API_TOKEN) { console.error('MAILERLITE_API_TOKEN missing'); return; }
  const ml = mailerlite(MAILERLITE_API_TOKEN);
  let subs;
  try { subs = await ml.listActiveSubscribers(); }
  catch (e) {
    // The reason reaches the log before the notice goes out: a notice Telegram
    // refuses must not take the diagnosis down with it.
    console.error(`newsletter report failed: ${e.message}`);
    await report(`✉️ Wander Atlas 뉴스레터 리포트 오류\n${e.message}`);
    return;
  }

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
  await report(text);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
