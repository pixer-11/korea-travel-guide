import { test } from 'node:test';
import assert from 'node:assert/strict';
import { focusFromReply, cropWindowTop, focusKey, hasBox, focusYaml, spliceFocus } from './head-box.mjs';

test('focusYaml writes the point, and the box only when there is one', () => {
  assert.equal(focusYaml({ x: 50, y: 35 }), '  focus:\n    x: 50\n    y: 35');
  assert.equal(focusYaml({ x: 50, y: 36, top: 28, bottom: 44 }, '\r\n'), '  focus:\r\n    x: 50\r\n    y: 36\r\n    top: 28\r\n    bottom: 44');
});

// The live Tyler post: gray-matter quoted the key ('y': 35, YAML 1.1 boolean
// scare), the url is a folded scalar on the next line, and gallery follows.
const TYLER = [
  '---',
  'title: Tyler',
  'heroImage:',
  '  url: >-',
  '    https://upload.wikimedia.org/x.jpg',
  "  credit: 'Photo: someone'",
  '  focus:',
  '    x: 50',
  "    'y': 35",
  'gallery: []',
  '---',
  'body',
].join('\n');

test('spliceFocus replaces an existing focus (quoted y, folded url) and keeps everything else', () => {
  const out = spliceFocus(TYLER, { x: 50, y: 30, top: 22, bottom: 38 });
  assert.equal(out, [
    '---',
    'title: Tyler',
    'heroImage:',
    '  url: >-',
    '    https://upload.wikimedia.org/x.jpg',
    "  credit: 'Photo: someone'",
    '  focus:',
    '    x: 50',
    '    y: 30',
    '    top: 22',
    '    bottom: 38',
    'gallery: []',
    '---',
    'body',
  ].join('\n'));
});

test('spliceFocus inserts when there was no focus, honours CRLF, and refuses without heroImage', () => {
  const src = '---\r\nheroImage:\r\n  url: https://a/b.jpg\r\n  credit: c\r\ntags: []\r\n---\r\n';
  assert.equal(spliceFocus(src, { x: 40, y: 40 }), '---\r\nheroImage:\r\n  url: https://a/b.jpg\r\n  credit: c\r\n  focus:\r\n    x: 40\r\n    y: 40\r\ntags: []\r\n---\r\n');
  assert.equal(spliceFocus('---\ntitle: x\n---\n', { x: 1, y: 1 }), null);
});

test('a head box becomes point = centre plus top/bottom', () => {
  assert.deepEqual(focusFromReply({ headTop: 28, headBottom: 44, headLeft: 40, headRight: 60 }), { x: 50, y: 36, top: 28, bottom: 44 });
});

test('an old-style reply (focusX/focusY, or x/y) still yields a point', () => {
  assert.deepEqual(focusFromReply({ focusX: 47, focusY: 51 }), { x: 47, y: 51 });
  assert.deepEqual(focusFromReply({ x: 30, y: 60 }), { x: 30, y: 60 });
  assert.equal(focusFromReply({ ok: true }), null);
  assert.equal(focusFromReply(null), null);
});

test('swapped edges are corrected and values clamp to 0-100', () => {
  assert.deepEqual(focusFromReply({ headTop: 44, headBottom: 28, headLeft: 70, headRight: 30 }), { x: 50, y: 36, top: 28, bottom: 44 });
  assert.deepEqual(focusFromReply({ headTop: -5, headBottom: 140, headLeft: 0, headRight: 100 }), { x: 50, y: 50, top: 0, bottom: 100 });
});

// Bali café: the model boxed a customer's back at the bar. With the subject
// named "place", the box is ignored and the focal point (the breakfast) wins.
test('a head box is taken only for a person-subject; a place keeps its focal point', () => {
  const reply = { subject: 'place', focusX: 40, focusY: 62, headTop: 8, headBottom: 28, headLeft: 60, headRight: 70 };
  assert.deepEqual(focusFromReply(reply), { x: 40, y: 62 });
  assert.deepEqual(focusFromReply({ ...reply, subject: 'person' }), { x: 65, y: 18, top: 8, bottom: 28 });
  assert.deepEqual(focusFromReply({ subject: 'dish', focusX: 50, focusY: 55, headTop: null, headBottom: null, headLeft: null, headRight: null }), { x: 50, y: 55 });
  assert.deepEqual(focusFromReply({ subject: 'person', focusX: 50, focusY: 55, headTop: null, headBottom: null }), { x: 50, y: 55 });
});

