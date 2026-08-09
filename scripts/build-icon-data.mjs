#!/usr/bin/env node
/**
 * Lucide 라인 아이콘 subset 추출 → src/data/icons-line.json
 *
 * 사이트 전체가 full-colour 이모지(Fluent Emoji Flat)를 쓰고 있었는데, 색이
 * 제각각이라 편집 톤과 겉돌았다. 2026-08-08 에 라인 아이콘으로 통일한다.
 * 전체 세트(1,834개)를 번들에 넣으면 Cloudflare 빌드가 메모리를 넘겨서
 * 실제 쓰는 것만 뽑아 둔다 — emoji 때와 같은 이유, 같은 방식.
 *
 * <Emoji name="…"/> 호출부(22개 파일, 55곳)는 그대로 두고 이 매핑으로 옮긴다.
 * 새 아이콘을 쓰려면 MAP 에 한 줄 추가하고 이 스크립트를 다시 돌린다.
 *
 * 실행: node scripts/build-icon-data.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 기존 이모지 이름 → Lucide 아이콘. 왼쪽 이름은 코드 곳곳에 박혀 있어 유지한다. */
export const MAP = {
  'admission-tickets': 'ticket',
  'round-pushpin': 'map-pin',
  hotel: 'hotel',
  'world-map': 'map',
  airplane: 'plane',
  'wrapped-gift': 'gift',
  'three-oclock': 'clock',
  compass: 'compass',
  'antenna-bars': 'wifi',
  'spiral-calendar': 'calendar',
  printer: 'printer',
  metro: 'train-front',
  'cherry-blossom': 'flower',
  'police-car-light': 'siren',
  'passport-control': 'file-check',
  'credit-card': 'wallet',
  'chart-increasing': 'trending-up',
  // 2026-08-08 design audit: the last two dingbat/emoji characters in UI
  // chrome — the post lightbox's ✕ and the itinerary rain callout's ☂.
  close: 'x',
  umbrella: 'umbrella',
  // 2026-08-09 owner review: the rental-car and airport-pickup plan cards
  // rendered an EMPTY glyph — these two emoji names were never mapped when
  // the set moved to Lucide. Plus a globe for the header continents.
  automobile: 'car',
  taxi: 'car-taxi-front',
  'globe-showing-asia-australia': 'earth',
};

const set = require('@iconify-json/lucide/icons.json');
const out = { width: set.width ?? 24, height: set.height ?? 24, icons: {} };

const missing = [];
for (const [alias, lucide] of Object.entries(MAP)) {
  const icon = set.icons[lucide];
  if (!icon) { missing.push(`${alias} → ${lucide}`); continue; }
  out.icons[alias] = { body: icon.body, width: icon.width, height: icon.height };
}

if (missing.length) {
  console.error('Lucide 에 없는 이름:', missing.join(', '));
  process.exit(1);
}

const dest = path.join(ROOT, 'src', 'data', 'icons-line.json');
fs.writeFileSync(dest, JSON.stringify(out), 'utf8');
console.log(`아이콘 ${Object.keys(out.icons).length}개 → ${path.relative(ROOT, dest)} (${(fs.statSync(dest).size / 1024).toFixed(1)}KB)`);
