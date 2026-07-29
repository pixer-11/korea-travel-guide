import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
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

export function wallFor(heroUrl?: string | null): string {
  if (!heroUrl) return '';
  const name = `${wallHash(heroUrl)}.webp`;
  return existsSync(WALL_DIR + name) ? `/wall/${name}` : '';
}

/** The thumbnail when we have one, else the original — safe for any <img src>. */
export const thumbOr = (heroUrl?: string | null): string => wallFor(heroUrl) || heroUrl || '';
