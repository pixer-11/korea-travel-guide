import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseColor, contrastRatio, requiredRatio, judgeText } from './contrast.mjs';

const WHITE = 'rgb(255, 255, 255)';
const page = (file) => readFileSync(fileURLToPath(new URL(`../../src/components/${file}`, import.meta.url)), 'utf8');

test('the failures the 11-08 review measured are failures', () => {
  // White on the mock's rust, the itinerary ticket button at 14.4px bold.
  const rust = judgeText({ color: WHITE, layers: ['rgb(200, 115, 63)'], px: 14.4, weight: 800 });
  assert.equal(rust.ok, false);
  assert.equal(rust.ratio.toFixed(2), '3.51');
  // White on the dark events token.
  assert.equal(judgeText({ color: WHITE, layers: ['rgb(224, 138, 90)'], px: 16.3, weight: 700 }).ratio.toFixed(2), '2.64');
  // The holiday chip's date: a translucent light chip over the dark band.
  const chip = judgeText({ color: 'rgb(108, 85, 70)', layers: ['rgba(255, 255, 255, 0.7)', 'rgb(58, 38, 32)'], px: 13.4, weight: 400 });
  assert.equal(chip.ok, false);
  assert.equal(chip.ratio.toFixed(2), '3.78');
});

test('the colours that replaced them pass, and normal text is left alone', () => {
  const fill = (c) => judgeText({ color: WHITE, layers: [c], px: 14.4, weight: 800 });
  assert.equal(fill('rgb(180, 95, 45)').ok, true, '--cta');
  assert.equal(fill('rgb(157, 82, 38)').ok, true, '--cta-deep, the hover');
  assert.equal(fill('rgb(158, 77, 38)').ok, true, '--ev-rust-fill');
  assert.equal(judgeText({ color: 'rgb(32, 28, 23)', layers: ['rgb(247, 243, 236)'], px: 16, weight: 400 }).ok, true);
});

test('a brightness hover on --cta would fall under AA again (why the hover deepens)', () => {
  const lit = { r: 180 * 1.07, g: 95 * 1.07, b: 45 * 1.07 };
  assert.ok(contrastRatio({ r: 255, g: 255, b: 255 }, lit) < 4.5);
});

test('large text needs 3:1, and only large text', () => {
  assert.equal(requiredRatio(24, 400), 3);
  assert.equal(requiredRatio(18.66, 700), 3);
  assert.equal(requiredRatio(18.66, 400), 4.5);
  assert.equal(requiredRatio(18, 800), 4.5);
  assert.equal(judgeText({ color: WHITE, layers: ['rgb(200, 115, 63)'], px: 30, weight: 400 }).ok, true);
});

test('opacity on the words counts against them', () => {
  const solid = judgeText({ color: 'rgb(32, 28, 23)', layers: ['rgb(239, 228, 211)'], opacity: 1, px: 11.5, weight: 400 });
  const faded = judgeText({ color: 'rgb(32, 28, 23)', layers: ['rgb(239, 228, 211)'], opacity: 0.6, px: 11.5, weight: 400 });
  assert.equal(solid.ok, true);
  assert.equal(faded.ok, false);
});

test('color-mix() results are read; an unreadable colour is unmeasured, never a pass', () => {
  assert.deepEqual(parseColor('color(srgb 1 0 0 / 0.5)'), { r: 255, g: 0, b: 0, a: 0.5 });
  assert.equal(parseColor('oklch(0.7 0.1 30)'), null);
  assert.equal(judgeText({ color: 'oklch(0.7 0.1 30)', layers: ['rgb(0, 0, 0)'], px: 16, weight: 400 }), null);
  assert.equal(judgeText({ color: WHITE, layers: ['lab(50 0 0)'], px: 16, weight: 400 }), null);
});

// The sources, so a later "just use the mock's colour" is caught before it ships.
test('filled buttons with white words stay on the AA pair', () => {
  const itin = page('ItineraryPage.astro');
  assert.match(itin, /\.ith-btn \{[^}]*background: var\(--cta\)/);
  assert.match(itin, /\.ith-btn:hover \{ background: var\(--cta-deep\); \}/);
  assert.doesNotMatch(itin, /\.ith-btn:hover \{[^}]*brightness/);
  // The forest stay button keeps its own colour on hover.
  assert.match(itin, /\.ith-btn--dark:hover \{ background: var\(--x-forest\)/);
  const hub = page('ItineraryIndex.astro');
  assert.match(hub, /\.ixh-btn \{[^}]*background: var\(--cta\)/);
  assert.match(hub, /\.ixh-pill \{[^}]*background: var\(--cta\)/);
  const ess = page('EssentialsIndex.astro');
  assert.match(ess, /\.exh-btn \{[^}]*background: var\(--cta\)/);
  assert.match(ess, /\.exh-btn--ghost:hover \{ background: transparent/);
  const ev = page('EventsList.astro');
  assert.match(ev, /\.ev-flight-cta \{[^}]*background: var\(--ev-rust-fill\)/);
  // Dark may lighten --ev-rust for dots and words; the fill must never follow it.
  assert.doesNotMatch(ev, /--ev-rust-fill: #e/);
});

test('white words never sit on the my-trip rust, and the check opens the page with something saved', () => {
  const rust = judgeText({ color: WHITE, layers: ['rgb(192, 101, 47)'], px: 12.8, weight: 700 });
  assert.equal(rust.ok, false);
  assert.equal(rust.ratio.toFixed(2), '4.08');
  const trip = page('MyTripPage.astro');
  assert.doesNotMatch(trip, /\.mt-cities-n \{[^}]*background: var\(--mt-rust\)/);
  assert.match(trip, /\.mt-cities-n \{[^}]*background: var\(--cta\)/);
  assert.doesNotMatch(trip, /\.mt-btn--rust \{[^}]*background: var\(--mt-rust\)/);
  // An empty /my-trip/ has no badge to read.
  const live = readFileSync(fileURLToPath(new URL('../live/contrast.mjs', import.meta.url)), 'utf8');
  assert.match(live, /'my-trip': \{ wa_saved_regions_v1: \[/);
});