test('a degenerate zero-height box is stored as a point', () => {
  assert.deepEqual(focusFromReply({ headTop: 40, headBottom: 41, headLeft: 50, headRight: 50 }), { x: 50, y: 41 });
});

// Bruno-shaped case: 1.5 portrait, window 44% of the image. A point at 51%
// centres the window at 29%; the real hat top sits near 30% and touches the
// edge. A box 30–44% pulls the window up so the hair has air above it.
test('box window keeps the hair inside with air above', () => {
  const H = 1000, ch = 440;
  const pointTop = cropWindowTop({ H, ch, focus: { x: 50, y: 51 } });
  assert.equal(pointTop, 290);
  const boxTop = cropWindowTop({ H, ch, focus: { x: 50, y: 37, top: 30, bottom: 44 } });
  // air = 8% of 440 = 35px → window must start at or above 300 - 35 = 265
  assert.ok(boxTop <= 265, `window top ${boxTop} leaves no air above the hair`);
  assert.ok(boxTop + ch >= 440 + 35, 'chin must be inside with air below');
});

// The tall case this exists for: a 1.78 upright phone photo, window ~32% of
// the image. Point at 60% → window 44–76%, a head at 40–52% is cut at the
// hair. Box 40–52% → window contains the whole head.
test('tall portrait: the box keeps a head the point would cut', () => {
  const H = 1780, ch = 570;
  const pointTop = cropWindowTop({ H, ch, focus: { x: 50, y: 60 } });
  assert.equal(pointTop, 783); // 1068 - 285
  assert.ok(pointTop > 0.40 * H, 'point window starts below the hair — the bug');
  const boxTop = cropWindowTop({ H, ch, focus: { x: 50, y: 46, top: 40, bottom: 52 } });
  const air = ch * 0.08;
  assert.ok(boxTop <= 0.40 * H - air + 1, 'hair inside with air');
  assert.ok(boxTop + ch >= 0.52 * H + air - 1, 'chin inside with air');
});

test('window never leaves the image (clamps at both ends)', () => {
  assert.equal(cropWindowTop({ H: 1000, ch: 440, focus: { x: 50, y: 20, top: 2, bottom: 14 } }), 0);
  assert.equal(cropWindowTop({ H: 1000, ch: 440, focus: { x: 50, y: 95, top: 90, bottom: 99 } }), 560);
  assert.equal(cropWindowTop({ H: 1000, ch: 440, focus: { x: 50, y: 0 } }), 0);
  assert.equal(cropWindowTop({ H: 1000, ch: 440, focus: { x: 50, y: 100 } }), 560);
});

test('a box taller than the window stays centred on the box', () => {
  const top = cropWindowTop({ H: 1000, ch: 300, focus: { x: 50, y: 50, top: 20, bottom: 80 } });
  assert.equal(top, 350);
});

test('no focus → null (caller falls back to its own heuristic)', () => {
  assert.equal(cropWindowTop({ H: 1000, ch: 440, focus: null }), null);
  assert.equal(cropWindowTop({ H: 1000, ch: 440, focus: { x: 50 } }), null);
});

test('crop key: point stays v2 (no mass re-cut), box is v3', () => {
  assert.equal(focusKey(null), '');
  assert.equal(focusKey({ x: 50, y: 35 }), 'v2:50,35');
  assert.equal(focusKey({ x: 50, y: 36, top: 28, bottom: 44 }), 'v3:50,36,28-44');
  assert.equal(hasBox({ x: 1, y: 2 }), false);
  assert.equal(hasBox({ x: 1, y: 2, top: 5, bottom: 5 }), false);
});
