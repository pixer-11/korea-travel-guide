// Daily social material: pick one published post, have Claude write (a) 3
// short Threads snippet options and (b) an Instagram caption — all grounded
// ONLY in that post's text (no invented facts) — plus compose a 1080×1350
// Instagram image (hero + scrim + title, pinterest-publish style). Everything
// is Telegrammed to the owner (Korean wrapper) for copy-paste during the
// account warm-up phase. State in data/threads-daily.json avoids repeats.
// Without TELEGRAM_* env (local runs) it prints/saves previews instead.
import './lib/env.mjs';
import Anthropic from '@anthropic-ai/sdk';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import sharp from 'sharp';

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

Finally add option IG: an Instagram caption for the same article — 2-3 engaging English sentences (grounded in the article only), then a line break, then 4-6 relevant hashtags (mix broad travel + specific place). No links. Under 500 characters.

Respond in exactly this format:
A: <english>
KO: <korean>
B: <english>
KO: <korean>
C: <english>
KO: <korean>
IG: <english caption with hashtags>`;

let snippets;
try {
  const msg = await client.messages.create({
    model: MODEL, max_tokens: 700,
    messages: [{ role: 'user', content: prompt }],
  });
  snippets = msg.content.find(b => b.type === 'text')?.text?.trim();
  if (!snippets) throw new Error('no text block in response');
} catch (e) {
  console.error('writer failed, falling back to description:', e.message);
  snippets = `A: ${description}\nKO: (자동 문구 생성 실패 — 글 요약을 그대로 실었습니다)\nIG: ${description}`;
}

// -------- split IG caption out of the response --------
const igMatch = snippets.match(/\nIG:\s*([\s\S]*)$/);
const igCaption = igMatch ? igMatch[1].trim() : '';
const threadsPart = igMatch ? snippets.slice(0, igMatch.index).trim() : snippets;

// -------- compose Instagram image (1080×1350, pinterest-publish style) --------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
function wrapTitle(t, maxChars = 22, maxLines = 3) {
  const words = String(t).split(/\s+/); const lines = []; let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length <= maxChars) cur = (cur + ' ' + w).trim();
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/.{2}$/, '') + '…'; }
  return lines;
}
let igImage = null;
try {
  let heroUrl = post.fm.heroImage?.url;
  if (heroUrl) {
    if (heroUrl.startsWith('/')) heroUrl = SITE + heroUrl;
    const res = await fetch(heroUrl, { headers: { 'User-Agent': 'WanderAtlasBot/1.0 (https://wanderatlasguides.com)' } });
    if (!res.ok) throw new Error(`hero fetch ${res.status}`);
    const heroBuf = Buffer.from(await res.arrayBuffer());
    const W = 1080, H = 1350;
    const base = await sharp(heroBuf).resize(W, H, { fit: 'cover', position: 'attention' }).toBuffer();
    const lines = wrapTitle(title.replace(/:.*$/, '')); // 짧은 제목만 (콜론 뒤 절삭)
    const lineH = 84;
    const textTop = H - 170 - lines.length * lineH;
    const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <defs><linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.82"/>
      </linearGradient></defs>
      <rect x="0" y="${textTop - 240}" width="${W}" height="${H - textTop + 240}" fill="url(#scrim)"/>
      <!-- 브랜드 핀 (좌상단) -->
      <g transform="translate(48,48) scale(2.1)">
        <path fill="#c8443a" d="M16 2.6 A 10.8 10.8 0 0 1 26.8 13.4 C 26.8 19.3 21.9 23.2 16 30.2 C 10.1 23.2 5.2 19.3 5.2 13.4 A 10.8 10.8 0 0 1 16 2.6 Z"/>
        <circle cx="16" cy="13.4" r="7.7" fill="#e8a13c"/><circle cx="16" cy="13.4" r="6.6" fill="#f6f1e6"/>
        <path fill="#c8443a" d="M16 8.6 L17 12.4 L20.8 13.4 L17 14.4 L16 18.2 L15 14.4 L11.2 13.4 L15 12.4 Z"/>
      </g>
      <text x="64" y="${textTop - 40}" font-family="DejaVu Sans, sans-serif" font-size="32" font-weight="600" fill="#f5d9a8" letter-spacing="4">${esc((region + ' · ' + country).toUpperCase())}</text>
      ${lines.map((l, i) => `<text x="64" y="${textTop + 34 + i * lineH}" font-family="DejaVu Serif, serif" font-size="70" font-weight="700" fill="#ffffff">${esc(l)}</text>`).join('\n')}
      <text x="64" y="${H - 56}" font-family="DejaVu Sans, sans-serif" font-size="32" fill="#e8e2d5">wanderatlasguides.com</text>
    </svg>`;
    igImage = await sharp(base).composite([{ input: Buffer.from(overlay) }]).jpeg({ quality: 88 }).toBuffer();
  }
} catch (e) { console.error('ig image compose failed (텍스트만 발송):', e.message); }

// -------- messages --------
const credit = post.fm.heroImage?.credit ? `\n📷 ${post.fm.heroImage.credit}` : '';
const igText = [
  `📸 인스타 소재 — 사진은 위 이미지 저장 후 업로드, 아래 캡션 복사`,
  '',
  igCaption || '(캡션 생성 실패 — 스레드 옵션 중 하나를 캡션으로 쓰세요)',
  credit,
].join('\n').slice(0, 1000);
const thText = [
  `🧵 오늘의 스레드 소재 — ${title}`,
  `📍 ${region}, ${country}`,
  '',
  threadsPart,
  '',
  `🔗 원문: ${SITE}/posts/${post.slug}/`,
  '사용법: 스레드는 옵션 하나 복사-붙여넣기(링크는 가끔만). 인스타는 위 사진+캡션 세트로. 인스타 게시는 주 2~3회면 충분합니다.',
].join('\n');

// -------- send (or preview locally) --------
const tok = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
if (tok && chat) {
  if (igImage) {
    const form = new FormData();
    form.append('chat_id', chat);
    form.append('caption', igText);
    form.append('photo', new Blob([igImage], { type: 'image/jpeg' }), 'ig.jpg');
    const rp = await fetch(`https://api.telegram.org/bot${tok}/sendPhoto`, { method: 'POST', body: form });
    if (!rp.ok) console.error('telegram photo failed', rp.status, await rp.text());
    else console.log('telegram photo sent');
  }
  const r = await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text: thText, disable_web_page_preview: true }),
  });
  if (!r.ok) { console.error('telegram send failed', r.status, await r.text()); process.exit(1); }
  console.log('telegram sent');
} else {
  if (igImage) {
    const { tmpdir } = await import('os');
    const p = join(tmpdir(), 'ig-preview.jpg');
    writeFileSync(p, igImage);
    console.log('preview image → ' + p);
  }
  console.log('--- (no telegram env — preview) ---\n' + igText + '\n\n' + thText);
}

// -------- persist state --------
state.used.push(post.slug);
mkdirSync('data', { recursive: true });
writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
console.log(`state saved (${state.used.length} used)`);
