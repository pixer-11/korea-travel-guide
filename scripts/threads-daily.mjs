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
import { commonsCandidates } from './lib/commons.mjs';
import { venuePhotoCandidates } from './lib/photo-sources.mjs';
import { verifyGalleryImage } from './lib/vision-check.mjs';

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
// `--slug=x` picks one post instead of drawing at random. The carousel bugs are
// only visible in the finished image, and re-rolling the dice hoping to land on
// the broken post again is no way to check a fix.
// Read from disk, not from `pool` — the pool excludes posts already used, and a
// post you want to re-check is by definition one that already went out.
const wanted = (process.argv.find((a) => a.startsWith('--slug=')) || '').slice(7);
let forced = null;
if (wanted && files.includes(`${wanted}.md`)) {
  const m = readFileSync(join(POSTS_DIR, `${wanted}.md`), 'utf8')
    .match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (m) forced = { slug: wanted, fm: yaml.load(m[1]), body: m[2] };
}
if (wanted && !forced) { console.error(`--slug=${wanted} not found among published posts`); process.exit(1); }
const post = forced || pool[Math.floor(Math.random() * pool.length)];
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
    // Heroes are stored as 1920px-wide Wikimedia thumbnails, sized for an article
    // where they run wide and short. This card is 1080x1350 PORTRAIT, so a
    // landscape hero gets scaled up on the height axis and lands soft. Wikimedia
    // renders any width on request, so ask for one that survives the crop.
    // Commons refuses to upscale: ask for 2600px on a 2000px original and it
    // answers 400, which cost this run its card entirely. So try big, keep the
    // stored URL as the fallback.
    const bigUrl = heroUrl.replace(/\/(\d{3,4})px-/, (m, w) => (Number(w) < 2600 ? '/2600px-' : m));
    const UAH = { 'User-Agent': 'WanderAtlasBot/1.0 (https://wanderatlasguides.com)' };
    let res = await fetch(bigUrl, { headers: UAH });
    if (!res.ok && bigUrl !== heroUrl) res = await fetch(heroUrl, { headers: UAH });
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
    igImage = await sharp(base).composite([{ input: Buffer.from(overlay) }]).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
  }
} catch (e) { console.error('ig image compose failed (텍스트만 발송):', e.message); }

