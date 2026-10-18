// 스레드·인스타 첫 장 표지(lib/social-cover) — 2026-10-18 픽서님 참고 디자인.
//   node --test scripts/lib/social-cover.test.mjs
// 시안 2차에서 양옆 작은 글씨("the city of Naoshima")가 화면 밖으로 잘렸다.
// 제목은 가운데라 양쪽 모두 "긴 쪽 글씨" 만큼 비워야 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { Resvg } from '@resvg/resvg-js';
import { fileURLToPath } from 'node:url';
import { design, socialCover, grade, W, H } from './social-cover.mjs';

const FONT_DIR = fileURLToPath(new URL('../assets/cover-fonts/', import.meta.url));
const bbox = (svg) => new Resvg(svg, { font: { fontFiles: ['YoungSerif.ttf', 'Playfair.ttf', 'KronaOne.ttf', 'ArchivoBlack.ttf', 'Inter.ttf'].map((f) => FONT_DIR + f), loadSystemFonts: false } }).getBBox();

const CASES = [
  { title: 'Benesse House', region: 'Naoshima', country: 'Japan' },
  { title: 'Kurashiki Bikan Historical Quarter', region: 'Kurashiki', country: 'Japan' },
  { title: 'Mường Hoa Valley', region: 'Sapa', country: 'Vietnam' },
  { title: 'Ho Chi Minh City Museum of Fine Arts', region: 'Ho Chi Minh City', country: 'Vietnam' },
  { title: 'Gyeongbokgung', region: 'Seoul', country: 'South Korea' },
];

test('the same post always gets the same cover layout', () => {
  const a = design({ ...CASES[0], seed: 'naoshima-benesse-house-museum' });
  const b = design({ ...CASES[0], seed: 'naoshima-benesse-house-museum' });
  assert.deepEqual([a.tpl, a.font, a.size], [b.tpl, b.font, b.size]);
});

test('titles and labels stay inside the frame for every template', () => {
  for (const c of CASES) {
    for (let k = 0; k < 24; k++) {
      const d = design({ ...c, lat: 34.1, lng: 133.9, seed: `${c.title}-${k}` });
      const L = d.at(560);
      for (const part of [L.title, L.labels]) {
        const b = bbox(part);
        if (!b) continue;
        assert.ok(b.x >= 20 && b.x + b.width <= W - 20, `${c.title} [${d.tpl}/${d.font}] runs off the frame: x=${b.x.toFixed(0)} w=${b.width.toFixed(0)}`);
      }
    }
  }
});

test('the templates and typefaces actually vary across posts', () => {
  const seen = new Set();
  for (let k = 0; k < 40; k++) { const d = design({ ...CASES[0], seed: `slug-${k}` }); seen.add(`${d.tpl}/${d.font}`); }
  assert.ok(seen.size >= 5, `only ${seen.size} variants in 40 posts`);
});

test('without the depth model the cover is still drawn, full size', async () => {
  const photo = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: '#6b8fb3' } }).jpeg().toBuffer();
  const { buf, meta } = await socialCover(photo, { ...CASES[0], lat: 34.4452, lng: 133.9909, seed: 'x' });
  const m = await sharp(buf).metadata();
  assert.deepEqual([m.width, m.height, m.format], [W, H, 'jpeg']);
  assert.equal(meta.occluded, false);
});

test('the film grade keeps the frame and changes the pixels', async () => {
  const photo = await sharp({ create: { width: 1200, height: 1500, channels: 3, background: '#203040' } }).png().toBuffer();
  const g = await grade(photo);
  const m = await sharp(g).metadata();
  assert.deepEqual([m.width, m.height], [W, H]);
  const { data } = await sharp(g).raw().toBuffer({ resolveWithObject: true });
  // lifted blacks: a dark navy comes out lighter than it went in
  assert.ok(data[(H / 2 * W + W / 2) * 3] > 0x20);
});
