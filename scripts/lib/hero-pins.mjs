// Heroes a person chose, and that no machine may change.
//
// 픽서님 2026-10-09: "지금 바꾼 것들이 추후에 순찰이나 검사에서 자꾸 다시 바뀌니까,
// 수정한 내용을 잘 기억해야지." Fifteen-odd scripts can write or strip a hero
// (the photo patrol, the identity strip, the re-quarantine, the duplicate
// resolver, the width upgrade, discovery…), and the same morning three heroes
// a person had removed were put back by the patrol. A pin is the decision,
// written down once:
//
//   data/hero-pins.json   { "<slug>": { url, credit, license, source, focus?, why, at } }
//
// It is written by set-hero.mjs (a hand pick) and read by everything that
// would otherwise judge or replace that hero; reassert-hero-pins.mjs restores
// a pinned hero after any run that changed it anyway.
// Identity, not url: the width upgrade swaps a hero for a WIDER render of the
// same Commons file, and that is not a change of decision.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { imageIdentity } from './hero-url.mjs';

export const HERO_PINS_PATH = fileURLToPath(new URL('../../data/hero-pins.json', import.meta.url));

export function loadHeroPins(path = HERO_PINS_PATH) {
  try { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}; } catch { return {}; }
}

export function saveHeroPins(pins, path = HERO_PINS_PATH) {
  const sorted = Object.fromEntries(Object.keys(pins).sort().map((k) => [k, pins[k]]));
  writeFileSync(path, JSON.stringify(sorted, null, 1) + '\n');
}

/** Is this slug's hero a person's decision? (any url of the pinned picture) */
export function isPinnedHero(pins, slug, url = null) {
  const pin = pins?.[slug];
  if (!pin?.url) return false;
  if (url == null) return true;
  return imageIdentity(pin.url) === imageIdentity(url);
}

/** Does the post's current hero differ from its pin? */
export function pinDrift(pins, slug, currentUrl) {
  const pin = pins?.[slug];
  if (!pin?.url) return false;
  return !currentUrl || imageIdentity(pin.url) !== imageIdentity(currentUrl);
}
