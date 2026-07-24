# Newsletter Automation — Plan 1: Interest Capture & Email Renderer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture each subscriber's region + language at signup, and build a tested engine that renders magazine-quality, per-language, image-guarded, no-repeat weekly newsletter HTML from the site's real posts and events — all offline, with no MailerLite token required.

**Architecture:** Pure Node libraries (`scripts/lib/newsletter-*.mjs`) do content selection and HTML rendering; a `newsletter-dry-run.mjs` CLI turns them into reviewable `.html` files from real repo content. The image-mismatch guard is extracted into a shared module so the publish gate and the newsletter reuse one rule. Signup capture adds hidden `region`/`lang`/`source` fields to the existing MailerLite embed form (no token, double opt-in preserved). MailerLite network delivery (sending, subscriber reads, reports, backup) is deliberately **out of scope** — it is Plan 2, gated on the owner generating a MailerLite API token.

**Tech Stack:** Node ≥18 (built-in `node --test` runner, built-in `fetch`), `gray-matter` (already a dependency) for frontmatter, Astro components, plain inline-CSS HTML for email.

## Global Constraints

- **No new runtime dependencies.** Use `gray-matter` (already present) and Node built-ins only. Tests use `node --test` + `node:assert/strict` — no jest/vitest.
- **Languages:** `en`, `ko`, `ja`, `es`, `zh`. Every reader-facing string in an email must come from the copy module, never hardcoded English.
- **Brand palette (email):** cream `#f7f3ec`, tint `#f1ebe0`, ink `#201c17`, ink-soft `#4a443c`, vermilion `#c8443a`, vermilion-deep `#a5352c`, gold `#b8862f`. Serif headings (Georgia), sans body (Helvetica/Arial).
- **Privacy:** no subscriber email address ever appears in repo files or logs produced by this plan. (This plan handles content only; it never reads subscriber lists.)
- **Every email** must contain a preheader line and an unsubscribe link.
- **Never resend:** a post or event already recorded in the sent-log for an audience must not appear again for that audience.
- **Times in KST** when a task references scheduling or dates in prose.
- **Design of record:** the approved editorial layout in `docs/superpowers/specs/2026-07-25-newsletter-automation-design.md` (§4.3) and the mockups in `.superpowers/brainstorm/614-1784908829/content/editorial-full.html`.

---

## File Structure

- Create `scripts/lib/offtopic.mjs` — shared off-topic hero guard (regex + `isOffTopicHero`).
- Modify `scripts/validate-content.mjs` — import the shared guard instead of its inline copy (DRY).
- Create `scripts/lib/newsletter-copy.mjs` — 5-language email string tables.
- Create `scripts/lib/newsletter-content.mjs` — post loading, edition selection, sent-log helpers.
- Create `scripts/lib/newsletter-render.mjs` — edition → `{subject, preheader, html}`.
- Create `scripts/newsletter-dry-run.mjs` — CLI that writes preview HTML from real content.
- Create `data/newsletter-sent-log.json` — `{}` seed (audience → sent slugs).
- Create tests: `scripts/lib/offtopic.test.mjs`, `scripts/lib/newsletter-content.test.mjs`, `scripts/lib/newsletter-render.test.mjs`.
- Create `src/lib/interest.ts` — pure helper turning page context into signup field values.
- Create `src/lib/interest.test.mjs` — its unit test.
- Modify `src/components/Newsletter.astro` — hidden `region`/`lang`/`source` fields + submit wiring.
- Modify `.gitignore` — ignore `.newsletter-preview/`.
- Modify `package.json` — add `"test": "node --test"`.

---

## Task 1: Add the test runner script

**Files:**
- Modify: `package.json` (scripts block)

**Interfaces:**
- Produces: `npm test` → runs `node --test` across the repo.

- [ ] **Step 1: Add the script**

In `package.json`, add to `"scripts"` (after `"refresh"`):

```json
"test": "node --test"
```

- [ ] **Step 2: Run it to confirm the runner works (no tests yet)**

Run: `npm test`
Expected: exits 0 with "tests 0" (or "no test files found") — the runner is wired.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add node --test runner script"
```

---

## Task 2: Extract the shared off-topic hero guard

**Files:**
- Create: `scripts/lib/offtopic.mjs`
- Test: `scripts/lib/offtopic.test.mjs`
- Modify: `scripts/validate-content.mjs` (replace inline OFFTOPIC with the import)

**Interfaces:**
- Produces:
  - `export const OFFTOPIC: RegExp`
  - `export function isOffTopicHero(hero: {url?:string, credit?:string, license?:string} | null): boolean` — `true` when the hero is unusable (missing, placeholder, or a keyword-collision Wikimedia file); `false` for curated sources and clean Wikimedia.

- [ ] **Step 1: Write the failing test**

Create `scripts/lib/offtopic.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { isOffTopicHero } from './offtopic.mjs';

