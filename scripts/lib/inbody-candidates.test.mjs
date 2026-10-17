import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickFirstPassing } from './inbody-candidates.mjs';
import { markUsedImage } from './hero-url.mjs';

const cand = (n, license = 'wikimedia') => ({
  url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/Photo_${n}.jpg`,
  credit: `Photo: A ${n}`, license, source: `File:Photo_${n}.jpg`,
});
async function* from(list, pulled) { for (const c of list) { pulled.push(c.url); yield c; } }
const yes = (reason = 'Different angle, adds interior') => async () => ({ ok: true, reason });

// The bug this file exists for: the first Commons file was refused and nothing
// else was ever offered (Roath Park, Kongresshalle, 2026-10-17).
test('a refused first candidate is not the end — the next one is judged', async () => {
  const pulled = [];
  const verdicts = [{ ok: false, reason: 'Photo of signage, not the park' }, { ok: true, reason: 'Lake and boathouse, adds view' }];
  const got = await pickFirstPassing(from([cand(1), cand(2), cand(3)], pulled), {
    used: new Set(), allowed: () => true, verify: async () => verdicts.shift(),
  });
  assert.equal(got.entry.url, cand(2).url);
  assert.deepEqual(pulled, [cand(1).url, cand(2).url], 'stops pulling once one passes — no extra source calls');
});

test('a hedged yes is a no', async () => {
  const why = [];
  const got = await pickFirstPassing(from([cand(1)], []), {
    used: new Set(), allowed: () => true, why, verify: yes('Probably the same temple from the river'),
  });
  assert.equal(got, null);
  assert.match(why[0], /hedged/);
});

test('a photo already on another post is skipped without a vision call', async () => {
  const used = new Set();
  markUsedImage(used, cand(1).url);
  let calls = 0;
  const got = await pickFirstPassing(from([cand(1), cand(2)], []), {
    used, allowed: () => true, verify: async () => { calls++; return { ok: true, reason: 'Interior view' }; },
  });
  assert.equal(got.entry.url, cand(2).url);
  assert.equal(calls, 1);
});

test('guardrails can still refuse a passing photo, and the search goes on', async () => {
  const got = await pickFirstPassing(from([cand(1, 'unsplash'), cand(2)], []), {
    used: new Set(), allowed: (e) => e.license !== 'unsplash', verify: yes(),
  });
  assert.equal(got.entry.url, cand(2).url);
});

test('a verifier that throws is a miss, not a crash', async () => {
  const why = [];
  const got = await pickFirstPassing(from([cand(1)], []), {
    used: new Set(), allowed: () => true, why, verify: async () => { throw new Error('429 Too Many Requests'); },
  });
  assert.equal(got, null);
  assert.match(why[0], /verify threw 429/);
});

test('the entry written to the post carries only the four gallery fields', async () => {
  const got = await pickFirstPassing(from([{ ...cand(1), w: 4000, title: 'x', via: 'event-category' }], []), {
    used: new Set(), allowed: () => true, verify: yes(),
  });
  assert.deepEqual(Object.keys(got.entry).sort(), ['credit', 'license', 'source', 'url']);
});

// El Micalet, 2026-10-17: the bell tower's guide was offered the ice-cream
// terrace of the same name on the square below.
test('a landmark refuses a Foursquare namesake filed as food or drink', async () => {
  const { isDiningHit } = await import('./photo-sources.mjs');
  const { isLandmarkPost } = await import('./inbody-candidates.mjs');
  assert.equal(isDiningHit({ name: 'El Micalet', categories: [{ name: 'Ice Cream Parlor' }] }), true);
  assert.equal(isDiningHit({ name: 'Micalet', categories: [{ name: 'Café' }] }), true);
  assert.equal(isDiningHit({ name: 'El Micalet', categories: [{ name: 'Monument' }, { name: 'Church' }] }), false);
  assert.equal(isDiningHit({ name: 'Barcelona Cathedral', categories: [{ name: 'Cathedral' }] }), false, '"bar" inside a word is not a bar');
  assert.equal(isLandmarkPost('hidden-gem', 'wikimedia'), true);
  assert.equal(isLandmarkPost('attraction', 'foursquare'), true);
  assert.equal(isLandmarkPost('restaurant', 'foursquare'), false, 'a café guide keeps its own Foursquare photos');
  assert.equal(isLandmarkPost('hidden-gem', 'foursquare'), false);
  assert.equal(isLandmarkPost('attraction', 'wikimedia', 'Ben Nghe Street Food'), false, 'a food market filed as an attraction is still food');
  assert.equal(isLandmarkPost('hidden-gem', 'wikimedia', 'Chuồn Chuồn Bistro & Bar'), false);
  assert.equal(isLandmarkPost('attraction', 'wikimedia', 'Paseo de La Concha'), true);
});

// Review 10-17: a restaurant guide with a Commons hero is still a business.
test('restaurant and trendy guides are never landmarks, whatever the hero', async () => {
  const { isLandmarkPost } = await import('./inbody-candidates.mjs');
  assert.equal(isLandmarkPost('restaurant', 'wikimedia', 'Tim Ho Wan (Central)'), false);
  assert.equal(isLandmarkPost('trendy', 'wikimedia', 'Urth Caffe'), false);
  assert.equal(isLandmarkPost('hidden-gem', 'wikimedia', "Sant' Eustachio Caffè"), false, 'Italian spelling is still a café');
});

// Review 10-17: the used-photo set read heroes only, so one guide's in-body
// photo could become the next guide's hero (touring acts chain through one
// Commons category in a fixed order).
test('in-body photos are read into the used set', async () => {
  const { galleryUrlsOf } = await import('./images.mjs');
  const raw = [
    '---', 'title: x', 'heroImage:', '  url: https://h/1.jpg', 'gallery:',
    '  - url: "https://g/2.jpg"', '    credit: c', '    license: wikimedia', '    source: s',
    "  - url: 'https://g/3.jpg'", '    credit: c', 'place:', '  url: https://not/gallery.jpg', '---', 'body',
  ].join('\r\n');
  assert.deepEqual(galleryUrlsOf(raw), ['https://g/2.jpg', 'https://g/3.jpg']);
  assert.deepEqual(galleryUrlsOf('---\ntitle: x\ngallery: []\n---\n'), []);
});

// Patrol run 10-17: membership of an act's Commons category did not mean the
// act is in the frame — the file's own name has to say so.
test('an event second photo must name the act or the event in its file name', async () => {
  const { namesEventSubject: n } = await import('./inbody-candidates.mjs');
  assert.equal(n('KCON 2015 Super Junior DSC03033 (20357938451)', { performer: 'Yesung', name: 'YESUNG 10th Anniversary Tour', region: 'Kuala Lumpur' }), false);
  assert.equal(n('Cosplay Contest at Copenhagen Sakura Festival 2023 02', { performer: 'Hatsune Miku', name: 'Hatsune Miku Concert', region: 'London' }), false);
  assert.equal(n('DSC 0111 (3760455816)', { name: 'Hong Kong Sixes', region: 'Hong Kong' }), false);
  assert.equal(n('Jethro Tull - Bouree, concert in Serbia, Belgrade, 2018', { performer: 'Jethro Tull', name: 'Jethro Tull', region: 'Istanbul' }), true);
  assert.equal(n('2019-09-01 ISTAF 2019 (Martin Rulsch) 01', { name: 'ISTAF Indoor Berlin', region: 'Berlin' }), true);
});
