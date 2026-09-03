import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heroUrlOf, imageKeys, imageIdentity, isUsedImage, markUsedImage, unmarkUsedImage, heroKeeper } from './hero-url.mjs';

const HERO = 'https://upload.wikimedia.org/wikipedia/commons/5/58/Snooker_table_selby.JPG';

// The two shapes that made ~113 heroes invisible to duplicate avoidance on
// 2026-08-19, each reproduced from the live post that carried it.

test('reads a folded-scalar hero url (was captured as the literal ">-")', () => {
  const src = [
    '---',
    'title: Qasr Al Hosn',
    'heroImage:',
    '  url: >-',
    `    ${HERO}`,
    "  credit: 'Photo: Someone / Wikimedia Commons'",
    '  license: wikimedia',
    '---',
    'body',
  ].join('\n');
  assert.equal(heroUrlOf(src), HERO);
});

test('reads the hero when officialLink.url sits above heroImage', () => {
  const src = [
    '---',
    'title: 2026 Wuhan Open (Snooker)',
    'officialLink:',
    '  label: Official site',
    '  url: https://www.wst.tv/',
    'heroImage:',
    `  url: ${HERO}`,
    '  license: wikimedia',
    '---',
    'body',
  ].join('\n');
  assert.equal(heroUrlOf(src), HERO);
});

// Reverse direction: the reader must not start claiming things that are not
// heroes, or every picker suddenly refuses usable photos.
test('does not mistake a non-hero url for the hero', () => {
  const src = ['---', 'title: T', 'officialLink:', '  url: https://www.wst.tv/', '---', 'body'].join('\n');
  assert.equal(heroUrlOf(src), null);
});

test('strips quotes and survives CRLF', () => {
  const src = ['---', 'title: T', 'heroImage:', `  url: '${HERO}'`, '---', 'body'].join('\r\n');
  assert.equal(heroUrlOf(src), HERO);
});

test('returns null for a post with no hero, and for unparseable frontmatter', () => {
  assert.equal(heroUrlOf(['---', 'title: T', '---', 'body'].join('\n')), null);
  assert.equal(heroUrlOf('no frontmatter at all'), null);
  assert.equal(heroUrlOf(''), null);
});

// ── One photo, every spelling (2026-09-03) ─────────────────────────────────
// The two live pairs that alarmed the owner every run, exactly as stored: the
// keeper's thumbnail against the ORIGINAL the picker was handed weeks earlier.
const PM_1920 = 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Post_Malone_July_2021.jpg/1920px-Post_Malone_July_2021.jpg';
const PM_ORIG = 'https://upload.wikimedia.org/wikipedia/commons/3/3a/Post_Malone_July_2021.jpg';
const PM_THUMBHOST = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/3/3a/Post_Malone_July_2021.jpg/1280px-Post_Malone_July_2021.jpg';
const PM_CROP = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Post_Malone_July_2021_%28cropped%29.jpg/1920px-Post_Malone_July_2021_%28cropped%29.jpg';
const WK_1280 = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a0/The_Weeknd_Portrait_by_Brian_Ziff.jpg/1280px-The_Weeknd_Portrait_by_Brian_Ziff.jpg';
const WK_ORIG = 'https://upload.wikimedia.org/wikipedia/commons/a/a0/The_Weeknd_Portrait_by_Brian_Ziff.jpg';

test('a hero claimed at one width is taken at every width, host and as the original', () => {
  const used = new Set();
  markUsedImage(used, PM_1920);
  assert.equal(isUsedImage(used, PM_ORIG), true, 'original of the same file');
  assert.equal(isUsedImage(used, PM_THUMBHOST), true, 'thumb.wikimedia.org host, other width');
  assert.equal(isUsedImage(used, PM_1920), true, 'the exact string still counts');
  const used2 = new Set();
  markUsedImage(used2, WK_1280);
  assert.equal(isUsedImage(used2, WK_ORIG), true, 'Saitama was handed this while Singapore wore the 1280px thumb');
});

test('a different Commons file is free — a crop is a different file', () => {
  const used = new Set();
  markUsedImage(used, PM_1920);
  assert.equal(isUsedImage(used, PM_CROP), false);
  assert.equal(isUsedImage(used, WK_1280), false);
});

test('the old exact-string spelling of the set still works (loadUsedImageUrls callers)', () => {
  const used = new Set([PM_1920]);
  assert.equal(isUsedImage(used, PM_1920), true);
  // A set filled the OLD way (exact strings) cannot see the original — that is
  // the hole; markUsedImage is what closes it. Documented, not asserted away.
  assert.equal(isUsedImage(used, PM_ORIG), false);
});

test('unsplash photos are keyed by photo number, other URLs by exact string', () => {
  const used = new Set();
  markUsedImage(used, 'https://images.unsplash.com/photo-1500000000000-abc?w=1920&q=80');
  assert.equal(isUsedImage(used, 'https://images.unsplash.com/photo-1500000000000-abc?w=800'), true);
  assert.deepEqual(imageKeys('https://fastly.4sqi.net/img/general/original/abc.jpg'), ['https://fastly.4sqi.net/img/general/original/abc.jpg']);
  assert.equal(isUsedImage(used, 'https://fastly.4sqi.net/img/general/original/abc.jpg'), false);
});

test('imageIdentity: one string per photo; empty for no url', () => {
  assert.equal(imageIdentity(PM_1920), imageIdentity(PM_ORIG));
  assert.equal(imageIdentity(PM_1920), 'commons:Post_Malone_July_2021.jpg');
  assert.notEqual(imageIdentity(PM_1920), imageIdentity(PM_CROP));
  assert.equal(imageIdentity(''), null);
  assert.equal(imageIdentity(undefined), null);
  assert.equal(isUsedImage(new Set(['x']), null), false);
  assert.equal(isUsedImage(undefined, PM_1920), false);
});

test('unmarkUsedImage releases every spelling of a reservation', () => {
  const used = new Set();
  markUsedImage(used, PM_ORIG);
  unmarkUsedImage(used, PM_ORIG);
  assert.equal(used.size, 0, 'the exact string and the file key both go');
  assert.equal(isUsedImage(used, PM_1920), false);
  // Un-marking another spelling frees the FILE key; the exact string it was
  // never given stays — nothing here guesses at strings it did not add.
  markUsedImage(used, PM_ORIG);
  unmarkUsedImage(used, PM_1920);
  assert.equal(isUsedImage(used, PM_THUMBHOST), false);
  assert.equal(used.has(PM_ORIG), true);
});

test('heroKeeper: earliest pubDate keeps the photo, then the first slug', () => {
  const sg = { slug: 'singapore-the-weeknd', pubDate: '2026-07-29' };
  const saitama = { slug: 'saitama-the-weeknd', pubDate: '2026-08-19' };
  assert.equal(heroKeeper([saitama, sg]).slug, 'singapore-the-weeknd');
  const bkk = { slug: 'bangkok-post-malone', pubDate: '2026-07-23' };
  const kl = { slug: 'kuala-lumpur-post-malone', pubDate: '2026-07-23' };
  assert.equal(heroKeeper([kl, bkk]).slug, 'bangkok-post-malone');
  assert.equal(heroKeeper([{ slug: 'b', pubDate: new Date('2026-01-02') }, { slug: 'a', pubDate: '2026-01-03' }]).slug, 'b');
  assert.equal(heroKeeper([]), null);
});
