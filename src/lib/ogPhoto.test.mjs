import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pickOgPhoto, heroWidth, heroIsWideEnough } from './ogPhoto.mjs';

const queue = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../data/hero-width-queue.json', import.meta.url)), 'utf8'),
);

const SEP = String.fromCharCode(1);
// Build fixtures from a REAL probe in the queue, so a change to the file's
// shape (the ␁-joined key, the `probes` wrapper) fails here instead of silently
// making every width unknown — which would look like "nothing to fix".
const [sampleKey, sampleWidth] = Object.entries(queue.probes ?? {})[0] ?? [];
const [sampleSlug, sampleUrl] = String(sampleKey ?? '').split(SEP);

const post = (id, url) => ({ id, data: { heroImage: url ? { url } : undefined } });

test('the queue file still has the shape this module reads', () => {
  assert.ok(sampleKey, 'no probes in data/hero-width-queue.json');
  assert.equal(typeof sampleWidth, 'number');
  assert.ok(sampleSlug && sampleUrl, 'probe key is not slug␁url');
});

test('a probed hero reports its measured width', () => {
  assert.equal(heroWidth(post(sampleSlug, sampleUrl)), sampleWidth);
});

test('an unprobed hero is unknown, not zero', () => {
  assert.equal(heroWidth(post('no-such-post', 'https://example.com/x.jpg')), null);
  assert.equal(heroWidth(post(sampleSlug, undefined)), null);
});

test('unknown width is allowed through — better a photo than the brand default', () => {
  assert.equal(heroIsWideEnough(post('no-such-post', 'https://example.com/x.jpg')), true);
});

test('a wide hero wins over an earlier unmeasured one', () => {
  if (sampleWidth < 1200) return; // the sampled probe is narrow; covered below
  const picked = pickOgPhoto([
    post('unmeasured', 'https://example.com/unknown.jpg'),
    post(sampleSlug, sampleUrl),
  ]);
  assert.equal(picked, sampleUrl);
});

test('falls back to an unmeasured hero when nothing is proven wide', () => {
  const picked = pickOgPhoto([post('unmeasured', 'https://example.com/unknown.jpg')]);
  assert.equal(picked, 'https://example.com/unknown.jpg');
});

test('returns nothing when every hero is measured too narrow', () => {
  const narrow = Object.entries(queue.probes ?? {}).find(([, w]) => w < 1200);
  if (!narrow) return; // no narrow probe on file today
  const [slug, url] = narrow[0].split(SEP);
  assert.equal(pickOgPhoto([post(slug, url)]), undefined);
});

test('an empty or heroless list yields nothing', () => {
  assert.equal(pickOgPhoto([]), undefined);
  assert.equal(pickOgPhoto(undefined), undefined);
  assert.equal(pickOgPhoto([post('a', undefined)]), undefined);
});

// ── URL 단위 폭 기록 (2026-09-10) ──────────────────────────────
// og:image 검사는 매일 재기만 하고 버렸다. 그래서 같은 좁은 사진이 다음 날 또 뽑혔고,
// 24시간 안에 두 번 알림이 왔다(849px OMSI → 북미 대륙, 533px Charlie Puth → Pasay).
// data/og-width-probes.json 은 URL만으로 키를 잡으므로, 그 사진이 어느 글에 붙어 있든 걸린다.
test('URL 단위로 기록된 좁은 사진은 어느 글에 붙어도 안 뽑힌다', () => {
  const url = 'https://upload.wikimedia.org/wikipedia/commons/8/86/Charlie_Puth_2017_%28cropped%29.jpg';
  const post = { id: 'any-post-at-all', data: { heroImage: { url }, category: 'attraction' } };
  assert.equal(heroWidth(post), 533, 'URL 저장소를 안 읽고 있다');
  assert.equal(pickOgPhoto([post]), undefined);
});

test('🛑 못 잰 사진은 여전히 통과한다 — 신규 글이 브랜드 기본 이미지로 떨어지면 안 된다', () => {
  const url = 'https://upload.wikimedia.org/wikipedia/commons/9/99/Never_Probed_At_All.jpg';
  const post = { id: 'brand-new-post', data: { heroImage: { url }, category: 'attraction' } };
  assert.equal(heroWidth(post), null);
  assert.equal(pickOgPhoto([post]), url);
});
