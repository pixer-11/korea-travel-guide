import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heroUrlOf } from './hero-url.mjs';

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
