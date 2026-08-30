// ─────────────────────────────────────────────────────────────
//  TRUE PIXEL WIDTH of an image URL. Extracted from upgrade-hero-width.mjs so
//  the nightly width scan can import it without tripping that script's
//  SLUGS-required guard (importing a module runs its top level).
//  Wikimedia originals go through the imageinfo API (authoritative, no
//  download); everything else range-fetches the first 128KB and parses the
//  JPEG SOF / PNG IHDR header. null = unknown, and unknown is treated as
//  "not proven wide enough" by every caller — but NOT as a verdict on the
//  photo (see widthVerdict below).
// ─────────────────────────────────────────────────────────────
import { imageFetch, IMAGE_UA } from './image-fetch.mjs';

const UA = { 'User-Agent': IMAGE_UA };

// A width we MEASURED is a fact about the photo; a width we could not measure
// is a fact about the network. Callers used to record both as the same
// permanent MISMATCH verdict, so a Flickr 502 became "this photo is wrong for
// this post" forever — 24 entries on 2026-08-30, 20 of them photos that open
// fine once imageFetch tries the other UA. Only a measured shortfall is a
// verdict; unknown is a retry.
export function widthVerdict(trueW, needW) {
  if (!trueW) return { ok: false, permanent: false, reason: `width: unknown (<${needW}) — could not measure` };
  if (trueW < needW) return { ok: false, permanent: true, reason: `width: ${trueW}px < ${needW}` };
  return { ok: true, permanent: false, reason: '' };
}

// Below this true pixel width a hero is a smear, not a photograph — the
// nightly width check quarantines it. Lives here (not in scan-hero-widths)
// so ATTACH paths can enforce the same floor they will later be judged by:
// on 2026-08-29 the alt-source backfill attached 474px and 500px act photos
// and the very same run quarantined both. One constant, both directions.
export const UNUSABLE_WIDTH = 640;

export function parseImageWidth(buf) {
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50) return buf.readUInt32BE(16); // PNG IHDR
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) { // JPEG: scan for SOFn
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if (len < 2) return null;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return buf.readUInt16BE(i + 7); // SOF: len(2) precision(1) height(2) width(2)
      }
      i += 2 + len;
    }
  }
  return null;
}

export async function probeWidth(url) {
  try {
    if (/upload\.wikimedia\.org/.test(url)) {
      const thumb = url.match(/\/thumb\/.*?\/(\d+)px-[^/]+$/);
      if (thumb) return Number(thumb[1]);
      const file = decodeURIComponent(String(url).split('/').pop() || '');
      const q = new URLSearchParams({
        action: 'query', titles: `File:${file}`, prop: 'imageinfo', iiprop: 'size', format: 'json',
      });
      const res = await fetch(`https://commons.wikimedia.org/w/api.php?${q}`, { headers: UA });
      if (!res.ok) return null;
      const j = await res.json();
      const ii = Object.values(j?.query?.pages || {})[0]?.imageinfo?.[0];
      return ii?.width ?? null;
    }
    const res = await imageFetch(url, { headers: { Range: 'bytes=0-131071' } });
    if (res.ok) {
      const ab = await res.arrayBuffer();
      return parseImageWidth(Buffer.from(ab.slice(0, 131072)));
    }
    // A host that refuses the ranged request may still serve a plain GET, so
    // read only the head of the stream before cancelling — same bytes, one
    // more round trip, no full download. (On 2026-08-29 this was blamed for
    // Flickr's 502s; the real cause was the User-Agent, which imageFetch now
    // walks. The rung stays: it is cheap and it costs nothing when unused.)
    const full = await imageFetch(url);
    if (!full.ok || !full.body) return null;
    const reader = full.body.getReader();
    const chunks = [];
    let got = 0;
    while (got < 131072) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      got += value.length;
    }
    reader.cancel().catch(() => {});
    return parseImageWidth(Buffer.concat(chunks).slice(0, 131072));
  } catch {
    return null;
  }
}

// Flickr serves fixed sizes by suffix (_b=1024, _h=1600, _k=2048) and
// Openverse hands out _b — which fails a 1200 floor by construction. Try the
// larger rungs first and keep the first that proves wide enough; old photos
// without _h/_k simply fall back to the URL given. Same lesson as the
// Wikimedia thumbnail ladder: hosts only serve the widths they serve.
export async function upsizeFlickr(url, minWidth) {
  if (!/live\.staticflickr\.com/.test(url) || !/_b\.jpe?g$/i.test(url)) return url;
  for (const suf of ['_k.jpg', '_h.jpg']) {
    const cand = url.replace(/_b\.jpe?g$/i, suf);
    const w = await probeWidth(cand);
    if (w && w >= minWidth) return cand;
  }
  return url;
}
