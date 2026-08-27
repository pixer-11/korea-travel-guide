// ─────────────────────────────────────────────────────────────
//  SOCIAL PUBLISH STEP — the part of the morning that used to be the owner.
//
//  threads-daily.mjs builds the day's material and stores it (slug, R2 image
//  URLs, captions) in its state file; this step actually posts it — Threads
//  every day, Instagram Mon/Wed/Fri — and reports the links in Korean. It is
//  idempotent per channel per KST day, so the workflow's three morning
//  attempts can all call it: whatever failed earlier is retried, whatever
//  succeeded is skipped. A publish failure never throws out of here — the
//  morning material Telegram already went out, and the owner is told exactly
//  which channel failed instead of the whole job dying.
// ─────────────────────────────────────────────────────────────
import { loadTokens, saveTokens, refreshTokens, igPublish, thPublish, threadsText, isIgDay } from './meta-social.mjs';

const kstDay = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

async function tg(text) {
  const tok = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!tok || !chat) { console.log('[tg 미설정] ' + text.replace(/\n/g, ' | ')); return; }
  await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
  }).catch(() => {});
}

export const socialEnabled = () =>
  !!(process.env.SOCIAL_TOKEN_KEY && (process.env.INSTAGRAM_ACCESS_TOKEN || process.env.THREADS_ACCESS_TOKEN));

/**
 * Publish today's material to whatever is still pending. Mutates state.social;
 * the caller persists state. DRY=1 verifies tokens and prints the plan without
 * posting anything.
 */
export async function runSocialPublish(state) {
  const day = kstDay();
  const m = state.material;
  if (!m || m.day !== day) { console.log('social: no material for today — nothing to publish'); return; }
  if (!m.urls?.length) { console.log('social: material has no image URLs (R2 upload failed earlier) — manual fallback stands'); return; }
  state.social ||= {};
  const s = state.social;
  const DRY = process.env.DRY === '1';

  let tokens;
  try {
    tokens = await loadTokens();
    const { failures } = await refreshTokens(tokens);
    await saveTokens(tokens);
    if (failures.length) {
      // Not fatal today — the un-refreshed token may still be inside its 60
      // days — but silent failure is how the integration dies, so say it now.
      await tg(`⚠️ 소셜 토큰 연장 실패 — ${failures.join(' · ')}\n지금은 게시를 계속 시도하지만, 이 경고가 반복되면 토큰이 60일 뒤 만료됩니다. 클로드에게 '소셜 토큰 봐줘'라고 말씀하세요.`);
    }
  } catch (e) {
    await tg(`🚨 소셜 자동 게시 불가 — 토큰을 읽지 못했습니다 (${String(e.message).slice(0, 120)})\n오늘 카드는 텔레그램 소재로만 나갔습니다. 클로드에게 '소셜 토큰 봐줘'라고 말씀하세요.`);
    return;
  }

  const wantIg = isIgDay() && s.igDay !== day;
  const wantTh = s.thDay !== day;
  if (!wantIg && !wantTh) { console.log('social: all channels already posted today'); return; }
  if (DRY) {
    console.log(`social DRY: would post — threads:${wantTh} instagram:${wantIg} (${m.urls.length} images, slug ${m.slug})`);
    console.log(`social DRY: threads text →\n${threadsText(m.thOption, m.link)}`);
    return;
  }

  const done = [], failed = [];

  if (wantTh) {
    try {
      const r = await thPublish({ token: tokens.th.token, text: threadsText(m.thOption, m.link), imageUrl: m.urls[0] });
      s.thDay = day; s.thId = r.id;
      done.push(`스레드 ✅ ${r.permalink || '(게시됨: ' + r.id + ')'}`);
    } catch (e) { failed.push(`스레드 ✗ ${String(e.message).slice(0, 160)}`); }
  }

  if (wantIg) {
    try {
      const r = await igPublish({ token: tokens.ig.token, imageUrls: m.urls, caption: m.igCaption });
      s.igDay = day; s.igId = r.id;
      done.push(`인스타 ✅ instagram.com/${r.username} (캐러셀 ${m.urls.length}장)`);
    } catch (e) { failed.push(`인스타 ✗ ${String(e.message).slice(0, 160)}`); }
  }

  const lines = [
    `📣 소셜 자동 게시 — ${m.title || m.slug}`,
    ...done,
    ...failed.map((f) => `⚠️ ${f} — 다음 아침 시도에서 자동 재시도`),
  ];
  if (!wantIg && s.igDay !== day) lines.push('인스타는 오늘 쉬는 날(월·수·금만 게시)');
  await tg(lines.join('\n'));
  console.log(`SOCIAL_SUMMARY th=${s.thDay === day ? 'ok' : 'pending'} ig=${isIgDay() ? (s.igDay === day ? 'ok' : 'pending') : 'off-day'} failed=${failed.length}`);
}
