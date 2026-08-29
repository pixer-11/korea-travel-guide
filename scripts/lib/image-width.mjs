// ─────────────────────────────────────────────────────────────
//  TRUE PIXEL WIDTH of an image URL. Extracted from upgrade-hero-width.mjs so
//  the nightly width scan can import it without tripping that script's
//  SLUGS-required guard (importing a module runs its top level).
//  Wikimedia originals go through the imageinfo API (authoritative, no
//  download); everything else range-fetches the first 128KB and parses the
//  JPEG SOF / PNG IHDR header. null = unknown, and unknown is treated as
//  "not proven wide enough" by every caller.
// ─────────────────────────────────────────────────────────────

const UA = { 'User-Agent': 'WanderAtlasBot/1.0 (https://wanderatlasguides.com)' };

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
    const res = await fetch(url, { headers: { ...UA, Range: 'bytes=0-131071' } });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return parseImageWidth(Buffer.from(ab.slice(0, 131072)));
  } catch {
    return null;
  }
}
