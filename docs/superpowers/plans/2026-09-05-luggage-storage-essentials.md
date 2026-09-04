# Luggage Storage Essentials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a sixth essentials topic — luggage storage — as a hub page in five languages plus one section in each country guide, without rewriting any prose that has already been reviewed.

**Architecture:** No new content collection. The hub is a sixth file in the existing `essentialsTopics` collection, so `translate-topics.mjs` and the topic-hub component pick it up unchanged. The per-country text is a new `## Luggage storage` section inserted into the existing `src/content/essentials/<country>.md` body by a section-only writer, so `build-essentials.mjs` (which rewrites a guide whole) is never involved. A registration test makes the six-file edit that every new topic requires impossible to half-finish.

**Tech Stack:** Astro content collections, Node 24 (`node --test`), `@anthropic-ai/sdk` with the `web_search_20250305` tool, Lucide icons via `@iconify-json/lucide`.

**Spec:** `docs/superpowers/specs/2026-09-05-luggage-storage-essentials-design.md`

## Global Constraints

- Work in `C:/Users/user/wa-main`. Every bash call starts with `cd /c/Users/user/wa-main && pwd &&` — the shell cwd resets between calls.
- Shared checkout: stage only the files a task names (`git add <path>`), never `git add -A`. If `.git/index.lock` exists, wait 10 seconds and retry.
- Files are LF in the index. Never overwrite a file with Write without reading it first.
- Run tests by explicit file list — `node --test <file> <file>`. The directory form fails on this box (Node 24 treats the directory as a module).
- Before committing any changed or new script, run `node --test scripts/lint-regex.test.mjs`. Agent-written code has twice shipped invisible characters.
- Prices in generated prose are **ranges with a source link**, never a single exact figure. A country whose sources cannot be verified is skipped, not hedged.
- Push once, at the end (Task 6). Consecutive pushes cancel each other's deploy builds.

---

### Task 1: The section writer (pure functions)

The whole plan rests on being able to put one section into a country guide and provably touch nothing else. This task is pure string work — no I/O, no API — so it can be tested exhaustively.

**Files:**
- Create: `scripts/lib/essentials-section.mjs`
- Test: `scripts/lib/essentials-section.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `detectEol(md) → '\n' | '\r\n'`
  - `findSection(md, heading) → { start: number, end: number } | null` — byte span of `## <heading>` through the character before the next `## `, or end of file.
  - `upsertSection(md, { heading, body, anchorAfter?, fallbackBefore? }) → string` — replaces that section if present, otherwise inserts it after `## <anchorAfter>` (default `Getting around`), else before `## <fallbackBefore>` (default `Official sources`), else appends.
  - `stampSectionReviewed(md, slug, isoDate) → string` — adds or updates `sectionsReviewed.<slug>` in the frontmatter, leaving `lastReviewed` alone.

- [ ] **Step 1: Write the failing test**

Create `scripts/lib/essentials-section.test.mjs`:

