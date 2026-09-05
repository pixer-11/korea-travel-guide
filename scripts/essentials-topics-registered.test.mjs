// A topic that exists as content but is missing a route, a card or a ui string
// is invisible or broken, and nothing used to catch it: the six edits below
// were made by hand every time. 2026-09-05, adding luggage storage.
//
//   node --test scripts/essentials-topics-registered.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');
const here = (rel) => existsSync(new URL(rel, ROOT));

const slugs = readdirSync(new URL('src/content/essentials-topics/', ROOT))
  .filter((f) => f.endsWith('.md'))
  .map((f) => f.replace(/\.md$/, ''));
const index = read('src/components/EssentialsIndex.astro');
const llms = read('src/pages/llms.txt.ts');
const ui = read('src/i18n/ui.ts');
const icons = JSON.parse(read('src/data/icons-line.json')).icons;
const LANGS = 5; // en, ko, ja, es, zh

test('every essentials topic has content, both routes, a card, an llms.txt line and ui strings', () => {
  assert.ok(slugs.length >= 6, `expected at least 6 topics, found ${slugs.length}`);
  for (const slug of slugs) {
    assert.ok(here(`src/pages/essentials/${slug}.astro`), `English route missing: /essentials/${slug}`);
    assert.ok(here(`src/pages/[lang]/essentials/${slug}.astro`), `localized route missing: /[lang]/essentials/${slug}`);
    assert.ok(index.includes(`/essentials/${slug}'`), `EssentialsIndex has no card for ${slug}`);
    assert.ok(llms.includes(`/essentials/${slug})`), `llms.txt has no line for ${slug}`);

    const row = index.split('\n').find((l) => l.includes(`/essentials/${slug}'`));
    const keys = [...row.matchAll(/'(ess\.[A-Za-z]+)'/g)].map((m) => m[1]);
    assert.equal(keys.length, 2, `${slug}: expected a heading key and a dek key on its card row`);
    for (const key of keys) {
      const defined = ui.split(`'${key}':`).length - 1;
      assert.equal(defined, LANGS, `${key} is defined ${defined}× in ui.ts, expected ${LANGS}`);
    }

    const iconMatch = row.match(/icon:\s*'([A-Za-z0-9-]+)'/);
    assert.ok(iconMatch, `${slug}: card row has no icon: '...' field`);
    const iconName = iconMatch[1];
    assert.ok(
      Object.prototype.hasOwnProperty.call(icons, iconName),
      `${slug}: icon '${iconName}' is not defined in src/data/icons-line.json`
    );
  }
});

test('each topic route reads its own entry', () => {
  for (const slug of slugs) {
    assert.ok(read(`src/pages/essentials/${slug}.astro`).includes(`'${slug}'`), `${slug}.astro loads a different entry`);
    assert.ok(read(`src/pages/[lang]/essentials/${slug}.astro`).includes(`'${slug}'`), `[lang]/${slug}.astro loads a different entry`);
  }
});
