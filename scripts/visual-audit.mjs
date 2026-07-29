#!/usr/bin/env node
// VISUAL hero-image validation — actually LOOKS at each hero with a vision model
// and judges whether it plausibly depicts the venue, instead of guessing from the
// filename. Catches what the keyword blocklist can't: an empty finished plate, a
// Dutch building for a Vietnamese café, a diving shop for a restaurant, a portrait,
// a bridge, the wrong city/country.
//
// Runs in CI (ANTHROPIC_API_KEY from secrets). RESUMABLE: verdicts are stored in
// data/visual-audit.json keyed by slug+image-url, so re-runs only check new/changed
// heroes and it converges under any rate/time limit. Prints a MISMATCH report and
// (in CI) can be wired to a Telegram warning.
//
//   node scripts/visual-audit.mjs                 # audit un-checked venue posts (resumable), cap AUDIT_LIMIT
//   node scripts/visual-audit.mjs --slugs a,b,c   # audit specific posts (ignores done-log)
//   node scripts/visual-audit.mjs --all           # re-audit everything (ignore done-log)
import './lib/env.mjs';
import Anthropic from '@anthropic-ai/sdk';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const POSTS_DIR = join(ROOT, 'src', 'content', 'posts');
const STORE = join(ROOT, 'data', 'visual-audit.json');
const MODEL = 'claude-haiku-4-5-20251001';
const UA = 'WanderAtlasImageAudit/1.0 (contact pixer.vtm@gmail.com)';
const LIMIT = Number(process.env.AUDIT_LIMIT || 0) || Infinity;
const VENUE = new Set(['restaurant', 'trendy', 'hidden-gem', 'attraction']);

const argSlugs = (() => {
  const i = process.argv.indexOf('--slugs');
  return i > -1 && process.argv[i + 1] ? new Set(process.argv[i + 1].split(',').map((s) => s.trim())) : null;
})();
const AUDIT_ALL = process.argv.includes('--all');

if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY missing'); process.exit(1); }
const anthropic = new Anthropic();

// key = slug + '' + heroUrl → re-checks automatically when the hero changes.
const store = existsSync(STORE) ? JSON.parse(await readFile(STORE, 'utf8')) : {};

async function toBase64(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`img ${res.status}`);
  const type = res.headers.get('content-type') || 'image/jpeg';
  const media = /png/i.test(type) ? 'image/png' : /webp/i.test(type) ? 'image/webp' : /gif/i.test(type) ? 'image/gif' : 'image/jpeg';
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error('img too small (error page?)');
  return { media, data: buf.toString('base64') };
}

async function judge(post, img) {
  const prompt = `You are validating the hero image of a travel guide. The post is:
Title: "${post.title}"
Venue type: ${post.category}
Place: ${post.region}, ${post.country}

Look at the image. Does it plausibly depict THIS venue, its food, its interior/exterior, or its immediate street/setting?
Answer MISMATCH if the image is clearly wrong — e.g. an empty/finished plate with only scraps, a building whose architecture is from the wrong country, the wrong city/country, or an unrelated subject (a grocery/convenience store for a café, an insect specimen, a museum statue/object, a random person's portrait, diving equipment, a vehicle/landscape/bridge for a restaurant, unrelated stock).
Answer WEAK if it's the right place/country but generic and only loosely related.
Answer MATCH if it plausibly fits.
Reply with ONLY a compact JSON object: {"verdict":"MATCH|WEAK|MISMATCH","reason":"<8 words max>","reasonKo":"<같은 내용을 한국어로, 12자 이내>"}
reasonKo must be written in Korean — it is sent to the site owner, who reads Korean, and an English reason has reached him twice before.`;
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 120,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: img.media, data: img.data } },
        { type: 'text', text: prompt },
      ],
    }],
  });
  const text = (msg.content.find((c) => c.type === 'text') || {}).text || '';
  const m = text.match(/\{[\s\S]*\}/);
  const j = m ? JSON.parse(m[0]) : { verdict: 'WEAK', reason: 'unparseable' };
  // Only keep reasonKo if it actually contains Hangul — a model that answers in
  // English regardless would otherwise put English back into the owner's chat
  // through the very field added to prevent it.
  const ko = String(j.reasonKo || '').slice(0, 40);
  return {
    verdict: String(j.verdict || 'WEAK').toUpperCase(),
    reason: String(j.reason || '').slice(0, 60),
    reasonKo: /[가-힣]/.test(ko) ? ko : '',
  };
}

