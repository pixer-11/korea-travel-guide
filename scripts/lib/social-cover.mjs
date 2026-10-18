// The first slide of the daily Threads/Instagram carousel, and the film grade
// every slide gets.
//
// Modelled on the 19 reference covers the owner sent on 2026-10-18 (a Japan
// travel account on Threads): one centred title in a display face, small labels
// around it, the subject standing IN FRONT of the title where the photo allows,
// and a soft film grade. What varies from post to post (seeded by the slug, so
// the same post always gets the same cover): template, typeface, title height,
// label wording.
//
// "In front of the title" uses a depth model (Depth Anything v2 small, run
// locally through transformers.js — no API, no cost). It is installed only in
// the threads-daily job; anywhere it is missing the cover is drawn without the
// occlusion, which is also what happens whenever the occlusion would eat the
// first or last letter or more than ~a quarter of the word.
//
// Nothing here may state a fact the post does not: the meta row carries the
// post's own region, country and stored coordinates, and the labels are
// generic ("spot to see", "sapa edition"). The reference account's "shot on
// Fujifilm XT5" is exactly the kind of line we cannot write.
import sharp from 'sharp';
import { Resvg } from '@resvg/resvg-js';
import { fileURLToPath } from 'node:url';

export const W = 1080, H = 1350;
const FONT_DIR = fileURLToPath(new URL('../assets/cover-fonts/', import.meta.url));
const FONT_FILES = ['YoungSerif.ttf', 'Playfair.ttf', 'KronaOne.ttf', 'ArchivoBlack.ttf', 'Inter.ttf'].map((f) => FONT_DIR + f);
const SANS = 'Inter';
const MARGIN = 70;

const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const pick = (arr, seed, salt) => arr[hash(String(seed) + salt) % arr.length];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${inner}</svg>`;
const rsvg = (s) => new Resvg(s, { font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: SANS } });
const png = (s) => Buffer.from(rsvg(s).render().asPng());
export const widthOf = (s) => rsvg(s).getBBox()?.width ?? 0;

// ---------- film grade (every photo slide) ----------
let GRAIN;
export async function grade(buf) {
  const base = await sharp(buf).resize(W, H, { fit: 'cover', position: 'attention' })
    .modulate({ saturation: 0.9 })
    // lifted blacks and softened whites; blue raised in the shadows and cut in
    // the highlights reads as warm film
    .linear([0.9, 0.89, 0.85], [16, 15, 20])
    .toBuffer();
  if (!GRAIN) {
    const n = Buffer.alloc(W * H);
    let x = 0x9e3779b9;   // fixed seed: the same photo grades the same way twice
    const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
    for (let i = 0; i < n.length; i++) n[i] = Math.max(0, Math.min(255, 128 + (rnd() + rnd() + rnd() - 1.5) * 34));
    GRAIN = await sharp(n, { raw: { width: W, height: H, channels: 1 } }).png().toBuffer();
  }
  const vignette = svg(`<defs><radialGradient id="v" cx="50%" cy="48%" r="75%"><stop offset="55%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.32"/></radialGradient></defs><rect width="${W}" height="${H}" fill="url(#v)"/>`);
  return sharp(base).composite([{ input: GRAIN, blend: 'soft-light' }, { input: png(vignette) }]).toBuffer();
}

// ---------- depth (optional) ----------
let depthPipe = null, depthTried = false;
async function depthMap(buf) {
  if (!depthTried) {
    depthTried = true;
    try {
      const { pipeline, env } = await import('@huggingface/transformers');
      if (process.env.HF_CACHE_DIR) env.cacheDir = process.env.HF_CACHE_DIR;
      depthPipe = await pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', { dtype: 'q8' });
    } catch (e) { console.log(`  cover: depth model unavailable (${String(e.message).slice(0, 80)}) — titles without occlusion`); }
  }
  if (!depthPipe) return null;
  const { RawImage } = await import('@huggingface/transformers');
  const img = await RawImage.fromBlob(new Blob([await sharp(buf).png().toBuffer()]));
  const { depth } = await depthPipe(img);
  return sharp(Buffer.from(depth.data), { raw: { width: depth.width, height: depth.height, channels: 1 } })
    .resize(W, H, { fit: 'fill' }).extractChannel(0).raw().toBuffer();
}

// ---------- layout ----------
const TITLE_FONTS = {
  soft: { family: 'Young Serif', track: -1, max: 170 },        // Mt.Fuji / Sakura / Kamakura
  didone: { family: 'Playfair Display', track: -2, max: 190 }, // Tokyo / Autumn Diaries
  wide: { family: 'Krona One', track: -2, max: 150 },          // Osaka
  grotesk: { family: 'Archivo Black', track: -3, max: 150 },   // Uji station / Bon-Chan
};
const TEMPLATES = [
  { key: 'sides', fonts: ['soft', 'soft', 'didone'], w: 3 },
  { key: 'kicker', fonts: ['soft', 'grotesk', 'didone'], w: 3 },
  { key: 'didone', fonts: ['didone'], w: 2 },
  { key: 'wide', fonts: ['wide'], w: 1 },
];

const titleEl = ({ text, font, size, y }) => {
  const f = TITLE_FONTS[font];
  return `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${f.family}" font-size="${size}" letter-spacing="${f.track}" fill="#fffdf7">${esc(text)}</text>`;
};
const small = (x, y, t, { size = 26, anchor = 'middle', fam = SANS, caps = false, track = 0, italic = false } = {}) =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${fam}" font-size="${size}"${italic ? ' font-style="italic"' : ''} letter-spacing="${track}" fill="#fffdf7">${esc(caps ? t.toUpperCase() : t)}</text>`;

