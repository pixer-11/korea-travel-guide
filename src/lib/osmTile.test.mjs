import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tileXY, tileMosaic, TILE } from './osmTile.mjs';

test('tile maths matches the slippy-map reference points', () => {
  // Null Island at z=1 is the corner shared by all four tiles.
  assert.deepEqual(tileXY(0, 0, 1), { x: 1, y: 1 });
  // Greenwich-ish: lng 0 → x exactly half the world at any zoom.
  assert.equal(tileXY(51.5, 0, 10).x, 512);
  // Chicago, z=15, worked by hand: x = (−87.65+180)/360 × 32768 = 8405.9;
  // y = (1 − ln(tan φ + sec φ)/π)/2 × 32768 = 12182.4.
  const chi = tileXY(41.85, -87.65, 15);
  assert.equal(Math.floor(chi.x), 8405);
  assert.equal(Math.floor(chi.y), 12182);
});

test('a 2×2 mosaic keeps the point near its centre and reports the pixel position', () => {
  const m = tileMosaic(41.85, -87.65, { z: 15 });
  assert.equal(m.tiles.length, 4);
  assert.equal(m.width, 2 * TILE);
  // The point lies inside the middle half of the mosaic on both axes.
  assert.ok(m.px >= TILE / 2 && m.px <= TILE * 1.5, `px ${m.px}`);
  assert.ok(m.py >= TILE / 2 && m.py <= TILE * 1.5, `py ${m.py}`);
  // Tiles are laid out in reading order with 256px origins.
  assert.deepEqual(m.tiles.map((t) => [t.dx, t.dy]), [[0, 0], [256, 0], [0, 256], [256, 256]]);
  // Esri path is /{z}/{y}/{x} — y first. A regression to x-first would render
  // a map of the wrong place, which no 200 response would ever reveal.
  assert.ok(m.tiles.every((t) => /^https:\/\/services\.arcgisonline\.com\/ArcGIS\/rest\/services\/Canvas\/World_Light_Gray_Base\/MapServer\/tile\/15\/\d+\/\d+$/.test(t.url)), m.tiles[0].url);
});

test('tiles wrap at the antimeridian and never go outside the world vertically', () => {
  const m = tileMosaic(0, 179.999, { z: 3 });
  assert.ok(m.tiles.every((t) => t.x >= 0 && t.x < 8));
  const polar = tileMosaic(84.9, 0, { z: 1 });
  assert.ok(polar.tiles.every((t) => t.y >= 0 && t.y < 2));
});

test('bad coordinates yield null (the caller renders no map)', () => {
  assert.equal(tileMosaic(NaN, 10), null);
  assert.equal(tileMosaic(91, 10), null);
  assert.equal(tileMosaic(10, 181), null);
  assert.equal(tileMosaic(undefined, undefined), null);
});

test('Esri 타일 경로는 z/y/x 순서다 — x/y로 돌아가면 엉뚱한 지도가 뜬다', async () => {
  const { tileUrl } = await import('./osmTile.mjs');
  assert.ok(tileUrl(15, 26838, 12852).endsWith('/15/12852/26838'));
});
