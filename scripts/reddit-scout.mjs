// ─────────────────────────────────────────────────────────────
//  REDDIT SCOUT — semi-automatic outreach, "only the post button is human".
//
//  Finds fresh question posts the editor can genuinely help with, drafts a
//  context-fitting answer (EN to paste + KO explanation), and sends 2-3 cards
//  to the owner's Telegram. The owner opens the link, pastes, posts — 5 min/day.
//
//  Why not full automation: Reddit detects accounts by BEHAVIOR (posting
//  rhythm, account age vs activity), not access path — a periodic machine
//  commenter gets shadowbanned and takes the backlink strategy's only channel
//  with it. Reading public JSON is fine; writing stays human.
//
//  Warm-up rules (reddit-outreach-rules): NO links in drafts. Pure help only.
//  The 9:1 link phase comes later, by hand, once karma has aged.
//
//    node scripts/reddit-scout.mjs           # send today's cards
//    node scripts/reddit-scout.mjs --dry     # print instead of Telegram
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MODEL = process.env.TRANSLATE_MODEL || 'claude-sonnet-5';
const DRY = process.argv.includes('--dry');
const SEEN = fileURLToPath(new URL('../data/reddit-scout-seen.json', import.meta.url));
const MAX_CARDS = 3;

// Subreddits where the editor's REAL experience (visited countries + our
// measured crowd data) makes an answer credible. Question-shaped posts only.
const SUBS = [
  'JapanTravel', 'JapanTravelTips', 'koreatravel',
  'ThailandTourism', 'travel', 'solotravel', 'Shoestring',
];
const TOPIC = /crowd|busy|queue|line|when to (go|visit)|best time|itinerary|worth it|how (long|many days)|first time|avoid/i;

