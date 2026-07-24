import test from 'node:test';
import assert from 'node:assert/strict';
import { audienceKey, sentSetFor, pickSingleRegionEdition } from './newsletter-content.mjs';

const clean = (n) => ({ url: `https://images.unsplash.com/photo-${n}`, credit: 'x', license: 'unsplash' });
const moth = { url: 'https://upload.wikimedia.org/x/Ambulyx_MHNT.jpg', credit: 'MHNT', license: 'wikimedia' };
const now = new Date('2026-07-25T00:00:00Z');

function post(slug, over = {}) {
  return { slug, data: { title: slug, region: 'Dubai', country: 'UAE', category: 'restaurant', pubDate: new Date('2026-07-20'), heroImage: clean(slug), ...over } };
}

test('audienceKey builds region:lang, global when no region', () => {
  assert.equal(audienceKey('dubai', 'ko'), 'dubai:ko');
  assert.equal(audienceKey('', 'en'), '__global__:en');
});

test('sentSetFor unions posts and events', () => {
  const log = { 'dubai:ko': { posts: ['a'], events: ['e1'] } };
  const s = sentSetFor(log, 'dubai:ko');
  assert.ok(s.has('a') && s.has('e1') && !s.has('b'));
});

test('picks newest clean posts, skips off-topic hero, excludes already-sent', () => {
  const posts = [
    post('sent-one'),
    post('good-new', { pubDate: new Date('2026-07-24') }),
    post('mothy', { heroImage: moth }),
  ];
  const ed = pickSingleRegionEdition({ posts, region: 'Dubai', country: 'UAE', sent: new Set(['sent-one']), now, minStories: 3 });
  const slugs = [ed.hero.slug, ...ed.stories.map((s) => s.slug)];
  assert.ok(slugs.includes('good-new'));
  assert.ok(!slugs.includes('sent-one'), 'already-sent excluded');
  assert.ok(!slugs.includes('mothy'), 'off-topic hero excluded');
});

test('tops up from same country when region is thin', () => {
  const posts = [
    post('dubai-1'),
    post('abudhabi-1', { region: 'Abu Dhabi' }),
    post('abudhabi-2', { region: 'Abu Dhabi' }),
  ];
  const ed = pickSingleRegionEdition({ posts, region: 'Dubai', country: 'UAE', sent: new Set(), now, minStories: 3 });
  const all = [ed.hero.slug, ...ed.stories.map((s) => s.slug)];
  assert.ok(all.includes('abudhabi-1'), 'country top-up included');
});

test('collects upcoming events for the country, not past ones', () => {
  const posts = [
    post('dubai-1'),
    post('expo', { category: 'event', region: 'Dubai', eventStartDate: new Date('2026-08-10') }),
    post('old-fest', { category: 'event', region: 'Dubai', eventStartDate: new Date('2026-01-01') }),
  ];
  const ed = pickSingleRegionEdition({ posts, region: 'Dubai', country: 'UAE', sent: new Set(), now, minStories: 1 });
  const ev = ed.events.map((e) => e.slug);
  assert.ok(ev.includes('expo') && !ev.includes('old-fest'));
});

test('returns null when no clean hero exists', () => {
  const posts = [post('mothy', { heroImage: moth })];
  const ed = pickSingleRegionEdition({ posts, region: 'Dubai', country: 'UAE', sent: new Set(), now, minStories: 3 });
  assert.equal(ed, null);
});
