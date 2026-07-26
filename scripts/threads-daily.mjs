// Daily Threads material: pick one published post, have Claude write 3 short
// English snippet options grounded ONLY in that post's text (no invented
// facts), then Telegram them to the owner (Korean wrapper) for copy-paste.
// State in data/threads-daily.json avoids repeats until the backlog cycles.
// Without TELEGRAM_* env (local runs) it prints the message instead of sending.
import './lib/env.mjs';
import Anthropic from '@anthropic-ai/sdk';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';

const POSTS_DIR = 'src/content/posts';
const STATE_FILE = 'data/threads-daily.json';
const SITE = 'https://wanderatlasguides.com';
const MODEL = process.env.WRITER_MODEL || 'claude-sonnet-5';

const state = (() => {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return { used: [] }; }
})();

// -------- pick an unused, published post --------
const files = readdirSync(POSTS_DIR).filter(f => f.endsWith('.md'));
const candidates = [];
for (const f of files) {
  const raw = readFileSync(join(POSTS_DIR, f), 'utf8');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) continue;
  let fm;
  try { fm = yaml.load(m[1]); } catch { continue; }
  if (fm?.draft) continue;
  const slug = f.replace(/\.md$/, '');
  if (state.used.includes(slug)) continue;
  candidates.push({ slug, fm, body: m[2] });
}
if (!candidates.length) { state.used = []; console.log('backlog cycled — resetting'); }
const pool = candidates.length ? candidates : files.map(f => {
  const raw = readFileSync(join(POSTS_DIR, f), 'utf8');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  return m ? { slug: f.replace(/\.md$/, ''), fm: yaml.load(m[1]), body: m[2] } : null;
}).filter(p => p && !p.fm?.draft);
const post = pool[Math.floor(Math.random() * pool.length)];
const { title, country, region, description } = post.fm;
console.log(`post: ${post.slug}`);

// -------- write snippets (grounded in the post only) --------
const client = new Anthropic();
const prompt = `You write Threads (Meta) posts for Wander Atlas, a travel guide site.
Below is one published article. Write EXACTLY 3 alternative Threads post options in ENGLISH, using ONLY facts that appear in the article — never invent names, numbers, times, or claims.

Rules:
- Option A "TIP": one practical, specific traveler tip from the article.
- Option B "HOOK": an intriguing detail/atmosphere hook that makes people curious about the place.
- Option C "QUESTION": an engaging question to readers, seeded with a detail from the article.
- Each option: 1-3 short sentences, under 260 characters, no hashtags, no links, no emoji spam (0-1 emoji ok), casual-but-informed tone.
- After each English option, add one short Korean line translating/summarizing it (prefix "KO:").

ARTICLE TITLE: ${title}
LOCATION: ${region}, ${country}
SUMMARY: ${description}
BODY:
${post.body.slice(0, 4500)}

Respond in exactly this format:
A: <english>
KO: <korean>
B: <english>
KO: <korean>
C: <english>
KO: <korean>`;

let snippets;
try {
  const msg = await client.messages.create({
    model: MODEL, max_tokens: 700,
    messages: [{ role: 'user', content: prompt }],
  });
  snippets = msg.content[0].text.trim();
} catch (e) {
  console.error('writer failed, falling back to description:', e.message);
  snippets = `A: ${description}\nKO: (자동 문구 생성 실패 — 글 요약을 그대로 실었습니다)`;
}

// -------- compose Korean telegram message --------
const text = [
  `🧵 오늘의 스레드 소재 — ${title}`,
  `📍 ${region}, ${country}`,
  '',
  snippets,
  '',
  `🔗 원문: ${SITE}/posts/${post.slug}/`,
  '사용법: 마음에 드는 옵션 하나를 복사해 스레드에 붙여넣으세요. 링크는 매번 붙이지 말고 가끔만(새 계정 스팸 신호 방지).',
].join('\n');

// -------- send (or print locally) --------
const tok = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
if (tok && chat) {
  const r = await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
  });
  if (!r.ok) { console.error('telegram send failed', r.status, await r.text()); process.exit(1); }
  console.log('telegram sent');
} else {
  console.log('--- (no telegram env — preview) ---\n' + text);
}

// -------- persist state --------
state.used.push(post.slug);
mkdirSync('data', { recursive: true });
writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
console.log(`state saved (${state.used.length} used)`);