```js
// The section writer must be surgical: build-essentials.mjs rewrites a country
// guide whole, and running that to add a sixth topic would also rewrite the
// visa/transport/money prose the owner has already reviewed.
//
//   node --test scripts/lib/essentials-section.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectEol, findSection, upsertSection, stampSectionReviewed } from './essentials-section.mjs';

const GUIDE = [
  '---',
  'country: "Japan"',
  'title: "Japan Travel Essentials"',
  'lastReviewed: 2026-09-01',
  'draft: false',
  '---',
  '',
  '**Quick answer:** Visa-free for most, IC card for transport.',
  '',
  '## Visa & entry',
  '',
  'Ninety days visa-free for most Western passports.',
  '',
  '## Getting around',
  '',
  'IC cards work on almost every train and bus.',
  '',
  '## Money & costs',
  '',
  'Cash still matters outside the big chains.',
  '',
  '## Official sources',
  '',
  '- [Immigration](https://www.moj.go.jp/)',
  '',
].join('\n');

test('inserts a new section directly after Getting around', () => {
  const out = upsertSection(GUIDE, { heading: 'Luggage storage', body: 'Coin lockers sit in every major station.' });
  const order = [...out.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(order, ['Visa & entry', 'Getting around', 'Luggage storage', 'Money & costs', 'Official sources']);
  assert.match(out, /## Luggage storage\n\nCoin lockers sit in every major station\.\n\n## Money & costs/);
});

test('leaves every other section byte-identical', () => {
  const out = upsertSection(GUIDE, { heading: 'Luggage storage', body: 'Coin lockers.' });
  for (const untouched of [
    'country: "Japan"',
    'lastReviewed: 2026-09-01',
    '**Quick answer:** Visa-free for most, IC card for transport.',
    'Ninety days visa-free for most Western passports.',
    'IC cards work on almost every train and bus.',
    'Cash still matters outside the big chains.',
    '- [Immigration](https://www.moj.go.jp/)',
  ]) assert.ok(out.includes(untouched), `lost: ${untouched}`);
});

test('replaces in place on a second run and is idempotent', () => {
  const once = upsertSection(GUIDE, { heading: 'Luggage storage', body: 'First text.' });
  const twice = upsertSection(once, { heading: 'Luggage storage', body: 'Second text.' });
  const thrice = upsertSection(twice, { heading: 'Luggage storage', body: 'Second text.' });
  assert.equal((twice.match(/## Luggage storage/g) || []).length, 1);
  assert.ok(!twice.includes('First text.'));
  assert.equal(thrice, twice);
});

test('preserves CRLF guides', () => {
  const crlf = GUIDE.replace(/\n/g, '\r\n');
  const out = upsertSection(crlf, { heading: 'Luggage storage', body: 'Coin lockers.' });
  assert.equal(detectEol(out), '\r\n');
  assert.ok(!/[^\r]\n/.test(out), 'a bare LF crept into a CRLF file');
});

test('falls back to before Official sources when the anchor is missing', () => {
  const noAnchor = GUIDE.replace('## Getting around', '## Transport notes');
  const out = upsertSection(noAnchor, { heading: 'Luggage storage', body: 'Coin lockers.' });
  const order = [...out.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(order.slice(-2), ['Luggage storage', 'Official sources']);
});

test('appends when neither anchor exists', () => {
  const bare = '---\ncountry: "X"\n---\n\nBody only.\n';
  const out = upsertSection(bare, { heading: 'Luggage storage', body: 'Coin lockers.' });
  assert.match(out, /Body only\.\n\n## Luggage storage\n\nCoin lockers\.\n/);
});

test('findSection returns null for an absent heading', () => {
  assert.equal(findSection(GUIDE, 'Luggage storage'), null);
  assert.ok(findSection(GUIDE, 'Getting around'));
});

test('stampSectionReviewed records the section date without touching lastReviewed', () => {
  const out = stampSectionReviewed(GUIDE, 'luggage-storage', '2026-09-05');
  assert.match(out, /sectionsReviewed:\n  luggage-storage: 2026-09-05/);
  assert.match(out, /lastReviewed: 2026-09-01/);
  const again = stampSectionReviewed(out, 'luggage-storage', '2026-09-09');
  assert.match(again, /luggage-storage: 2026-09-09/);
  assert.equal((again.match(/sectionsReviewed:/g) || []).length, 1);
  const second = stampSectionReviewed(again, 'dietary', '2026-09-10');
  assert.match(second, /luggage-storage: 2026-09-09/);
  assert.match(second, /dietary: 2026-09-10/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /c/Users/user/wa-main && pwd && node --test scripts/lib/essentials-section.test.mjs`
Expected: FAIL — `Cannot find module './essentials-section.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `scripts/lib/essentials-section.mjs`:

```js
// ─────────────────────────────────────────────────────────────
//  ONE SECTION OF A COUNTRY ESSENTIALS GUIDE
//
//  build-essentials.mjs researches and writes a guide WHOLE. That is right for
//  a monthly refresh and wrong for adding a topic: the sixth topic (luggage
//  storage, 2026-09-05) would have rewritten visa, transport and money prose
//  that had already been reviewed. So section work goes through here — find the
//  heading, swap its body, and leave every other byte, including the file's
//  line endings, exactly as it was.
// ─────────────────────────────────────────────────────────────
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function detectEol(md) {
  return /\r\n/.test(md) ? '\r\n' : '\n';
}