// -------- carousel: extra REAL photos of the same place + a closing brand card --------
// Posts carry only a hero (465 of 480 have an empty gallery), so the extra slides
// are sourced here, at material time, and put through the same vision gate the
// site uses. Anything that fails simply doesn't become a slide — a 2-slide
// carousel is fine, a wrong photo is not.
const IG_W = 1080, IG_H = 1350;
const fetchBuf = async (u) => {
  const r = await fetch(u, { headers: { 'User-Agent': 'WanderAtlasBot/1.0 (https://wanderatlasguides.com)' } });
  if (!r.ok) throw new Error(`fetch ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
};

// Small corner pin so a reposted slide still carries the brand, without putting
// text over the photo (the owner asked for the photos themselves to shine).
const CORNER_PIN = `<svg xmlns="http://www.w3.org/2000/svg" width="${IG_W}" height="${IG_H}">
  <g transform="translate(${IG_W - 104},${IG_H - 116}) scale(2.0)" opacity="0.92">
    <path fill="#c8443a" d="M16 2.6 A 10.8 10.8 0 0 1 26.8 13.4 C 26.8 19.3 21.9 23.2 16 30.2 C 10.1 23.2 5.2 19.3 5.2 13.4 A 10.8 10.8 0 0 1 16 2.6 Z"/>
    <circle cx="16" cy="13.4" r="7.7" fill="#e8a13c"/><circle cx="16" cy="13.4" r="6.6" fill="#f6f1e6"/>
    <path fill="#c8443a" d="M16 8.6 L17 12.4 L20.8 13.4 L17 14.4 L16 18.2 L15 14.4 L11.2 13.4 L15 12.4 Z"/>
  </g></svg>`;

// Slide 1 is the post's hero, which is chosen to head an article rather than to
// open a carousel: "Chicago from under the Cloud Gate" is a fine article image
// and a poor first slide, because the sculpture is not in it. Nothing here can
// fix that — it is the hero pipeline's job — but the extra slides must at least
// not repeat the failure.
const slides = [];      // { buf, credit }
const slideCredits = [];
if (igImage) { slides.push(igImage); if (post.fm.heroImage?.credit) slideCredits.push(post.fm.heroImage.credit); }

try {
  const heroUrl = post.fm.heroImage?.url || '';
  // place.name is whatever the maps lookup returned, which is sometimes the
  // STREET rather than the place: Cheongsapo village came back "Cheongsapo-ro",
  // and searching a road name for photos found nothing. The title names the
  // place, so fall back to it whenever place.name looks like an address.
  const titleName = String(title).split(/[:—]/)[0].trim();
  const rawName = post.fm.place?.name || '';
  // Only when the name ENDS in a road word. An earlier, looser test also caught
  // "Daegu 83 Tower" and "CHAI OF THE TIGER (Indian Street Food)", which are the
  // actual names of the places.
  const looksLikeStreet = /(-(ro|gil|daero)|\b(street|road|avenue|lane|boulevard))\s*$/i.test(rawName);
  const venueName = !rawName || looksLikeStreet ? titleName : rawName;
  const cands = [];
  // Landmarks/areas: Commons usually has several free shots of the same subject.
  // Featured/quality-assessed Commons files first: when the pool has a shot the
  // Wikimedia community itself flagged as excellent, it should lead.
  const rank = (arr) => arr.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
  const at = post.fm.place?.lat && post.fm.place?.lng
    ? { lat: post.fm.place.lat, lng: post.fm.place.lng } : null;
  for (const c of rank(await commonsCandidates(`${venueName} ${region}`, 8, venueName, at))) {
    cands.push({ url: c.url, credit: c.credit });
  }
  // Venues: the same Foursquare/Flickr sources the site's photo pipeline uses.
  if (cands.length < 3) {
    for (const c of await venuePhotoCandidates({
      name: venueName, lat: post.fm.place?.lat, lng: post.fm.place?.lng,
      near: `${region}, ${country}`,
    })) cands.push({ url: c.url, credit: c.credit });
  }

  const seen = new Set([heroUrl]);
  for (const c of cands) {
    // Owner's spec (2026-07-31): 2-3 place photos + the closing name card.
    // The title card is place photo #1, so up to two more real shots join it —
    // a tighter set reads better than five slides of diminishing quality.
    if (slides.length >= 3) break;           // 3 place photos + name card = 4 slides
    if (!c.url || seen.has(c.url)) continue;
    seen.add(c.url);
    let v;
    try {
      v = await verifyGalleryImage({
        url: c.url, heroUrl, name: venueName,
        category: post.fm.category, region, country,
      });
    } catch { continue; }
    if (!v?.ok) continue;
    try {
      const buf = await sharp(await fetchBuf(c.url))
        .resize(IG_W, IG_H, { fit: 'cover', position: 'attention' })
        .composite([{ input: Buffer.from(CORNER_PIN) }])
        .jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
      slides.push(buf);
      if (c.credit) slideCredits.push(c.credit);
    } catch { /* skip unreadable image */ }
  }
} catch (e) { console.error('carousel photos skipped:', e.message); }

// Closing brand card — always last, even when no extra photo was found.
let brandCard = null;
try {
  const card = `<svg xmlns="http://www.w3.org/2000/svg" width="${IG_W}" height="${IG_H}">
    <rect width="${IG_W}" height="${IG_H}" fill="#f7f3ec"/>
    <rect x="40" y="40" width="${IG_W - 80}" height="${IG_H - 80}" fill="none" stroke="#b8862f" stroke-width="3"/>
    <g transform="translate(${IG_W / 2 - 96},300) scale(6)">
      <path fill="#c8443a" d="M16 2.6 A 10.8 10.8 0 0 1 26.8 13.4 C 26.8 19.3 21.9 23.2 16 30.2 C 10.1 23.2 5.2 19.3 5.2 13.4 A 10.8 10.8 0 0 1 16 2.6 Z"/>
      <circle cx="16" cy="13.4" r="7.7" fill="#e8a13c"/><circle cx="16" cy="13.4" r="6.6" fill="#f6f1e6"/>
      <path fill="#c8443a" d="M16 8.6 L17 12.4 L20.8 13.4 L17 14.4 L16 18.2 L15 14.4 L11.2 13.4 L15 12.4 Z"/>
    </g>
    <text x="${IG_W / 2}" y="720" text-anchor="middle" font-family="DejaVu Serif, serif" font-size="84" font-weight="700" fill="#201c17">Wander Atlas</text>
    <text x="${IG_W / 2}" y="800" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="30" font-weight="600" fill="#b8862f" letter-spacing="6">GUIDES TO THE WORLD</text>
    <text x="${IG_W / 2}" y="912" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="38" fill="#4a443b">Editor-reviewed guides ·  real photos</text>
    <text x="${IG_W / 2}" y="968" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="38" fill="#4a443b">Opening hours, quiet times, live fares</text>
    <text x="${IG_W / 2}" y="1150" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="44" font-weight="600" fill="#c8443a">wanderatlasguides.com</text>
  </svg>`;
  brandCard = await sharp(Buffer.from(card)).jpeg({ quality: 92 }).toBuffer();
  slides.push(brandCard);
} catch (e) { console.error('brand card failed:', e.message); }

// -------- messages --------
// Every CC-BY/BY-SA slide must carry its photographer, so the caption lists all
// of them — Instagram has no per-image credit field.
const credit = slideCredits.length
  ? '\n📷 ' + [...new Set(slideCredits)].join('\n📷 ')
  : (post.fm.heroImage?.credit ? `\n📷 ${post.fm.heroImage.credit}` : '');
const photoCount = Math.max(slides.length - (brandCard ? 1 : 0), 0);
const igText = [
  `📸 인스타 카드뉴스 — 사진 ${slides.length}장 (장소 ${photoCount}장 + 마지막 소개 카드)`,
  `순서대로 저장해서 여러 장 올리기 → 아래 캡션 복사`,
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
  '사용법: 인스타·스레드 모두 위 사진 세트를 순서대로 전부 첨부하세요 (장소 사진 2~3장 + 마지막 네임카드). 스레드는 옵션 하나를 골라 글로, 인스타는 IG 캡션을 쓰면 됩니다. 게시는 주 2~3회면 충분합니다.',
].join('\n');

// -------- send (or preview locally) --------
const tok = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
if (tok && chat) {
  if (slides.length > 1) {
    // Album, so the slides arrive in carousel order and can be saved in sequence.
    const form = new FormData();
    form.append('chat_id', chat);
    form.append('media', JSON.stringify(slides.map((_, i) => ({
      type: 'photo', media: `attach://s${i}`,
      ...(i === 0 ? { caption: igText } : {}),   // caption rides the first item
    }))));
    slides.forEach((b, i) => form.append(`s${i}`, new Blob([b], { type: 'image/jpeg' }), `s${i}.jpg`));
    const rp = await fetch(`https://api.telegram.org/bot${tok}/sendMediaGroup`, { method: 'POST', body: form });
    if (!rp.ok) console.error('telegram album failed', rp.status, await rp.text());
    else console.log(`telegram album sent (${slides.length} slides)`);
  } else if (slides.length === 1) {
    const form = new FormData();
    form.append('chat_id', chat);
    form.append('caption', igText);
    form.append('photo', new Blob([slides[0]], { type: 'image/jpeg' }), 'ig.jpg');
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
  if (slides.length) {
    const { tmpdir } = await import('os');
    slides.forEach((b, i) => {
      const p = join(tmpdir(), `ig-slide-${i + 1}.jpg`);
      writeFileSync(p, b);
      console.log(`preview slide ${i + 1}/${slides.length} → ${p}`);
    });
  }
  console.log('--- (no telegram env — preview) ---\n' + igText + '\n\n' + thText);
}

// -------- persist state --------
state.used.push(post.slug);
mkdirSync('data', { recursive: true });
writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
console.log(`state saved (${state.used.length} used)`);