function fitSize(text, font, maxW) {
  const w = widthOf(svg(titleEl({ text, font, size: 100, y: 500 })));
  return Math.min(TITLE_FONTS[font].max, Math.floor(100 * maxW / Math.max(1, w)));
}

export function design({ title, region, country, lat, lng, seed }) {
  const total = TEMPLATES.reduce((a, t) => a + t.w, 0);
  let r = hash(seed) % total, tpl = TEMPLATES[0];
  for (const t of TEMPLATES) { if (r < t.w) { tpl = t; break; } r -= t.w; }
  const font = pick(tpl.fonts, seed, 'f');
  const reg = region.toLowerCase(), ctry = country.toLowerCase();
  const inTitle = title.toLowerCase().includes(reg);
  const left = pick(['spot to see', 'fave spot to see', 'worth the trip', 'one day in'], seed, 'l');
  const right = inTitle ? `${ctry} edition` : pick([`${reg} edition`, `the city of ${region}`, `${ctry} diaries`], seed, 'r');
  // The title is centred, so each side needs room for the LONGER label.
  const sideRoom = tpl.key === 'sides'
    ? 2 * Math.max(widthOf(svg(small(300, 500, left, { size: 25 }))), widthOf(svg(small(300, 500, right, { size: 25 })))) + 2 * 26
    : 0;
  const size = fitSize(title, font, W - 2 * MARGIN - sideRoom);
  const meta = (y) => {
    const ll = Number.isFinite(lat) && Number.isFinite(lng)
      ? `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lng).toFixed(4)}°${lng >= 0 ? 'E' : 'W'}` : '';
    return small(MARGIN + 40, y, 'WANDER ATLAS', { size: 17, anchor: 'start', track: 1.5 }) +
      small(W / 2, ll ? y - 22 : y, `${region}, ${country}`, { size: 17, caps: true, track: 1.5 }) +
      (ll ? small(W / 2, y, ll, { size: 17, track: 1 }) : '') +
      small(W - MARGIN - 40, y, 'EDITOR-REVIEWED GUIDE', { size: 17, anchor: 'end', track: 1.5 });
  };
  return {
    tpl: tpl.key, font, size,
    at(y) {
      const t = titleEl({ text: title, font, size, y });
      let labels = '';
      if (tpl.key === 'sides') {
        const half = widthOf(svg(t)) / 2;
        labels = small(W / 2 - half - 26, y - size * 0.12, left, { anchor: 'end', size: 25 }) +
          small(W / 2 + half + 26, y - size * 0.12, right, { anchor: 'start', size: 25 });
      } else if (tpl.key === 'kicker') {
        const k = pick(['a glimpse of', 'the stories of', 'a slow day at', 'a quiet hour at'], seed, 'k');
        const serifK = font !== 'grotesk';
        labels = small(W / 2, y - size * 0.86, k, { size: serifK ? 40 : 34, fam: serifK ? 'Playfair Display' : SANS, italic: !serifK }) +
          small(W / 2, y + 46, pick([`${reg} diaries`, `${ctry} edition`, 'spot to see'], seed, 'b'), { size: 28 }) + meta(H - 70);
      } else if (tpl.key === 'didone') {
        labels = small(W / 2, y - size * 0.78, `moments in ${reg}`, { size: 40, fam: 'Playfair Display' }) + meta(H - 70);
      } else {
        labels = small(W / 2, H - 300, `${reg}, ${ctry}`, { size: 24 });
      }
      return { title: svg(t), labels: svg(labels) };
    },
  };
}