/** Byte span of `## <heading>` up to the next H2 (or end of file), or null. */
export function findSection(md, heading) {
  const m = new RegExp(`^## ${escapeRe(heading)}[ \\t]*$`, 'm').exec(md);
  if (!m) return null;
  const bodyFrom = m.index + m[0].length;
  const rel = md.slice(bodyFrom).search(/^## /m);
  return { start: m.index, end: rel === -1 ? md.length : bodyFrom + rel };
}

export function upsertSection(md, { heading, body, anchorAfter = 'Getting around', fallbackBefore = 'Official sources' }) {
  const eol = detectEol(md);
  const text = String(body).trim().replace(/\r\n/g, '\n').replace(/\n/g, eol);
  const block = `## ${heading}${eol}${eol}${text}${eol}${eol}`;

  const existing = findSection(md, heading);
  if (existing) return md.slice(0, existing.start) + block + md.slice(existing.end);

  const anchor = findSection(md, anchorAfter);
  if (anchor) return md.slice(0, anchor.end) + block + md.slice(anchor.end);

  const before = findSection(md, fallbackBefore);
  if (before) return md.slice(0, before.start) + block + md.slice(before.start);

  return `${md.replace(/\s*$/, '')}${eol}${eol}${block}`;
}

/**
 * Per-section review date. The file-level `lastReviewed` means "the whole guide
 * was re-researched" and must keep that meaning, so a section refresh records
 * itself separately.
 */
export function stampSectionReviewed(md, slug, isoDate) {
  const eol = detectEol(md);
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  if (!fm) return md;
  const block = fm[1];
  const childRe = new RegExp(`^(\\s+)${escapeRe(slug)}: .*$`, 'm');

  if (/^sectionsReviewed:/m.test(block)) {
    const updated = childRe.test(block)
      ? block.replace(childRe, `$1${slug}: ${isoDate}`)
      : block.replace(/^sectionsReviewed:.*$/m, (line) => `${line}${eol}  ${slug}: ${isoDate}`);
    return md.slice(0, fm.index) + `---${eol}${updated}${eol}---` + md.slice(fm.index + fm[0].length);
  }
  const added = `${block}${eol}sectionsReviewed:${eol}  ${slug}: ${isoDate}`;
  return md.slice(0, fm.index) + `---${eol}${added}${eol}---` + md.slice(fm.index + fm[0].length);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /c/Users/user/wa-main && pwd && node --test scripts/lib/essentials-section.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 5: Allow the new frontmatter key**

Modify `src/content.config.ts` — in the `essentials` collection schema (around line 165), add one line after `lastReviewed`:

```ts
    lastReviewed: z.coerce.date(),
    // Per-section review dates (scripts/add-essentials-section.mjs). The
    // file-level lastReviewed still means "the whole guide was re-researched".
    sectionsReviewed: z.record(z.string(), z.coerce.date()).optional(),
```

- [ ] **Step 6: Verify nothing else broke**

Run: `cd /c/Users/user/wa-main && pwd && node --test scripts/lib/essentials-section.test.mjs scripts/lint-regex.test.mjs && node scripts/validate-content.mjs 2>&1 | tail -1`
Expected: tests pass; validator prints `✓ 1394 posts clean` (the count may differ — it must not print warnings).

- [ ] **Step 7: Commit**

```bash
cd /c/Users/user/wa-main && git add scripts/lib/essentials-section.mjs scripts/lib/essentials-section.test.mjs src/content.config.ts && git commit -m "feat: a writer that changes one section of a country guide and nothing else

build-essentials.mjs rewrites a guide whole, which is right for the monthly
refresh and wrong for adding a topic — it would rewrite prose already reviewed.
Sections now go through a pure upsert with its own review date.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Register the topic in all six places

Adding a topic today means six hand edits, and missing one fails silently — a hub nobody links to, or a card that 404s. The test comes first and drives the rest.

**Files:**
- Create: `scripts/essentials-topics-registered.test.mjs`
- Create: `src/content/essentials-topics/luggage-storage.md`
- Create: `src/pages/essentials/luggage-storage.astro`
- Create: `src/pages/[lang]/essentials/luggage-storage.astro`
- Modify: `src/components/EssentialsIndex.astro` (the `topics` array, around line 13)
- Modify: `src/pages/llms.txt.ts` (the essentials list, around line 71)
- Modify: `src/i18n/ui.ts` (five language blocks — `en` ~line 222, `ko` ~777, `ja` ~1324, `es` ~1871, `zh` ~2418)
- Modify: `scripts/build-icon-data.mjs` (the `MAP`, around line 24)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: the slug `luggage-storage` in `essentialsTopics`, which Task 3 writes country sections for and Task 5 translates.

- [ ] **Step 1: Write the failing test**

Create `scripts/essentials-topics-registered.test.mjs`:

```js
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
  }
});