const seen = existsSync(SEEN) ? JSON.parse(readFileSync(SEEN, 'utf8')) : { ids: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Reddit 403s anonymous .json since 2023, but the Atom feeds still answer.
// No comment counts in a feed — freshness + topic filters carry the load.
async function redditRss(path) {
  // One feed every 20s, plus one 90s retry on 429: at 2s the second request
  // already drew rate limits. Runs once a day from a cron — minutes are free.
  let r;
  for (const wait of [20000, 90000]) {
    await sleep(wait);
    r = await fetch(`https://www.reddit.com${path}`, {
      headers: { 'user-agent': 'wa-scout/1.0 rss reader (contact via site)' },
    });
    if (r.status !== 429) break;
  }
  if (!r.ok) { console.log(`  feed ${path} → ${r.status}`); return []; }
  const xml = await r.text();
  const entries = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const pick = (tag) => (e.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`)) ?? [])[1] ?? '';
    const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    const html = unesc(pick('content'));
    entries.push({
      id: pick('id'),
      title: unesc(pick('title')),
      url: (e.match(/<link href="([^"]+)"/) ?? [])[1] ?? '',
      published: pick('published'),
      body: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    });
  }
  return entries;
}

// ── 1) gather fresh question posts ───────────────────────────
const candidates = [];
for (const sub of SUBS) {
  for (const d of await redditRss(`/r/${sub}/new.rss?limit=25`)) {
    if (!d.id || seen.ids.includes(d.id)) continue;
    const ageH = (Date.now() - new Date(d.published).getTime()) / 36e5;
    if (!Number.isFinite(ageH) || ageH > 24) continue;  // fresh: answers still land on top
    const text = `${d.title}\n${d.body}`;
    if (!/\?/.test(d.title) && !TOPIC.test(text)) continue;
    if (!TOPIC.test(text)) continue;
    candidates.push({
      id: d.id, sub, title: d.title, url: d.url,
      body: d.body.slice(0, 2000), comments: '?', ageH: Math.round(ageH),
    });
  }
}
console.log(`${candidates.length} fresh question post(s) across ${SUBS.length} subs`);
if (!candidates.length) process.exit(0);

// ── 2) draft answers for the best few ────────────────────────
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const picked = candidates.slice(0, 8);
const cards = [];
for (const p of picked) {
  if (cards.length >= MAX_CARDS) break;
  const prompt = `You are drafting a Reddit comment for a Korean travel editor who has PERSONALLY traveled Japan, South Korea (most regions), Thailand, Vietnam (extensively), Singapore, Spain, France, Laos, Cambodia, Indonesia, Hong Kong, Macau, China, Taiwan, Mongolia, Georgia, the US, Australia, New Zealand, Czechia and Russia. The editor also maintains hour-by-hour measured crowd data for hundreds of attractions.

POST in r/${p.sub} (${p.ageH}h old, ${p.comments} comments):
TITLE: ${p.title}
BODY: ${p.body || '(no body)'}

Write a genuinely helpful Reddit comment IF AND ONLY IF the editor's real experience covers this question. Rules:
- NO links, NO site names, NO self-promotion of any kind (account is warming up).
- Sound like a well-traveled person typing casually — contractions, concrete details, no listicle formatting, no "As someone who...err" clichés. 2-6 sentences unless the question begs for structure.
- Only concrete facts you are confident are true and durable (geography, well-known transit, seasonal patterns). NEVER invent prices, current hours, or event dates.
- If the question is outside the editor's credible experience, or an answer would need facts you can't be sure of, respond with SKIP.

Fill each tool field separately as plain text: answer_en = the English reply only, why_ko = 1-2 Korean sentences only, answer_ko = the full Korean translation of answer_en only. Never wrap a field in XML/HTML tags and never put another field's content inside a field.

Use the submit_card tool.`;
  try {
    const msg = await client.messages.create({
      // 1200 truncated the Korean fields after a long English answer — the
      // tool input parsed partially and why_ko/answer_ko arrived undefined.
      model: MODEL, max_tokens: 3000,
      tools: [{
        name: 'submit_card',
        input_schema: {
          type: 'object',
          properties: {
            verdict: { type: 'string', enum: ['OK', 'SKIP'] },
            answer_en: { type: 'string' },
            why_ko: { type: 'string', description: '한국어 1-2문장: 왜 적합한지와 답변 요지' },
            answer_ko: { type: 'string', description: '답변의 한국어 번역' },
          },
          required: ['verdict', 'answer_en', 'why_ko', 'answer_ko'],
        },
      }],
      tool_choice: { type: 'tool', name: 'submit_card' },
      messages: [{ role: 'user', content: prompt }],
    });
    const j = msg.content.find((b) => b.type === 'tool_use')?.input ?? {};
    seen.ids.push(p.id);
    // The model sometimes writes the Korean fields as one blob with XML-ish
    // tags — why_ko arrives as "…</answer_ko>\n<answer_ko>…</answer_ko>" and
    // answer_ko is missing, so the card printed "답변 내용: undefined" (every
    // day the owner looked, 2026-08-22). Salvage: lift a tagged answer out of
    // whichever field carries it, then strip stray tags from every field. A
    // card never prints "undefined"; a missing translation says so in Korean.
    const TAG = /<\/?(answer_ko|why_ko|answer_en|answer|why)\b[^>]*>/gi;
    const hasTag = (s) => /<\/?(answer_ko|why_ko|answer_en|answer|why)\b/i.test(String(s || '')); // non-global: .test() on a /g regex is stateful
    const lift = (field) => (String(j.why_ko || '') + '\n' + String(j.answer_ko || '')).match(new RegExp(`<${field}>([\\s\\S]*?)(?:<\\/${field}>|$)`, 'i'))?.[1]?.trim();
    if (!j.answer_ko || hasTag(j.answer_ko)) j.answer_ko = lift('answer_ko') || j.answer_ko;
    if (!j.why_ko || hasTag(j.why_ko)) j.why_ko = lift('why_ko') || j.why_ko;
    for (const k of ['why_ko', 'answer_ko', 'answer_en']) {
      j[k] = String(j[k] ?? '').replace(TAG, '').replace(/\n{3,}/g, '\n\n').trim();
    }
    // why_ko that still contains the whole answer is the answer, not the why:
    // keep the first paragraph as the why and move the rest into the answer.
    if (!j.answer_ko && j.why_ko.length > 240) {
      const [first, ...rest] = j.why_ko.split(/\n+/);
      j.why_ko = first; j.answer_ko = rest.join('\n').trim();
    }
    if (!j.answer_ko) j.answer_ko = '(한국어 번역이 오지 않았습니다 — 위 영어 답변 참고)';
    if (j.verdict !== 'OK' || !j.answer_en) continue;
    // Warm-up hard guard: a draft that smuggles a URL or the site name never ships.
    if (/https?:\/\/|wanderatlas/i.test(j.answer_en)) { console.log(`  guard: dropped a draft carrying a link (${p.id})`); continue; }
    cards.push({ ...p, ...j });
  } catch (e) { console.log(`  draft failed for ${p.id}: ${e.message}`); }
}
if (!DRY) writeFileSync(SEEN, JSON.stringify({ ids: seen.ids.slice(-500) }, null, 2) + '\n');
console.log(`${cards.length} card(s) drafted`);

// ── 3) deliver ───────────────────────────────────────────────
const TG = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;
for (const c of cards) {
  const text = [
    `🎯 레딧 답변 카드 — r/${c.sub} (${c.ageH}시간 전 · 댓글 ${c.comments}개)`,
    ``,
    `📄 ${c.title}`,
    `🔗 ${c.url}`,
    ``,
    `🇰🇷 왜 이 글: ${c.why_ko}`,
    ``,
    `💬 복붙용 답변 (영어):`,
    c.answer_en,
    ``,
    `🇰🇷 답변 내용: ${c.answer_ko}`,
    ``,
    `⚠️ 예열 단계: 링크·사이트 언급 없음 확인됨. 마음에 안 들면 무시하세요.`,
  ].join('\n');
  if (DRY || !TG || !CHAT) { console.log('\n' + text); continue; }
  await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT, text, disable_web_page_preview: true }),
  });
}
console.log(DRY ? '(dry run — nothing sent)' : `${cards.length} card(s) sent to Telegram`);