test('rejects a moth-specimen wikimedia hero', () => {
  assert.equal(isOffTopicHero({ url: 'https://upload.wikimedia.org/x/Ambulyx_MHNT.ZOO.jpg', credit: 'MHNT', license: 'wikimedia' }), true);
});
test('rejects a dune-bashing wikimedia hero', () => {
  assert.equal(isOffTopicHero({ url: 'https://upload.wikimedia.org/x/Dune_bashing_Dubai.jpg', credit: '', license: 'wikimedia' }), true);
});
test('accepts a clean wikimedia hero', () => {
  assert.equal(isOffTopicHero({ url: 'https://upload.wikimedia.org/x/Burj_Khalifa_2023.jpg', credit: 'x', license: 'wikimedia' }), false);
});
test('accepts a curated unsplash hero', () => {
  assert.equal(isOffTopicHero({ url: 'https://images.unsplash.com/photo-1512453979798', credit: 'x', license: 'unsplash' }), false);
});
test('rejects a placeholder', () => {
  assert.equal(isOffTopicHero({ url: '/img/placeholder.jpg', license: 'placeholder' }), true);
});
test('rejects when there is no image', () => {
  assert.equal(isOffTopicHero(null), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/lib/offtopic.test.mjs`
Expected: FAIL — cannot find module `./offtopic.mjs`.

- [ ] **Step 3: Write the implementation**

Create `scripts/lib/offtopic.mjs`:

```js
// Shared "off-topic hero image" guard. A keyword-collision Wikimedia file whose
// subject is clearly unrelated to a venue — a moth specimen, a dune-bashing car,
// US-Navy admirals, a museum statue. Extracted from validate-content.mjs so the
// publish gate AND the newsletter renderer reject the exact same bad heroes.
export const OFFTOPIC = /_MHNT|\bAmbulyx\b|\bTheretra\b|Sphingidae|Lepidoptera|Dune_bashing|\bambulance\b|U\.?S\.?_?Navy|Vice[_-]?Admiral|_admiral|Orphanage|cosplay|SMASH_20|British_Museum|_inscription|inscription_from|Google_Art_Project|geograph\.org\.uk|Oxomoco|Ketchikan|_Glencoe/i;

// True when a hero image is unusable for a card. Missing images and placeholders
// are always unusable. Only Wikimedia heroes carry keyword-collision risk;
// google-places / unsplash / kto-open are curated and always pass.
export function isOffTopicHero(hero) {
  if (!hero || !hero.url) return true;
  if (hero.license === 'placeholder') return true;
  if (hero.license !== 'wikimedia') return false;
  const hay = decodeURIComponent(hero.url) + ' ' + (hero.credit || '');
  return OFFTOPIC.test(hay);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/lib/offtopic.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Point validate-content.mjs at the shared guard (DRY)**

In `scripts/validate-content.mjs`, delete the inline `const OFFTOPIC = /…/i;` line (currently ~line 89) and add to the imports at the top (after the `unsplashNum` import):

```js
import { OFFTOPIC } from './lib/offtopic.mjs';
```

- [ ] **Step 6: Verify the gate still runs unchanged**

Run: `node scripts/validate-content.mjs`
Expected: same output as before (currently "0 duplicate images, 9 mismatch-suspects…"); exit code unchanged.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/offtopic.mjs scripts/lib/offtopic.test.mjs scripts/validate-content.mjs
git commit -m "refactor: extract shared off-topic hero guard, reuse in validate-content"
```

---

## Task 3: Email copy tables (5 languages)

**Files:**
- Create: `scripts/lib/newsletter-copy.mjs`

**Interfaces:**
- Produces:
  - `export const LANGS = ['en','ko','ja','es','zh']`
  - `export function copyFor(lang): object` — returns the string table for `lang`, falling back to `en`. Keys: `subjectSingle`, `preheaderSingle`, `editorNote`, `sectionLabel`, `eventsLabel`, `ctaSingle`, `alsoNew`, `read`, `unsubscribe`, `langLabel`, `regionChange`. Templated values use `{region}` / `{country}` placeholders.
  - `export function fill(str, vars): string` — replaces `{key}` with `vars[key]`.

- [ ] **Step 1: Write the implementation** (no separate test file; exercised by the render test in Task 5)

Create `scripts/lib/newsletter-copy.mjs`:

```js
export const LANGS = ['en', 'ko', 'ja', 'es', 'zh'];

const COPY = {
  en: { subjectSingle: 'This week in {region}', preheaderSingle: 'New guides from {region}, just published →', editorNote: "Every week we send you only the new guides from the place you follow. Here's {region}, freshly published.", sectionLabel: "This week's guides", eventsLabel: 'Upcoming events', ctaSingle: 'Explore all {region} guides', alsoNew: 'Also new across {country}', read: 'Read the guide →', unsubscribe: 'Unsubscribe', langLabel: 'Language', regionChange: 'Change your region' },
  ko: { subjectSingle: '이번 주 {region} 소식', preheaderSingle: '{region}에서 새로 발행된 가이드 →', editorNote: '매주 관심 지역의 새 글만 모아 보내드려요. 이번 주 {region} 소식입니다.', sectionLabel: '이번 주의 가이드', eventsLabel: '다가오는 이벤트', ctaSingle: '{region} 가이드 전체 보기', alsoNew: '{country}의 다른 새 글', read: '가이드 읽기 →', unsubscribe: '구독 취소', langLabel: '언어', regionChange: '지역 변경' },
  ja: { subjectSingle: '今週の{region}', preheaderSingle: '{region}の新着ガイド →', editorNote: '毎週、フォロー中の地域の新着ガイドだけをお届けします。今週の{region}です。', sectionLabel: '今週のガイド', eventsLabel: '近日開催のイベント', ctaSingle: '{region}のガイドをすべて見る', alsoNew: '{country}のその他の新着', read: 'ガイドを読む →', unsubscribe: '配信停止', langLabel: '言語', regionChange: '地域を変更' },
  es: { subjectSingle: 'Esta semana en {region}', preheaderSingle: 'Nuevas guías de {region}, recién publicadas →', editorNote: 'Cada semana te enviamos solo las guías nuevas del lugar que sigues. Aquí tienes {region}.', sectionLabel: 'Las guías de esta semana', eventsLabel: 'Próximos eventos', ctaSingle: 'Ver todas las guías de {region}', alsoNew: 'También nuevo en {country}', read: 'Leer la guía →', unsubscribe: 'Cancelar suscripción', langLabel: 'Idioma', regionChange: 'Cambiar región' },
  zh: { subjectSingle: '本周{region}', preheaderSingle: '{region}最新发布的攻略 →', editorNote: '我们每周只为你发送所关注地区的最新攻略。这是本周的{region}。', sectionLabel: '本周攻略', eventsLabel: '即将举行的活动', ctaSingle: '查看{region}的全部攻略', alsoNew: '{country}的其他新内容', read: '阅读攻略 →', unsubscribe: '取消订阅', langLabel: '语言', regionChange: '更换地区' },
};

export function copyFor(lang) {
  return COPY[lang] || COPY.en;
}

export function fill(str, vars = {}) {
  return String(str).replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : `{${k}}`));
}
```

- [ ] **Step 2: Sanity-check it loads**

Run: `node -e "import('./scripts/lib/newsletter-copy.mjs').then(m=>console.log(m.fill(m.copyFor('ko').subjectSingle,{region:'두바이'})))"`
Expected: prints `이번 주 두바이 소식`.

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/newsletter-copy.mjs
git commit -m "feat: 5-language newsletter copy tables"
```

---

## Task 4: Edition content selection + sent-log helpers

**Files:**
- Create: `scripts/lib/newsletter-content.mjs`
- Test: `scripts/lib/newsletter-content.test.mjs`

**Interfaces:**
- Consumes: `isOffTopicHero` from `./offtopic.mjs`.
- Produces:
  - `export function loadPosts(dir): Array<{slug, data}>` — reads `*.md`, parses frontmatter with gray-matter, skips `draft: true`.
  - `export function audienceKey(regionSlug, lang): string` — `"<regionSlug|__global__>:<lang>"`.
  - `export function sentSetFor(log, key): Set<string>` — union of `posts` + `events` slugs recorded for that key.
  - `export function pickSingleRegionEdition({ posts, region, country, sent, now, minStories }): Edition | null`
    - `Edition = { hero:{slug,title,category,image,region}, stories:[{slug,title,category,image}], events:[{slug,title,date,region}], usedPostSlugs:string[], usedEventSlugs:string[], country }`
    - Returns `null` when no post with a clean hero is available (→ audience skipped).

- [ ] **Step 1: Write the failing test**

Create `scripts/lib/newsletter-content.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/lib/newsletter-content.test.mjs`
Expected: FAIL — cannot find module `./newsletter-content.mjs`.

- [ ] **Step 3: Write the implementation**

Create `scripts/lib/newsletter-content.mjs`:

```js
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { isOffTopicHero } from './offtopic.mjs';

const MAX_STORIES = 4;   // hero + up to 3 more cards
const MAX_EVENTS = 3;

export function loadPosts(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const { data } = matter(readFileSync(join(dir, f), 'utf8'));
      return { slug: f.replace(/\.md$/, ''), data };
    })
    .filter((p) => !p.data.draft);
}

export function audienceKey(regionSlug, lang) {
  return `${regionSlug || '__global__'}:${lang}`;
}

export function sentSetFor(log, key) {
  const rec = log[key] || {};
  return new Set([...(rec.posts || []), ...(rec.events || [])]);
}

const eq = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
const byPubDesc = (a, b) => new Date(b.data.pubDate) - new Date(a.data.pubDate);

function card(p) {
  return { slug: p.slug, title: p.data.title, category: p.data.category, image: p.data.heroImage, region: p.data.region };
}

// Selection for ONE single-region audience. Pure: takes an already-loaded posts
// array so it is fully unit-testable. `sent` is a Set of slugs to exclude.
export function pickSingleRegionEdition({ posts, region, country, sent, now, minStories = 3 }) {
  const usable = (p) =>
    p.data.category !== 'event' &&
    !sent.has(p.slug) &&
    !isOffTopicHero(p.data.heroImage);

  const inRegion = posts.filter((p) => usable(p) && eq(p.data.region, region)).sort(byPubDesc);
  let chosen = inRegion.slice(0, MAX_STORIES);

  // Country top-up when the region alone is thin.
  if (chosen.length < minStories) {
    const chosenSlugs = new Set(chosen.map((p) => p.slug));
    const inCountry = posts
      .filter((p) => usable(p) && !chosenSlugs.has(p.slug) && eq(p.data.country, country) && !eq(p.data.region, region))
      .sort(byPubDesc);
    chosen = chosen.concat(inCountry).slice(0, MAX_STORIES);
  }

  if (chosen.length === 0) return null; // no clean hero → skip this audience

  const events = posts
    .filter((p) =>
      p.data.category === 'event' &&
      !sent.has(p.slug) &&
      p.data.eventStartDate &&
      new Date(p.data.eventStartDate) >= now &&
      (eq(p.data.region, region) || eq(p.data.country, country)))
    .sort((a, b) => new Date(a.data.eventStartDate) - new Date(b.data.eventStartDate))
    .slice(0, MAX_EVENTS)
    .map((p) => ({ slug: p.slug, title: p.data.title, date: p.data.eventStartDate, region: p.data.region }));

  const [hero, ...stories] = chosen.map(card);
  return {
    hero,
    stories,
    events,
    country,
    usedPostSlugs: chosen.map((p) => p.slug),
    usedEventSlugs: events.map((e) => e.slug),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/lib/newsletter-content.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/newsletter-content.mjs scripts/lib/newsletter-content.test.mjs
git commit -m "feat: newsletter edition selection with image guard, country top-up, events, dedup"
```

---

## Task 5: Editorial HTML renderer

**Files:**
- Create: `scripts/lib/newsletter-render.mjs`
- Test: `scripts/lib/newsletter-render.test.mjs`

**Interfaces:**
- Consumes: `copyFor`, `fill` from `./newsletter-copy.mjs`; an `Edition` from Task 4.
- Produces:
  - `export function renderSingleRegion({ edition, region, lang, links }): { subject, preheader, html }`
    - `links = { cta, unsubscribe, prefs, story:(slug)=>url, event:(slug)=>url }`
    - `html` is a complete inline-CSS email document (editorial design of record).

- [ ] **Step 1: Write the failing test**

Create `scripts/lib/newsletter-render.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSingleRegion } from './newsletter-render.mjs';

const edition = {
  hero: { slug: 'al-khayma', title: 'Al Khayma Heritage Restaurant', category: 'restaurant', image: { url: 'https://images.unsplash.com/photo-hero', credit: 'c' } },
  stories: [{ slug: 'marina', title: 'Dubai Marina at Golden Hour', category: 'attraction', image: { url: 'https://images.unsplash.com/photo-2', credit: 'c' } }],
  events: [{ slug: 'expo', title: 'Dubai Food Festival', date: new Date('2026-08-10'), region: 'Dubai' }],
  country: 'UAE',
  usedPostSlugs: ['al-khayma', 'marina'],
  usedEventSlugs: ['expo'],
};
const links = { cta: 'https://x/regions/dubai', unsubscribe: 'https://x/unsub', prefs: 'https://x/prefs', story: (s) => `https://x/${s}`, event: (s) => `https://x/${s}` };

test('subject and preheader are localized', () => {
  const { subject, preheader } = renderSingleRegion({ edition, region: 'Dubai', lang: 'ko', links });
  assert.equal(subject, '이번 주 두바이 소식'.replace('두바이', 'Dubai')); // region label passed through as-is
  assert.match(preheader, /Dubai/);
});

test('html contains hero image, every story title, events section, unsubscribe, preheader', () => {
  const { html } = renderSingleRegion({ edition, region: 'Dubai', lang: 'en', links });
  assert.match(html, /photo-hero/);
  assert.match(html, /Al Khayma Heritage Restaurant/);
  assert.match(html, /Dubai Marina at Golden Hour/);
  assert.match(html, /Dubai Food Festival/);
  assert.match(html, /Upcoming events/);
  assert.match(html, /https:\/\/x\/unsub/);
  assert.match(html, /Al Khayma Heritage Restaurant/);
});

test('no events section when there are no events', () => {
  const { html } = renderSingleRegion({ edition: { ...edition, events: [] }, region: 'Dubai', lang: 'en', links });
  assert.doesNotMatch(html, /Upcoming events/);
});
```

Note: the subject assertion above keeps the passed `region` label verbatim — the renderer must not translate the place name, only the surrounding copy.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/lib/newsletter-render.test.mjs`
Expected: FAIL — cannot find module `./newsletter-render.mjs`.

- [ ] **Step 3: Write the implementation**

Create `scripts/lib/newsletter-render.mjs`:

```js
import { copyFor, fill } from './newsletter-copy.mjs';

const P = { paper: '#f7f3ec', tint: '#f1ebe0', ink: '#201c17', soft: '#4a443c', acc: '#c8443a', accd: '#a5352c', gold: '#b8862f' };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const img = (i) => (i && i.url ? esc(i.url) : '');

function storyCard(s, c, links) {
  return `
  <tr><td style="padding:16px 40px;">
    <img src="${img(s.image)}" width="520" alt="${esc(s.title)}" style="width:100%;max-width:520px;height:auto;border-radius:6px;display:block;" />
    <div style="font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:${P.acc};font-weight:700;margin-top:14px;">${esc(s.category)}</div>
    <h3 style="margin:6px 0 0;font-size:22px;font-weight:400;line-height:1.2;color:${P.ink};">${esc(s.title)}</h3>
    <a href="${esc(links.story(s.slug))}" style="font-family:Helvetica,Arial,sans-serif;display:inline-block;margin-top:12px;font-size:12px;font-weight:700;color:${P.accd};text-decoration:none;border-bottom:1px solid #d8b6b2;padding-bottom:2px;">${esc(c.read)}</a>
  </td></tr>
  <tr><td style="padding:0 40px;"><div style="height:1px;background:${P.gold};opacity:.5;"></div></td></tr>`;
}

function eventsBlock(events, c, links) {
  if (!events.length) return '';
  const rows = events.map((e) => {
    const d = new Date(e.date);
    const when = isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `<a href="${esc(links.event(e.slug))}" style="display:block;font-size:16px;color:${P.ink};text-decoration:none;margin-top:12px;border-bottom:1px solid #e0d8c8;padding-bottom:10px;">${esc(e.title)} <span style="color:${P.gold};float:right;">${esc(when)} →</span></a>`;
  }).join('');
  return `
  <tr><td style="background:${P.tint};padding:22px 40px;">
    <div style="font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#7a736a;font-weight:700;">${esc(c.eventsLabel)}</div>
    ${rows}
  </td></tr>`;
}

export function renderSingleRegion({ edition, region, lang, links }) {
  const c = copyFor(lang);
  const v = { region, country: edition.country };
  const subject = fill(c.subjectSingle, v);
  const preheader = fill(c.preheaderSingle, v);
  const cards = [edition.hero, ...edition.stories].map((s) => storyCard(s, c, links)).join('');

  const html = `<!DOCTYPE html><html lang="${esc(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#e7e0d4;font-family:Georgia,'Times New Roman',serif;color:${P.ink};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e7e0d4;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:${P.paper};border-radius:4px;overflow:hidden;">
  <tr><td style="background:${P.ink};text-align:center;padding:15px;">
    <div style="font-family:Helvetica,Arial,sans-serif;letter-spacing:.28em;text-transform:uppercase;font-size:12px;font-weight:700;color:#e9dfce;">Wander Atlas</div>
    <div style="font-family:Helvetica,Arial,sans-serif;letter-spacing:.16em;text-transform:uppercase;font-size:8px;color:${P.gold};margin-top:5px;">The Weekly Edit · ${esc(region)}</div>
  </td></tr>
  <tr><td><img src="${img(edition.hero.image)}" width="600" alt="${esc(region)}" style="width:100%;height:auto;display:block;" /></td></tr>
  <tr><td style="padding:26px 40px 4px;">
    <h1 style="margin:0;font-size:32px;font-weight:400;line-height:1.1;color:${P.ink};">${esc(fill(c.subjectSingle, v))}</h1>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:${P.soft};font-style:italic;margin:14px 0 0;">${esc(fill(c.editorNote, v))}</p>
  </td></tr>
  <tr><td style="font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:${P.gold};font-weight:700;padding:24px 40px 0;">${esc(c.sectionLabel)}</td></tr>
  ${cards}
  ${eventsBlock(edition.events, c, links)}
  <tr><td style="text-align:center;padding:34px 40px;"><a href="${esc(links.cta)}" style="font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;letter-spacing:.04em;text-decoration:none;color:${P.accd};border:1.5px solid ${P.accd};border-radius:8px;padding:14px 30px;display:inline-block;">${esc(fill(c.ctaSingle, v))}</a></td></tr>
  <tr><td style="background:${P.ink};color:#a79e8f;font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:1.8;text-align:center;padding:26px 40px;">
    <a href="${esc(links.prefs)}" style="color:#d6ab5c;text-decoration:none;">${esc(c.regionChange)}</a> ·
    <a href="${esc(links.prefs)}" style="color:#d6ab5c;text-decoration:none;">${esc(c.langLabel)}</a> ·
    <a href="${esc(links.unsubscribe)}" style="color:#d6ab5c;text-decoration:none;">${esc(c.unsubscribe)}</a>
    <div style="color:#6a635a;font-size:10px;margin-top:12px;">Wander Atlas · wanderatlasguides.com</div>
  </td></tr>
</table>
</td></tr></table></body></html>`;

  return { subject, preheader, html };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/lib/newsletter-render.test.mjs`
Expected: PASS (3 tests). If the first test's `subject` assertion is brittle, keep it as written — the renderer passes `region` through verbatim, so `이번 주 Dubai 소식` is produced and the assertion's `.replace` yields the same string.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/newsletter-render.mjs scripts/lib/newsletter-render.test.mjs
git commit -m "feat: editorial newsletter HTML renderer (localized, inline-CSS, events, unsubscribe)"
```

---

## Task 6: Dry-run CLI (real previews from repo content)

**Files:**
- Create: `scripts/newsletter-dry-run.mjs`
- Create: `data/newsletter-sent-log.json` (seed `{}`)
- Modify: `.gitignore` (add `.newsletter-preview/`)

**Interfaces:**
- Consumes: `loadPosts`, `audienceKey`, `sentSetFor`, `pickSingleRegionEdition`, `renderSingleRegion`.
- Produces: writes `.newsletter-preview/<regionSlug>-<lang>.html` for each requested audience and prints a per-audience report. Never sends anything; never mutates the sent-log.
- Usage: `node scripts/newsletter-dry-run.mjs --region "Dubai" --langs en,ko`

- [ ] **Step 1: Seed the sent-log**

Create `data/newsletter-sent-log.json`:

```json
{}
```

- [ ] **Step 2: Ignore the preview output**

Add to `.gitignore` (below the `.superpowers/` line):

```
# newsletter dry-run previews (local only)
.newsletter-preview/
```

- [ ] **Step 3: Write the CLI**

Create `scripts/newsletter-dry-run.mjs`:

```js
// Offline preview: renders the newsletter for one or more audiences from the
// site's REAL posts, writes .html files you can open in a browser, and prints a
// report. Sends nothing and does not touch the sent-log. No MailerLite token.
//
//   node scripts/newsletter-dry-run.mjs --region "Dubai" --langs en,ko
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { slugify } from './lib/slugify.mjs';
import { loadPosts, audienceKey, sentSetFor, pickSingleRegionEdition } from './lib/newsletter-content.mjs';
import { renderSingleRegion } from './lib/newsletter-render.mjs';
import { LANGS } from './lib/newsletter-copy.mjs';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};

const POSTS_DIR = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const LOG_PATH = fileURLToPath(new URL('../data/newsletter-sent-log.json', import.meta.url));
const OUT_DIR = fileURLToPath(new URL('../.newsletter-preview/', import.meta.url));

const region = arg('region', 'Dubai');
const langs = arg('langs', 'en').split(',').filter((l) => LANGS.includes(l));
const posts = loadPosts(POSTS_DIR);
const log = existsSync(LOG_PATH) ? JSON.parse(readFileSync(LOG_PATH, 'utf8')) : {};
const now = new Date();

// Infer the country from any post in the region (falls back to the region name).
const sample = posts.find((p) => String(p.data.region).toLowerCase() === region.toLowerCase());
const country = sample ? sample.data.country : region;

mkdirSync(OUT_DIR, { recursive: true });
const site = 'https://wanderatlasguides.com';
console.log(`Dry-run · region="${region}" country="${country}" · ${posts.length} posts loaded\n`);

for (const lang of langs) {
  const key = audienceKey(slugify(region), lang);
  const edition = pickSingleRegionEdition({ posts, region, country, sent: sentSetFor(log, key), now, minStories: 3 });
  if (!edition) { console.log(`  [${key}] SKIP — no clean content this run`); continue; }
  const links = {
    cta: `${site}/regions/${slugify(region)}`,
    unsubscribe: `${site}/unsubscribe`,
    prefs: `${site}/preferences`,
    story: (s) => `${site}/${s}`,
    event: (s) => `${site}/${s}`,
  };
  const { subject, html } = renderSingleRegion({ edition, region, lang, links });
  const file = `${OUT_DIR}${slugify(region)}-${lang}.html`;
  writeFileSync(file, html);
  console.log(`  [${key}] "${subject}" — hero:${edition.hero.slug} stories:${edition.stories.length} events:${edition.events.length} → ${file}`);
}
console.log('\nOpen the .newsletter-preview/*.html files in a browser to review.');
```

- [ ] **Step 4: Run it against real content**

Run: `node scripts/newsletter-dry-run.mjs --region "Dubai" --langs en,ko`
Expected: prints one line per language with a real hero slug + counts, and writes `.newsletter-preview/dubai-en.html` and `dubai-ko.html`. Open both in a browser and confirm: an on-topic hero image (no car/moth), Dubai (or UAE top-up) story cards, and — if Dubai has an upcoming event post — an "Upcoming events / 다가오는 이벤트" section.

- [ ] **Step 5: Manually verify the image guard on a known-bad post**

Run: `node scripts/newsletter-dry-run.mjs --region "Fujairah" --langs en`
Expected: the `fujairah-al-meshwar-restaurant` / `fujairah-steki` off-topic heroes (from the image audit) are NOT used as the hero — the guard skips them. Confirm the chosen hero is a clean image (open the file).

- [ ] **Step 6: Commit**

```bash
git add scripts/newsletter-dry-run.mjs data/newsletter-sent-log.json .gitignore
git commit -m "feat: offline newsletter dry-run preview CLI + sent-log seed"
```

---

## Task 7: Full test run

**Files:** none (verification task).

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: all tests pass (offtopic 6 + content 6 + render 3). No failures.

- [ ] **Step 2: Run the publish gate to confirm no regression**

Run: `node scripts/validate-content.mjs`
Expected: exits with the same report as before Task 2 (the shared guard changed nothing behaviourally).

- [ ] **Step 3: Commit (if anything was fixed)**

```bash
git add -A
git commit -m "test: green suite for newsletter capture + renderer" || echo "nothing to commit"
```

---

## Task 8: Signup interest helper (pure)

**Files:**
- Create: `src/lib/interest.ts`
- Test: `src/lib/interest.test.mjs`

**Interfaces:**
- Produces:
  - `export function interestFields(input: { region?: string; country?: string; lang: string; source?: string }): { region: string; lang: string; source: string }` — normalizes the page context into the values the signup form submits. `region` is a lowercase slug (empty string → the caller/global default). Pure, no DOM.

- [ ] **Step 1: Write the failing test**

Create `src/lib/interest.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { interestFields } from './interest.ts';

test('slugifies the region and passes lang/source through', () => {
  const f = interestFields({ region: 'Abu Dhabi', lang: 'ko', source: '/ko/abu-dhabi' });
  assert.equal(f.region, 'abu-dhabi');
  assert.equal(f.lang, 'ko');
  assert.equal(f.source, '/ko/abu-dhabi');
});

test('empty region becomes empty string (global)', () => {
  const f = interestFields({ lang: 'en', source: '/' });
  assert.equal(f.region, '');
  assert.equal(f.lang, 'en');
});
```

Note: Node ≥18 runs `.ts` test imports only with a loader. If `node --test src/lib/interest.test.mjs` cannot import the `.ts` file directly in this repo's setup, change the import to a compiled path or move the pure function to `src/lib/interest.mjs` and re-export it from `interest.ts`. Prefer authoring the function in `src/lib/interest.mjs` and importing that from both the test and `interest.ts` to keep one implementation.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/interest.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/interest.mjs`:

```js
// Pure: turn page context into the field values the signup form submits.
// Region is a stable lowercase slug so it matches the newsletter audience keys.
export function interestFields({ region = '', country = '', lang, source = '' }) {
  const slug = String(region).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return { region: slug, lang, source };
}
```

Create `src/lib/interest.ts` (typed re-export for Astro/TS consumers):

```ts
export { interestFields } from './interest.mjs';
```

Update the test import in `src/lib/interest.test.mjs` to `./interest.mjs`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/lib/interest.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/interest.mjs src/lib/interest.ts src/lib/interest.test.mjs
git commit -m "feat: pure signup interest-field helper"
```

---

## Task 9: Wire region/lang/source into the signup form

**Files:**
- Modify: `src/components/Newsletter.astro` (frontmatter + hidden inputs + submit script)

**Interfaces:**
- Consumes: `interestFields` from `../lib/interest.ts`; existing `getLangFromUrl`.
- Produces: the form now submits `fields[region]`, `fields[lang]`, `fields[signup_source]` alongside `fields[email]`.

**Note on MailerLite (owner action, documented for Plan 2):** for these custom fields to be stored, the MailerLite account must have custom fields with keys `region`, `lang`, `signup_source`. Creating them and verifying a live signup stores them is a Plan-2 step; this task only makes the site SEND them. Sending unknown fields is harmless.

- [ ] **Step 1: Add derivation to the component frontmatter**

In `src/components/Newsletter.astro`, add a `region`/`country` prop and compute the fields. Change the `interface Props` line and the destructure, and add the derivation after `const t = useTranslations(lang);`:

```astro
import { interestFields } from '../lib/interest';
// ...
interface Props { compact?: boolean; lang?: Lang; heading?: string; dek?: string; cta?: string; region?: string; country?: string }
const { compact = false, lang: langProp, heading, dek, cta, region = '', country = '' } = Astro.props;
// ...
const interest = interestFields({ region, country, lang, source: Astro.url.pathname });
```

- [ ] **Step 2: Add hidden inputs to the form**

Inside `<form class="nl-form" …>`, right after the email `<input>`, add:

```astro
        <input type="hidden" name="region" value={interest.region} />
        <input type="hidden" name="lang" value={interest.lang} />
        <input type="hidden" name="source" value={interest.source} />
```

- [ ] **Step 3: Append the fields in the submit handler**

In the `<script>`, where the `FormData` is built (after `data.append('fields[email]', email);`), add:

```js
      const rd = (n) => (form.querySelector(`input[name=${n}]`)?.value || '');
      if (rd('region')) data.append('fields[region]', rd('region'));
      data.append('fields[lang]', rd('lang') || 'en');
      data.append('fields[signup_source]', rd('source'));
```

- [ ] **Step 4: Pass region/country from the post page**

In `src/components/PostArticle.astro`, find the `<Newsletter compact lang={lang} … />` usage (~line 429) and add `region={post.data.region} country={country}` to its props (the component already computes `country` and `regionLabel` nearby).

- [ ] **Step 5: Build to confirm nothing broke**

Run: `npm run build`
Expected: build completes (same page count as before, ~3065). No type errors from the new prop.

- [ ] **Step 6: Verify the rendered form carries the fields**

Run: `node -e "const fs=require('fs');const h=fs.readFileSync('dist/regions/dubai/index.html','utf8');console.log(/name=\"region\" value=\"dubai\"/.test(h)?'REGION OK':'MISSING', /name=\"lang\"/.test(h)?'LANG OK':'MISSING')"`
Expected: `REGION OK LANG OK` (adjust the sample path to an existing built page if `regions/dubai` differs).

- [ ] **Step 7: Commit**

```bash
git add src/components/Newsletter.astro src/components/PostArticle.astro
git commit -m "feat: capture region/lang/source at newsletter signup"
```

---

## Out of scope — Plan 2 (MailerLite delivery, gated on API token)

These require the owner to generate a **free MailerLite API token** and confirm plan capabilities; they are written up in the spec (§4.1–4.7) and will get their own plan:

1. `functions/api/subscribe.js` (Cloudflare Pages Function) — optional richer signup path + MailerLite custom-field creation/verification.
2. `functions/preferences` page + signed-link (HMAC) read/update of subscriber `regions`/`lang`.
3. Weekly sender workflow — fetch active subscribers, bucket into audiences (single / multi-region / global), sync `auto:<hash>` groups, create + send campaigns, then append used slugs to `data/newsletter-sent-log.json` and commit (idempotent per ISO week).
4. Global "Editor's Picks" + multi-region combined renderers (extend Task 5).
5. Daily Telegram signup report (Korean) — model on `scripts/analytics-report.mjs` + `.github/workflows/analytics-report.yml`.
6. Weekly private subscriber CSV backup — Telegram document to the owner's chat only.

---

## Self-Review

- **Spec coverage (this plan's scope):** signup capture §4.1 → Tasks 8–9; image quality guard §4.3 → Tasks 2, 6(step 5); events section §4.3 → Tasks 4–5; freshness/no-repeat §4.7 → Task 4 (sent-log exclusion) + Task 6 (log read, no mutation); per-language §Language row → Tasks 3, 5, 6. Delivery/reporting/backup/preferences are explicitly deferred to Plan 2 (listed above), consistent with the spec's §7 rollout order and the token gate.
- **Placeholder scan:** none — every code and test step contains full source; the only "later" references are the clearly-scoped Plan 2 list, not steps in this plan.
- **Type consistency:** `Edition` fields (`hero`, `stories`, `events`, `country`, `usedPostSlugs`, `usedEventSlugs`) are produced in Task 4 and consumed unchanged in Tasks 5–6; `interestFields` signature matches between Tasks 8 and 9; `audienceKey`/`sentSetFor` names match between Task 4 and Task 6.
