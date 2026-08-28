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
import { loadTokens, saveTokens, refreshTokens, igPublish, thPublish, threadsText, isIgDay, TOKEN_FILE } from './meta-social.mjs';
import { existsSync } from 'node:fs';

const kstDay = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

// 실패를 삼키지 않는다 (2026-08-27 코덱스 감사): 401·429 도 fetch 입장에선
// "성공한 요청"이라 res.ok 를 봐야 하고, 이 알림은 실패를 전하는 유일한
// 통로라 이것마저 죽으면 호출자가 잡을 빨간불(exit code)만 남는다.
async function tg(text) {
  const tok = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!tok || !chat) { console.log('[tg 미설정] ' + text.replace(/\n/g, ' | ')); return false; }
  try {
    const res = await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
    });
    if (!res.ok) { console.error(`social tg failed: ${res.status} ${(await res.text()).slice(0, 160)}`); return false; }
    return true;
  } catch (e) { console.error(`social tg failed: ${e.message}`); return false; }
}

// 켜짐 판정은 loadTokens 가 실제로 성공할 조건과 같아야 한다 (2026-08-27
// 코덱스 감사): 토큰의 진짜 거처는 금고 파일이므로 금고+열쇠면 충분하고,
// 금고가 아직 없을 때만 부트스트랩 시크릿 "둘 다"가 필요하다(loadTokens 가
// 둘 다 요구한다 — 하나만 보고 켜지면 두 채널이 함께 죽는다).
export const socialEnabled = (storeFile = TOKEN_FILE) =>
  !!(process.env.SOCIAL_TOKEN_KEY &&
     (existsSync(storeFile) || (process.env.INSTAGRAM_ACCESS_TOKEN && process.env.THREADS_ACCESS_TOKEN)));

/**
 * 채널별 재시도 판정 (순수). 마커는 날짜 + 소재 신원(slug)을 함께 본다 —
 * 날짜만 보면 "정상 게시 성공 → 새 소재 --force 실패" 뒤 새 소재가 영영
 * 재시도되지 않는다 (2026-08-27 코덱스 감사). 슬러그 없는 옛 마커는 같은
 * 날짜만으로 완료로 친다(마이그레이션 시 재게시 방지).
 */
export function decideWants({ social = {}, day, slug, force = false, igDay }) {
  const pending = (chDay, chSlug) => chDay !== day || (chSlug != null && slug != null && chSlug !== slug);
  return {
    wantTh: !!(force || pending(social.thDay, social.thSlug)),
    wantIg: !!(igDay && (force || pending(social.igDay, social.igSlug))),
  };
}

/**
 * Publish today's material to whatever is still pending. Mutates state.social;
 * the caller persists state. DRY=1 verifies tokens and prints the plan without
 * posting anything.
 *
 * Returns { failed: string[] } — the caller decides what a failure does to the
 * job. It used to return nothing and the job stayed green however badly the
 * morning went (Codex audit 2026-08-27): a red job is what feeds
 * job-failure-alert, so failures must reach the exit code, AFTER state is
 * saved (a red job must never cost the record of what DID succeed).
 */
export async function runSocialPublish(state, { force = false } = {}) {
  const day = kstDay();
  const m = state.material;
  if (!m || m.day !== day) { console.log('social: no material for today — nothing to publish'); return { failed: [] }; }
  if (!m.urls?.length) { console.log('social: material has no image URLs (R2 upload failed earlier) — manual fallback stands'); return { failed: [] }; }
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
    return { failed: [`토큰 ✗ ${String(e.message).slice(0, 160)}`] };
  }

  // --force re-sends today (the owner asked for a redo — e.g. the 08-27
  // single-image first post, reposted as the full carousel minutes later).
  const { wantTh, wantIg } = decideWants({ social: s, day, slug: m.slug, force, igDay: isIgDay() });
  if (!wantIg && !wantTh) { console.log('social: all channels already posted today'); return { failed: [] }; }
  if (DRY) {
    console.log(`social DRY: would post — threads:${wantTh} instagram:${wantIg} (${m.urls.length} images, slug ${m.slug})`);
    console.log(`social DRY: threads text →\n${threadsText(m.thOption, m.link)}`);
    return { failed: [] };
  }

  const done = [], failed = [];

  if (wantTh) {
    try {
      const r = await thPublish({ token: tokens.th.token, text: threadsText(m.thOption, m.link), imageUrls: m.urls });
      s.thDay = day; s.thSlug = m.slug; s.thId = r.id;
      done.push(`스레드 ✅ (${m.urls.length}장) ${r.permalink || '(게시됨: ' + r.id + ')'}`);
    } catch (e) { failed.push(`스레드 ✗ ${String(e.message).slice(0, 160)}`); }
  }

  if (wantIg) {
    try {
      const r = await igPublish({ token: tokens.ig.token, imageUrls: m.urls, caption: m.igCaption });
      s.igDay = day; s.igSlug = m.slug; s.igId = r.id;
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
  return { failed };
}