// Where the depth map says something nearer than the title's backdrop sits in
// front of the MIDDLE of the word, and hides 5-28% of it, let it. A lost first
// or last letter reads as a typo, so any occlusion near the ends disqualifies
// that height. Depth is relative and its scale differs per photo (0-75 on one,
// 0-255 on another), so thresholds are taken from the pixels under the word.
async function placeTitle(d, depth) {
  let gmax = 0;
  if (depth) for (let i = 0; i < depth.length; i += 7) if (depth[i] > gmax) gmax = depth[i];
  let best = null;
  for (let y = Math.round(H * 0.2); y <= Math.round(H * 0.66); y += 24) {
    const L = d.at(y);
    const tp = png(L.title);
    let okOcc = false, T = 256, r = 0;
    if (depth) {
      const { data: a } = await sharp(tp).extractChannel(3).raw().toBuffer({ resolveWithObject: true });
      const ds = [], xs = [];
      let x0 = W, x1 = 0;
      for (let i = 0; i < a.length; i += 2) if (a[i] > 128) { const x = i % W; ds.push(depth[i]); xs.push(x); if (x < x0) x0 = x; if (x > x1) x1 = x; }
      if (ds.length >= 400) {
        const sorted = [...ds].sort((p, q) => p - q);
        const far = sorted[Math.floor(ds.length * 0.1)], near = sorted[Math.floor(ds.length * 0.97)];
        T = near - far >= 0.12 * gmax ? far + (near - far) * 0.55 : 256;
        const edge = (x1 - x0) * 0.16;
        let hid = 0, hidEdge = 0;
        for (let j = 0; j < ds.length; j++) if (ds[j] > T) { hid++; if (xs[j] < x0 + edge || xs[j] > x1 - edge) hidEdge++; }
        r = hid / ds.length;
        okOcc = hidEdge / ds.length <= 0.004 && r >= 0.05 && r <= 0.28;
      }
    }
    const score = (okOcc ? 1 - Math.abs(r - 0.15) * 2 : -0.2) - 0.5 * Math.abs(y - H * 0.44) / H;
    if (!best || score > best.score) best = { y, L, tp, T, r, score, okOcc };
  }
  if (!best.okOcc) best.T = 256;
  return best;
}

export async function socialCover(buf, info) {
  const base = await grade(buf);
  const depth = await depthMap(base).catch(() => null);
  const d = design(info);
  const best = await placeTitle(d, depth);
  let titleLayer = best.tp;
  if (best.T < 256) {
    const keep = Buffer.alloc(W * H);
    for (let i = 0; i < keep.length; i++) keep[i] = depth[i] > best.T ? 0 : 255;
    const soft = await sharp(keep, { raw: { width: W, height: H, channels: 1 } }).blur(1.3).extractChannel(0).raw().toBuffer();
    const rgba = await sharp(best.tp).ensureAlpha().raw().toBuffer();
    for (let i = 0; i < W * H; i++) rgba[i * 4 + 3] = Math.round(rgba[i * 4 + 3] * soft[i] / 255);
    titleLayer = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  }
  // A faint, wide shadow — enough to lift white type off a bright sky, never a band.
  const sh = await sharp(titleLayer).ensureAlpha().raw().toBuffer();
  for (let i = 0; i < sh.length; i += 4) { sh[i] = sh[i + 1] = sh[i + 2] = 0; sh[i + 3] = Math.round(sh[i + 3] * 0.22); }
  const shadow = await sharp(sh, { raw: { width: W, height: H, channels: 4 } }).blur(18).png().toBuffer();
  const out = await sharp(base).composite([{ input: shadow }, { input: titleLayer }, { input: png(best.L.labels) }])
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
  return { buf: out, meta: { template: d.tpl, font: d.font, y: best.y, occluded: best.T < 256, hidden: +best.r.toFixed(2) } };
}
