// Runs the real script on a throwaway tree: which translations get new figures,
// and which get re-stamped (i.e. are spared a full re-translation).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { srcHashOfPostFile, storedHashIn } from './lib/src-hash.mjs';

const SCRIPT = fileURLToPath(new URL('./resync-rating-badges.mjs', import.meta.url));

const post = (desc) => `---
title: Test Market
description: "${desc}"
place:
  rating: 4.5
  userRatingsTotal: 30120
---

Body text about the market.
`;
const tr = (lang, hash, desc) => `---
lang: ${lang}
slug: test-market
srcHash: '${hash}'
title: 번역 제목
description: ${desc}
faq: []
---

번역 본문.
`;

test('refresh re-stamps every translation that is still current, and only those', () => {
  const root = mkdtempSync(join(tmpdir(), 'badge-'));
  for (const d of ['src/content/posts', 'src/content/i18n/ko', 'src/content/i18n/ja', 'src/content/i18n/es', 'src/content/i18n/zh']) mkdirSync(join(root, d), { recursive: true });
  const enBefore = post('A working market. 4.4★ (29,423 reviews) — what visitors say.');
  const oldHash = srcHashOfPostFile(enBefore);
  writeFileSync(join(root, 'src/content/posts/test-market.md'), enBefore);
  // zh: worded star, current → figures fixed AND re-stamped (the 143-a-month case)
  writeFileSync(join(root, 'src/content/i18n/zh/test-market.md'), tr('zh', oldHash, '露天市场。4.4星（29,423条评价）——游客怎么说。'));
  // ko: current, quotes no figures → re-stamped only
  writeFileSync(join(root, 'src/content/i18n/ko/test-market.md'), tr('ko', oldHash, '동네 시장 안내와 영업시간.'));
  // ja: ALREADY stale for another reason → figures fixed, hash left stale
  writeFileSync(join(root, 'src/content/i18n/ja/test-market.md'), tr('ja', '000000000000', '市場。4.4★(29,423件のレビュー)—声'));
  // es: rating-shaped but unreadable → untouched, stays stale
  writeFileSync(join(root, 'src/content/i18n/es/test-market.md'), tr('es', oldHash, 'Mercado. Valoración 4.4 (29.423 reseñas).'));

  execFileSync(process.execPath, [SCRIPT], { cwd: root, encoding: 'utf8' });

  const enAfter = readFileSync(join(root, 'src/content/posts/test-market.md'), 'utf8');
  assert.match(enAfter, /4\.5★ \(30,120 reviews\)/);
  const newHash = srcHashOfPostFile(enAfter);
  assert.notEqual(newHash, oldHash);
  const read = (l) => readFileSync(join(root, `src/content/i18n/${l}/test-market.md`), 'utf8');

  assert.match(read('zh'), /4\.5星（30,120条评价）/);
  assert.equal(storedHashIn(read('zh')), newHash, 'zh: badge-only change must not queue a re-translation');
  assert.equal(storedHashIn(read('ko')), newHash, 'ko: nothing to fix, still current');
  assert.match(read('ja'), /4\.5★\(30,120件のレビュー\)/);
  assert.equal(storedHashIn(read('ja')), '000000000000', 'ja: was stale before, must stay stale');
  assert.equal(storedHashIn(read('es')), oldHash, 'es: unreadable figures are never certified');
  assert.match(read('es'), /4\.4 \(29\.423 reseñas\)/);
});