const files = (await readdir(POSTS_DIR)).filter((f) => f.endsWith('.md'));
let checked = 0, mismatch = 0, weak = 0, failed = 0;
const flagged = [];

for (const f of files) {
  if (checked >= LIMIT) break;
  const slug = f.replace(/\.md$/, '');
  if (argSlugs && !argSlugs.has(slug)) continue;
  let data;
  try { ({ data } = matter(await readFile(join(POSTS_DIR, f), 'utf8'))); } catch { continue; }
  const hero = data.heroImage;
  if (!hero || !hero.url) continue;
  if (hero.license === 'google-places' || (hero.url || '').includes('/venue-photos/')) continue; // real venue photo → trust
  if (!VENUE.has(data.category)) continue;
  // Quarantined posts are already off the site (draft → 301) and are the alt-photo
  // patrol's job. Auditing them burns vision calls and, worse, re-reports names the
  // owner has already been told about — which reads as "the same problems keep
  // coming back" when they are in fact already handled.
  if (data.draft === true) continue;
  const key = `${slug}${hero.url}`;
  if (!AUDIT_ALL && !argSlugs && store[key]) continue; // already judged this exact hero

  try {
    const img = await toBase64(hero.url);
    const v = await judge({ title: data.title, category: data.category, region: data.region, country: data.country || 'South Korea' }, img);
    store[key] = { slug, verdict: v.verdict, reason: v.reason, reasonKo: v.reasonKo || null, at: new Date().toISOString() };
    checked++;
    // Korean only. The model's English `reason` used to be interpolated straight
    // into the Telegram message — the third time English reached the owner that
    // way. If the model skips reasonKo, the slug alone is sent rather than English.
    if (v.verdict === 'MISMATCH') { mismatch++; flagged.push(`  ✗ ${slug}${v.reasonKo ? ` — ${v.reasonKo}` : ''}`); }
    else if (v.verdict === 'WEAK') { weak++; }
    console.log(`  ${v.verdict === 'MISMATCH' ? '✗' : v.verdict === 'WEAK' ? '~' : '✓'} ${slug}: ${v.verdict} (${v.reason})`);
  } catch (e) {
    failed++;
    console.log(`  ⚠️  ${slug}: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 200)); // polite
}

await writeFile(STORE, JSON.stringify(store, null, 1) + '\n');
console.log(`\n📸 Visual audit: ${checked} checked · ${mismatch} MISMATCH · ${weak} weak · ${failed} failed.`);
if (flagged.length) { console.log('\nMISMATCHES:'); console.log(flagged.join('\n')); }

// Telegram summary (Korean) when configured and something is off.
const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID && mismatch > 0) {
  // Say what happens NEXT. Without it the list reads as an open to-do for the
  // owner, when every flagged slug is already queued for the automatic repair
  // patrol via data/visual-audit.json.
  const text =
    `🖼️ Wander Atlas — 시각 이미지 검증\n` +
    `오매칭 ${mismatch}건 / 검사 ${checked}건 (첫 검사분만; 이미 격리된 글은 제외)\n` +
    `${flagged.slice(0, 15).join('\n')}\n` +
    `\n➡️ 위 글들은 내일 04:35 자동 수리 순찰이 사진 교체를 시도하고, 실패하면 자동 격리합니다. 따로 하실 일은 없습니다.`;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
  }).catch(() => {});
}