test('each topic route reads its own entry', () => {
  for (const slug of slugs) {
    assert.ok(read(`src/pages/essentials/${slug}.astro`).includes(`'${slug}'`), `${slug}.astro loads a different entry`);
    assert.ok(read(`src/pages/[lang]/essentials/${slug}.astro`).includes(`'${slug}'`), `[lang]/${slug}.astro loads a different entry`);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /c/Users/user/wa-main && pwd && node --test scripts/essentials-topics-registered.test.mjs`
Expected: FAIL — `expected at least 6 topics, found 5`.

- [ ] **Step 3: Write the hub content**

Create `src/content/essentials-topics/luggage-storage.md`. No figures appear here on purpose: prices and locker sizes differ by country, and the country guides carry them with their sources.

```markdown
---
icon: luggage
metaTitle: "Luggage Storage: Lockers, Bag Drops & Where to Leave Bags"
metaDescription: "Station coin lockers, app-based bag drops, airport counters and hotel storage — how to leave your bags for a few hours or a few days, with a guide for each destination."
h1: "Luggage storage"
dek: "Where to leave your bags between check-out and your train."
quickAnswer: "Three options cover almost every trip: coin lockers at major stations, a shop or hotel that holds bags through an app-based network, and staffed counters at big airports. Your hotel will also usually hold bags on your arrival and departure days at no charge. Sizes, prices and how you pay differ by country — see your destination's guide below."
countryHeading: "Luggage storage, by country"
breadcrumbName: "Luggage storage"
disclosure: "Locker sizes, prices and opening hours are set by each operator and change; the country guides link the official pages so you can check before you rely on one."
faq:
  - q: "Can I leave my bags at the station?"
    a: "In much of East Asia, yes — coin lockers are a normal part of a big station, usually in a few sizes, and increasingly they take an IC card rather than coins. Elsewhere they are rarer, and a staffed left-luggage office or an app-based bag drop takes their place. Each country guide below says which of these you can expect."
  - q: "What if the lockers are full?"
    a: "This is common at the busiest stations on weekends and holidays. The usual fallbacks are the lockers one stop down the line, a staffed office in the same station, or a nearby shop signed up to a bag-drop network. Booking a bag-drop slot in advance is the only one of the three you can arrange before you arrive."
  - q: "Will my hotel hold my bags after check-out?"
    a: "Almost always, for guests, on the day you arrive and the day you leave — it is the simplest option and normally free. Ask at reception rather than assuming, and take anything valuable with you: hotels store bags in a back room, not a safe."
  - q: "How much does it cost?"
    a: "It depends on the country, the size of the bag and how long you leave it, so a single figure would be misleading. The country guides give the range that applies where you are going and link the operator's own page."
---

## Coin lockers at stations

In Japan, South Korea and Taiwan, coin lockers are part of the furniture of a
main station: banks of them in several sizes, near the ticket gates or on the
concourse. Payment has largely moved from coins to transit IC cards, which also
means the locker prints or displays a code rather than handing you a key. They
are charged by calendar day rather than by hour, so an overnight stay costs two
days, and most have a maximum stay of a few days before staff clear them.

## Bag drops in shops and hotels

Where lockers are scarce — most of Europe, much of Southeast Asia — the gap is
filled by networks that pay a shop, café or hotel to hold bags behind the
counter. You book a slot on a phone, walk in, and the staff tag your bag. The
practical differences from a locker: someone else is handling your bag, opening
hours are the shop's, and you can usually leave something larger than a locker
would take.

## Airport counters

Larger airports have a staffed baggage-service desk, useful on a long layover or
a night arrival before an early check-in. They are priced per bag per day and
are usually the most expensive of the three options, but they take oversized
items — skis, instruments, boxes — that nothing else will.

## Your hotel

The option people forget. Hotels hold bags for guests on arrival and departure
days, normally free, which covers the two moments when travellers most often go
looking for a locker. Two limits worth knowing: it is a store room rather than a
safe, so valuables go with you, and holding bags for a night you are not staying
is a favour, not a service — ask, don't assume.
```

- [ ] **Step 4: Add the icon**

Modify `scripts/build-icon-data.mjs` — add one line at the end of `MAP` (before the closing `};`):

```js
  // 2026-09-05: the sixth essentials topic, luggage storage.
  luggage: 'luggage',
```

Then run: `cd /c/Users/user/wa-main && pwd && node scripts/build-icon-data.mjs`
Expected: prints the icon count (one more than before) and rewrites `src/data/icons-line.json`.

- [ ] **Step 5: Add both routes**

Create `src/pages/essentials/luggage-storage.astro`:

```astro
---
import { getEntry } from 'astro:content';
import TopicHub from '../../components/TopicHub.astro';
const topic = await getEntry('essentialsTopics', 'luggage-storage');
---

<TopicHub topic={topic} translation={null} lang="en" />
```

Create `src/pages/[lang]/essentials/luggage-storage.astro`:

```astro
---
import { getEntry } from 'astro:content';
import TopicHub from '../../../components/TopicHub.astro';
import type { Lang } from '../../../i18n/utils';
export function getStaticPaths() {
  return (['ko', 'ja', 'es', 'zh'] as Lang[]).map((lang) => ({ params: { lang }, props: { lang } }));
}
const { lang } = Astro.props;
const topic = await getEntry('essentialsTopics', 'luggage-storage');
const translation = await getEntry('essentialsTopicsI18n', `${lang}/luggage-storage`);
---

<TopicHub topic={topic} translation={translation ?? null} lang={lang} />
```

- [ ] **Step 6: Add the card, the llms.txt line and the five ui strings**

Modify `src/components/EssentialsIndex.astro` — add one row to `topics`, after the transport row (luggage storage is a transport-day problem):

```js
  { href: '/essentials/luggage-storage', icon: 'luggage', h: 'ess.luggage', p: 'ess.luggageDek' },
```

Modify `src/pages/llms.txt.ts` — add one line after the "Getting around" line:

```
- [Luggage storage](${base}/essentials/luggage-storage): Station lockers, bag-drop apps, airport counters, hotel storage
```

Modify `src/i18n/ui.ts` — add both keys to each of the five language blocks, next to the existing `ess.transport` pair:

```ts
// en
    'ess.luggage': 'Luggage storage',
    'ess.luggageDek': 'Where to leave your bags between check-out and your train.',
// ko
    'ess.luggage': '짐 보관',
    'ess.luggageDek': '체크아웃하고 기차 시간까지, 가방을 어디에 맡길까.',
// ja
    'ess.luggage': '荷物預かり',
    'ess.luggageDek': 'チェックアウト後、列車の時間まで荷物をどこに預けるか。',
// es
    'ess.luggage': 'Consigna de equipaje',
    'ess.luggageDek': 'Dónde dejar las maletas entre la salida del hotel y el tren.',
// zh
    'ess.luggage': '行李寄存',
    'ess.luggageDek': '退房之后、上车之前，行李放在哪里。',
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd /c/Users/user/wa-main && pwd && node --test scripts/essentials-topics-registered.test.mjs scripts/lint-regex.test.mjs`
Expected: PASS.

- [ ] **Step 8: Prove the pages build**

Run: `cd /c/Users/user/wa-main && pwd && npx.cmd astro check 2>&1 | tail -5`
Expected: no errors referencing `luggage-storage`. (`astro check` reports pre-existing warnings elsewhere; only new ones matter.)

- [ ] **Step 9: Commit**

```bash
cd /c/Users/user/wa-main && git add scripts/essentials-topics-registered.test.mjs src/content/essentials-topics/luggage-storage.md src/pages/essentials/luggage-storage.astro "src/pages/[lang]/essentials/luggage-storage.astro" src/components/EssentialsIndex.astro src/pages/llms.txt.ts src/i18n/ui.ts scripts/build-icon-data.mjs src/data/icons-line.json && git commit -m "feat: luggage storage, the sixth essentials topic — hub, routes and a test that a topic is fully registered

Reddit demand research on 2026-09-05 (1,358 threads, counted by title) put
luggage storage first at 33 threads and we published nothing on it. Adding a
topic takes six edits that used to be made by hand; the test now fails when one
of them is missing.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The section generator, proven on Japan

**Files:**
- Create: `scripts/add-essentials-section.mjs`
- Modify: `src/content/essentials/japan.md` (generated)

**Interfaces:**
- Consumes: `upsertSection`, `stampSectionReviewed` from Task 1; the slug from Task 2.
- Produces: `## Luggage storage` sections in country guides; env contract `SECTION=<slug> COUNTRY=<name> FORCE=1 DRY=1`.

- [ ] **Step 1: Write the script**

Create `scripts/add-essentials-section.mjs`:

```js
#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  ADD ONE SECTION TO EVERY COUNTRY ESSENTIALS GUIDE
//
//  build-essentials.mjs researches a whole guide and rewrites the file. That is
//  the wrong tool for adding a topic to guides whose other sections have been
//  reviewed, so this script researches ONE section and swaps only that.
//
//  Every section ends with official links, and a section whose links do not
//  answer is discarded rather than published — an unverifiable left-luggage
//  price is exactly the class of invented detail the 2026-09 repairs removed.
//
//    node scripts/add-essentials-section.mjs                    # all active countries
//    COUNTRY=Japan node scripts/add-essentials-section.mjs      # one
//    DRY=1 COUNTRY=Japan node scripts/add-essentials-section.mjs
//    SECTION=luggage-storage FORCE=1 node scripts/add-essentials-section.mjs
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { HOUSE_STYLE } from './lib/prose-style.mjs';
import { upsertSection, findSection, stampSectionReviewed } from './lib/essentials-section.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIR = join(ROOT, 'src', 'content', 'essentials');
const COUNTRIES_FILE = join(ROOT, 'data', 'countries.json');
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.WRITER_MODEL || 'claude-sonnet-5';
const DRY = process.env.DRY === '1';
const FORCE = process.env.FORCE === '1';
const SECTION = process.env.SECTION || 'luggage-storage';
const UA = 'Mozilla/5.0 (compatible; WanderAtlasBot/1.0; +https://wanderatlasguides.com)';

// One entry per topic. The next topics (dietary needs, travelling with kids)
// are added here, not by copying this script.
const SECTIONS = {
  'luggage-storage': {
    heading: 'Luggage storage',
    brief: (country) =>
      `Where a traveller in ${country} can leave bags for a few hours or a few days. Cover only what applies there: ` +
      `station coin lockers (which stations, what sizes, how you pay), staffed left-luggage offices, app-based bag drops ` +
      `in shops (name the network only if it operates in ${country}), airport baggage counters, and whether hotels hold bags.`,
  },
};

async function research(country, spec) {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
    messages: [{
      role: 'user',
      content:
        `Write ONE section of a travel guide for international visitors to ${country}, current as of ${new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })}. ` +
        `Use web search to confirm what is actually available there.\n\n` +
        `Subject: ${spec.brief(country)}\n\n` +
        `Rules:\n` +
        `- 120–200 words of GitHub-flavored Markdown. NO heading line — the section heading is added for you.\n` +
        `- Prices as a RANGE with the currency ("about ¥400–800 a day"), never a single exact figure, and only when a source states it.\n` +
        `- Name an operator or network ONLY if your source shows it serves ${country}.\n` +
        `- End with a line "Sources:" followed by 1–3 markdown links to official operator, airport or government pages. ` +
        `Not blogs, not aggregators, not affiliate sites.\n` +
        `- If you cannot verify how this works in ${country}, reply with exactly: INSUFFICIENT\n` +
        `- No preamble. Output only the section text.\n` +
        HOUSE_STYLE,
    }],
  });
  if (msg.stop_reason === 'max_tokens') throw new Error('cut off mid-sentence');
  let text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  text = text.replace(/^```(markdown)?\n/i, '').replace(/\n```\s*$/i, '').trim();
  // A web-search run interleaves the model's working notes between tool calls
  // ("Let me search for..."). The section proper starts at the first line that
  // is not one of those; drop anything before a line ending in a full stop that
  // reads as prose is unreliable, so instead cut at the first paragraph that
  // survives the checks below — simplest reliable rule: drop leading lines that
  // start with "Let me", "I'll", "Now ", "Based on".
  text = text.replace(/^(?:(?:Let me|I'll|I will|Now|Based on|Searching)[^\n]*\n+)+/i, '').trim();
  return text;
}

function linksIn(md) {
  return [...md.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]);
}

async function linkAlive(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    return res.ok;
  } catch { return false; }
}

async function main() {
  const spec = SECTIONS[SECTION];
  if (!spec) throw new Error(`unknown SECTION "${SECTION}" — known: ${Object.keys(SECTIONS).join(', ')}`);
  const { countries } = JSON.parse(await readFile(COUNTRIES_FILE, 'utf8'));
  const only = process.env.COUNTRY;
  const active = countries.filter((c) => c.active && (!only || c.name === only));
  const today = new Date().toISOString().slice(0, 10);

  console.log(`\n🧳  ${spec.heading} — ${active.length} countr${active.length === 1 ? 'y' : 'ies'}${DRY ? ' (DRY)' : ''}\n`);
  let written = 0, skipped = 0, refused = 0;

  for (const c of active) {
    const file = join(DIR, `${c.slug}.md`);
    if (!existsSync(file)) { console.log(`  ⏭️   ${c.name} — no guide yet`); skipped++; continue; }
    const md = await readFile(file, 'utf8');
    if (!FORCE && findSection(md, spec.heading)) { console.log(`  ⏭️   ${c.name} — already has the section`); skipped++; continue; }

    let text;
    try { text = await research(c.name, spec); }
    catch (e) { console.log(`  ❌  ${c.name} — ${e.message}`); refused++; continue; }

    if (/^INSUFFICIENT$/im.test(text)) { console.log(`  ✋  ${c.name} — nothing verifiable, skipped`); refused++; continue; }

    const urls = linksIn(text);
    if (!urls.length) { console.log(`  ✋  ${c.name} — no sources, skipped`); refused++; continue; }
    const alive = [];
    for (const u of urls) if (await linkAlive(u)) alive.push(u);
    if (!alive.length) { console.log(`  ✋  ${c.name} — every source link failed, skipped`); refused++; continue; }
    if (alive.length < urls.length) {
      for (const dead of urls.filter((u) => !alive.includes(u))) {
        text = text.split('\n').filter((line) => !line.includes(dead)).join('\n');
      }
    }

    if (DRY) { console.log(`  📄  ${c.name}\n${text.replace(/^/gm, '      ')}\n`); written++; continue; }
    const next = stampSectionReviewed(upsertSection(md, { heading: spec.heading, body: text }), SECTION, today);
    await writeFile(file, next, 'utf8');
    console.log(`  ✓   ${c.name} — ${text.split(/\s+/).length} words, ${alive.length} source${alive.length === 1 ? '' : 's'}`);
    written++;
  }
  console.log(`\nSECTION_SUMMARY section=${SECTION} written=${written} skipped=${skipped} refused=${refused}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Dry-run Japan and read the output yourself**

Run: `cd /c/Users/user/wa-main && pwd && DRY=1 COUNTRY=Japan node scripts/add-essentials-section.mjs`
Expected: one section printed, 120–200 words, prices as ranges, a `Sources:` line with links.
Check by eye before continuing: does every claim have a source, and is there any single exact price? If yes to the second, stop and tighten the prompt rule rather than proceeding.

- [ ] **Step 3: Write Japan for real**

Run: `cd /c/Users/user/wa-main && pwd && COUNTRY=Japan node scripts/add-essentials-section.mjs`
Expected: `SECTION_SUMMARY section=luggage-storage written=1 skipped=0 refused=0`.

- [ ] **Step 4: Verify the file changed only where it should**

Run: `cd /c/Users/user/wa-main && pwd && git diff --stat src/content/essentials/japan.md && git diff src/content/essentials/japan.md | grep -c "^-" `
Expected: one file changed; the count of removed lines is **0 or 1** (0 when the section is new; the only permissible removal is the frontmatter line that `sectionsReviewed` is inserted after — inspect `git diff` and confirm no prose line was removed).

Run: `cd /c/Users/user/wa-main && pwd && grep -n "^## " src/content/essentials/japan.md`
Expected: `## Luggage storage` sits between `## Getting around` and `## Money & costs`.

- [ ] **Step 5: Run the validators**

Run: `cd /c/Users/user/wa-main && pwd && node --test scripts/lint-regex.test.mjs && node scripts/validate-content.mjs 2>&1 | tail -3`
Expected: tests pass, validator reports no warnings.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/user/wa-main && git add scripts/add-essentials-section.mjs src/content/essentials/japan.md && git commit -m "feat: research one section at a time, and prove it on Japan

Sections are written by their own script so a topic can be added without
re-running the whole-guide writer. A section whose sources do not answer is
discarded, not published.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 7: Stop for review**

Print the new Japan section and hand it to the owner (Pixer) before touching the other 19 countries:

Run: `cd /c/Users/user/wa-main && pwd && sed -n "/^## Luggage storage/,/^## /p" src/content/essentials/japan.md`

Do not start Task 4 until the owner has approved the Japan text.

---

### Task 4: The remaining 19 countries

**Files:**
- Modify: `src/content/essentials/*.md` (all active countries except Japan)

**Interfaces:**
- Consumes: the script and slug from Task 3.
- Produces: `## Luggage storage` in every country guide where sources could be verified.

- [ ] **Step 1: Run the generator for everything left**

Run: `cd /c/Users/user/wa-main && pwd && node scripts/add-essentials-section.mjs 2>&1 | tail -25`
Expected: Japan skipped ("already has the section"); a line per country; a final `SECTION_SUMMARY`. Countries with unverifiable sources appear as `✋` and have no section — that is the designed outcome, not a failure.

- [ ] **Step 2: Check the shape of every generated section**

Run:

```bash
cd /c/Users/user/wa-main && pwd && node -e "
const fs=require('fs');const m=require('gray-matter');const dir='src/content/essentials/';
let withSection=0, noSource=0, exact=[];
for (const f of fs.readdirSync(dir)) {
  const md = fs.readFileSync(dir+f,'utf8');
  const i = md.indexOf('## Luggage storage');
  if (i === -1) continue;
  withSection++;
  const rel = md.slice(i).split(/^## /m)[0];
  if (!/\]\(https?:/.test(rel)) { noSource++; console.log('NO SOURCE', f); }
  const single = rel.match(/(?:[¥\$€£₩฿]|USD |EUR )\s?\d[\d,.]*(?!\s?[–-])/g);
  if (single) exact.push(f + ' → ' + single.join(', '));
  const words = rel.split(/\s+/).length;
  if (words < 80 || words > 260) console.log('LENGTH', f, words);
  if (!m(md).data.sectionsReviewed) console.log('NO REVIEW DATE', f);
}
console.log('sections', withSection, 'without source', noSource);
console.log(exact.length ? 'EXACT PRICES (check each):\n  ' + exact.join('\n  ') : 'no single exact prices');
"
```

Expected: every section has a source link and a review date; lengths inside 80–260 words. Any line under `EXACT PRICES` is a judgement call — open that country's section and confirm the figure is a fixed official fee (a locker that costs exactly ¥500 is fine); rewrite the section by hand or re-run that country with `FORCE=1` if it is a made-up midpoint.

- [ ] **Step 3: Run the validators**

Run: `cd /c/Users/user/wa-main && pwd && node scripts/validate-content.mjs 2>&1 | tail -3 && node scripts/audit-translations.mjs 2>&1 | tail -1`
Expected: no warnings from either.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/user/wa-main && git add src/content/essentials && git commit -m "content: luggage storage in every country guide that could be sourced

Countries whose sources could not be verified were skipped rather than filled
with hedged prose.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Translations

**Files:**
- Create: `src/content/essentials-topics-i18n/{ko,ja,es,zh}/luggage-storage.md` (generated)
- Modify: `src/content/essentials-i18n/**` (generated — the country guides whose source hash changed)

**Interfaces:**
- Consumes: the hub from Task 2 and the country sections from Tasks 3–4.
- Produces: five-language coverage for both.

- [ ] **Step 1: See what is queued**

Run: `cd /c/Users/user/wa-main && pwd && node scripts/translate-topics.mjs --dry 2>&1 | tail -4`
Expected: 4 jobs — `ko/ja/es/zh` of `luggage-storage` — listed as missing.

- [ ] **Step 2: Translate the hub**

Run: `cd /c/Users/user/wa-main && pwd && node scripts/translate-topics.mjs 2>&1 | tail -3`
Expected: `done=4 failed=0`.

- [ ] **Step 3: Translate the country guides**

Run: `cd /c/Users/user/wa-main && pwd && node scripts/translate-essentials.mjs 2>&1 | tail -3`
Expected: the countries changed in Tasks 3–4 are re-translated; failures are reported, not silent.

- [ ] **Step 4: Check the translations landed**

Run:

```bash
cd /c/Users/user/wa-main && pwd && for l in ko ja es zh; do
  f="src/content/essentials-topics-i18n/$l/luggage-storage.md"
  [ -f "$f" ] && echo "$l ok $(grep -c 'srcHash' $f)" || echo "$l MISSING"
done && node scripts/audit-translations.mjs 2>&1 | tail -1
```

Expected: four `ok 1` lines and no wrong-language findings.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/user/wa-main && git add src/content/essentials-topics-i18n src/content/essentials-i18n && git commit -m "content: luggage storage in ko/ja/es/zh (hub and country guides)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Push once, then verify on the live site

**Files:** none changed; this task publishes and checks.

- [ ] **Step 1: Run the whole relevant test set one more time**

Run: `cd /c/Users/user/wa-main && pwd && node --test scripts/lib/essentials-section.test.mjs scripts/essentials-topics-registered.test.mjs scripts/lint-regex.test.mjs && node scripts/validate-content.mjs 2>&1 | tail -1`
Expected: all pass, validator clean.

- [ ] **Step 2: Push**

```bash
cd /c/Users/user/wa-main && git pull -q --rebase origin main && git push -q origin main && git status -sb | head -1
```
Expected: `## main...origin/main` with no "ahead".

- [ ] **Step 3: Wait for the deploy, then check the live pages**

The build takes 50–100 minutes. Poll rather than guess:

```bash
for i in $(seq 1 45); do
  s=$(curl -s -A "Mozilla/5.0" -o /dev/null -w "%{http_code}" https://wanderatlasguides.com/essentials/luggage-storage/)
  echo "$(date +%H:%M:%S) hub=$s"; [ "$s" = "200" ] && break; sleep 120
done
```

- [ ] **Step 4: Verify all five languages, the card and a country section**

```bash
UA="Mozilla/5.0"
for p in "" ko/ ja/ es/ zh/; do
  curl -s -A "$UA" -o /dev/null -w "$p%{http_code}\n" "https://wanderatlasguides.com/${p}essentials/luggage-storage/"
done
curl -s -A "$UA" https://wanderatlasguides.com/essentials/ | grep -c "luggage-storage"
curl -s -A "$UA" https://wanderatlasguides.com/essentials/japan/ | grep -c "Luggage storage"
curl -s -A "$UA" https://wanderatlasguides.com/ko/essentials/luggage-storage/ | grep -o "<title>[^<]*"
```

Expected: five `200`s, the index links the topic, the Japan guide shows the section, the Korean title is Korean.

- [ ] **Step 5: Verify every source link we published is alive**

```bash
cd /c/Users/user/wa-main && pwd && node -e "
const fs=require('fs');const dir='src/content/essentials/';const urls=new Set();
for (const f of fs.readdirSync(dir)) {
  const md=fs.readFileSync(dir+f,'utf8');const i=md.indexOf('## Luggage storage');
  if(i===-1)continue;
  for(const m of md.slice(i).split(/^## /m)[0].matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) urls.add(m[1]);
}
(async()=>{let bad=0;for(const u of urls){try{const r=await fetch(u,{headers:{'User-Agent':'Mozilla/5.0'}});if(!r.ok){bad++;console.log(r.status,u);}}catch{bad++;console.log('ERR',u);}}
console.log('links',urls.size,'bad',bad);})()"
```

Expected: `bad 0`. A link that has died since generation is fixed by re-running that country with `FORCE=1`.

- [ ] **Step 6: Record the outcome**

Append one line to `C:/Users/user/Desktop/클로드/작업장부-2026-09-02-미룬것.md` under `## 진행 기록` with the date, the commit range, the number of countries that got a section, and the number skipped for want of sources.

---

## Self-Review

**Spec coverage:** hub page (Task 2) · per-country section (Tasks 3–4) · section-only writer that preserves reviewed prose (Task 1) · `sectionsReviewed` frontmatter (Task 1 Step 5) · registration test for the six edit sites (Task 2) · price ranges, link verification and skip-rather-than-hedge (Task 3 Step 1) · unit/integration/live testing (Tasks 1, 2, 5, 6) · Japan-first rollout with an owner gate (Task 3 Step 7) · single push (Task 6). Every section of the spec maps to a task.

**Placeholders:** none — each step carries the code or command it needs.

**Type consistency:** `upsertSection`, `findSection`, `stampSectionReviewed` are defined in Task 1 and used with those exact names and argument shapes in Task 3. The slug `luggage-storage` and the heading `Luggage storage` are distinct on purpose (slug for file names and the frontmatter map, heading for the H2) and used consistently.
