#!/usr/bin/env node
// Build public/og-default.jpg — the share card for pages that have no photo of
// their own.
//
// 52% of built pages (2,529 of 4,869) shipped without an og:image: every region
// hub, every when-to-go page, essentials, destinations, events, itineraries and
// the static pages. Shared to KakaoTalk, LINE, X, Slack or Pinterest they render
// as a bare text link, which is the difference between a card someone taps and a
// line they scroll past — and it applies to exactly the page types the Pinterest
// and Instagram pipelines are meant to feed.
//
// Drawn from the site's own palette rather than a stock image, at the 1200×630
// every unfurler expects. Deterministic and dependency-light: one sharp call from
// an SVG, run in the build, no network.
//
//   node scripts/build-og-default.mjs

import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../public/og-default.jpg', import.meta.url));

// The palette, matching src/styles/global.css.
const BG = '#f7f3ec';
const INK = '#201c17';
const ACCENT = '#c8443a';
const MUTED = '#6b6155';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${BG}"/>

  <!-- The same contour lines the site uses as its page texture, so the card is
       recognisably from this site even before anyone reads the name. -->
  <g fill="none" stroke="${INK}" stroke-width="2" stroke-opacity="0.06">
    ${Array.from({ length: 9 }, (_, i) => {
      const y = 40 + i * 70;
      return `<path d="M0 ${y} q150 -34 300 0 t300 0 t300 0 t300 0"/>`;
    }).join('\n    ')}
  </g>

  <!-- Map pin: the brand mark. -->
  <g transform="translate(96,232) scale(2.6)">
    <path d="M16 2c-5.5 0-10 4.4-10 9.9 0 7.4 10 18.1 10 18.1s10-10.7 10-18.1C26 6.4 21.5 2 16 2z"
          fill="${ACCENT}"/>
    <circle cx="16" cy="12" r="3.6" fill="${BG}"/>
  </g>

  <text x="200" y="286" font-family="Georgia, 'Times New Roman', serif" font-size="76" font-weight="700" fill="${INK}">${esc('Wander Atlas')}</text>
  <text x="200" y="346" font-family="Helvetica, Arial, sans-serif" font-size="30" fill="${MUTED}">${esc('Verified travel guides — real places, real hours, real crowds')}</text>

  <rect x="200" y="392" width="120" height="5" rx="2.5" fill="${ACCENT}"/>
  <text x="200" y="452" font-family="Helvetica, Arial, sans-serif" font-size="24" fill="${MUTED}">wanderatlasguides.com</text>
</svg>`;

await mkdir(fileURLToPath(new URL('../public/', import.meta.url)), { recursive: true });
const info = await sharp(Buffer.from(svg)).jpeg({ quality: 86, mozjpeg: true }).toFile(OUT);
console.log(`📦 og-default.jpg — ${info.width}×${info.height}, ${Math.round(info.size / 1024)} KB`);
