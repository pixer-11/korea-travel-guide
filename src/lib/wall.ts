import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Map a remote hero URL to the 640px WebP that build-wall.mjs already produced
// for it. Every published hero has one — 464 of 464 — averaging 40 KB, against
// the 1920px Wikimedia and w=1600 Unsplash originals the card grids were
// hotlinking: one city roundup shipped 3.49 MB of images to draw seven
// thumbnails at 325 CSS px.
//
// The helper existed inside BestTimeTool.astro and was used by that one
// component; every other card rendered the raw remote URL. Shared from here so a
// card grid cannot accidentally go back to the originals.
//
// Returns '' when no thumbnail exists (a hero published since the last wall
// build), so callers fall back to the remote URL rather than to a broken image.

const WALL_DIR = fileURLToPath(new URL('../../public/wall/', import.meta.url));

const wallHash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16);

// /wall/* is served `max-age=31536000, immutable` (public/_headers), and a
// re-cut thumbnail keeps its NAME (the name is how this file finds it). So
// when the crop changed — the 2026-08-22 exact-focus re-cut that finally put
// Bruno Mars' and Tyler's faces in the frame — every browser that had ever
// seen the card kept showing the old crop for a year; the owner saw the
// "fixed" cards still headless the next morning (2026-08-23) while the edge
// already held the new file. The crop key build-wall records in the sidecar
// becomes a query string, so a re-cut is a new URL and the old cache is
// simply never asked. The file name itself is unchanged (checkers parse it).
let cutWith: Record<string, string> = {};
try { cutWith = JSON.parse(readFileSync(WALL_DIR + '.cut-with.json', 'utf8')); } catch { cutWith = {}; }
const cutQuery = (name: string): string => {
  const key = cutWith[name];
  return key ? `?c=${key.replace(/[^a-z0-9]+/gi, '-')}` : '';
};

export function wallFor(heroUrl?: string | null): string {
  if (!heroUrl) return '';
  const name = `${wallHash(heroUrl)}.webp`;
  return existsSync(WALL_DIR + name) ? `/wall/${name}${cutQuery(name)}` : '';
}

/** The thumbnail when we have one, else the original — safe for any <img src>. */
export const thumbOr = (heroUrl?: string | null): string => wallFor(heroUrl) || heroUrl || '';
