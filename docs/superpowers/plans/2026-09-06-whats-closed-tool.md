# What's-Closed Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One page, in five languages, that takes a country and a date range and says which public holidays fall inside it and which of our covered venues are normally shut on those weekdays.

**Architecture:** A pure library over data passed in (same contract as `src/lib/when-to-go.mjs`), a component that loads that data at build time and server-renders a default view, and two thin routes (`/tools/whats-closed`, `/[lang]/tools/whats-closed`) that share the component — the shape `BestTimeTool.astro` already uses. No API, no new page grid.

**Tech Stack:** Astro content collections, `node:test`, `data/country-facts.json`, `src/i18n/holidays.ts`, `src/i18n/ui.ts`.

**Spec:** `docs/superpowers/specs/2026-09-06-whats-closed-tool-design.md`

## Global Constraints

- Working directory is the shared checkout `C:\Users\user\wa-main`. The shell resets between calls: begin every bash command with `cd /c/Users/user/wa-main && pwd &&`.
- Node 24: `node --test <directory>` is broken here. Always pass explicit file paths.
- The library imports no site data. Data arrives as function arguments, so the tests run in plain node with no Astro.
- Dates are ISO `YYYY-MM-DD` strings in and out. All arithmetic is UTC (`Date.parse(iso + 'T00:00:00Z')`, `getUTCDay`).
- A post carrying `place.hoursOmitted` is excluded from every closure result. That field means Google filed another entity's schedule under the place.
- No claim about holiday opening hours. The page states holiday dates and ordinary weekly closures, and says holiday schedules differ.
- Five languages everywhere: `en, ko, ja, es, zh`. Every `ui.ts` key the component uses exists in all five blocks.
- A build is successful only when the log ends with `Complete!` — exit code alone is not proof.

---

### Task 1: The library

**Files:**
- Create: `src/lib/whats-closed.mjs`
- Test: `src/lib/whats-closed.test.mjs`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `eachDateInRange(fromISO, toISO) → string[]` — inclusive, ascending, capped at 60 days, `[]` on inverted or malformed input.
  - `weekdayOf(iso) → 'Monday'|…|'Sunday'|null`
  - `holidaysInRange(countryFacts, country, fromISO, toISO) → {date, localName, name}[]` ascending.
  - `closedWeekdaysOf(post) → string[]` — weekday names this venue is shut; `[]` when hours are absent or `hoursOmitted` is set.
  - `closuresInRange(posts, {country, fromISO, toISO}) → {date, weekday, venues: {slug, name, city}[]}[]` — only dates with at least one venue, ascending, venues by name.

- [ ] **Step 1: Write the failing test**

```js
// src/lib/whats-closed.test.mjs
//
// The tool answers a date question from two facts we hold: holiday dates in
// data/country-facts.json and each venue's ordinary weekly hours from Google
// Places. Pure functions over data passed in, so this runs in plain node.
//
//   node --test src/lib/whats-closed.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  eachDateInRange, weekdayOf, holidaysInRange, closedWeekdaysOf, closuresInRange,
} from './whats-closed.mjs';

const FACTS = {
  updated: '2026-09-03',
  countries: {
    Japan: {
      holidays: [
        { date: '2026-12-31', localName: '大晦日', name: "New Year's Eve" },
        { date: '2027-01-01', localName: '元日', name: "New Year's Day" },
        { date: '2026-03-20', localName: '春分の日', name: 'Vernal Equinox Day' },
      ],
    },
    Thailand: { holidays: [] },
  },
};

const WEEK = (closed) => [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
].map((d) => (closed.includes(d) ? `${d}: Closed` : `${d}: 9:00 AM – 5:00 PM`));

const post = (over = {}) => ({
  id: over.id ?? 'tokyo-museum.md',
  data: {
    country: over.country ?? 'Japan',
    region: 'Tokyo',
    place: { name: over.name ?? 'Tokyo Museum', openingHours: over.hours, ...(over.place ?? {}) },
  },
});

test('eachDateInRange is inclusive and ascending', () => {
  assert.deepEqual(eachDateInRange('2026-03-14', '2026-03-17'),
    ['2026-03-14', '2026-03-15', '2026-03-16', '2026-03-17']);
});

test('eachDateInRange crosses a month and a year without drifting', () => {
  assert.deepEqual(eachDateInRange('2026-01-30', '2026-02-02'),
    ['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02']);
  assert.deepEqual(eachDateInRange('2026-12-30', '2027-01-02'),
    ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
});

test('eachDateInRange refuses nonsense instead of hanging', () => {
  assert.deepEqual(eachDateInRange('2026-03-17', '2026-03-14'), []);
  assert.deepEqual(eachDateInRange('not a date', '2026-03-14'), []);
  assert.equal(eachDateInRange('2026-01-01', '2026-12-31').length, 60);
});

test('weekdayOf reads the UTC day, so a date is the same weekday everywhere', () => {
  assert.equal(weekdayOf('2026-03-16'), 'Monday');
  assert.equal(weekdayOf('2026-03-22'), 'Sunday');
  assert.equal(weekdayOf('nope'), null);
});

test('holidaysInRange returns only what falls inside, in date order', () => {
  assert.deepEqual(
    holidaysInRange(FACTS, 'Japan', '2026-12-30', '2027-01-02').map((h) => h.date),
    ['2026-12-31', '2027-01-01'],
  );
});

test('holidaysInRange is empty, never undefined, when there is nothing to say', () => {
  assert.deepEqual(holidaysInRange(FACTS, 'Thailand', '2026-01-01', '2026-01-31'), []);
  assert.deepEqual(holidaysInRange(FACTS, 'Narnia', '2026-01-01', '2026-01-31'), []);
  assert.deepEqual(holidaysInRange(null, 'Japan', '2026-01-01', '2026-01-31'), []);
});

test('closedWeekdaysOf reads every closed day, not just the first', () => {
  assert.deepEqual(closedWeekdaysOf(post({ hours: WEEK(['Monday', 'Tuesday']) })),
    ['Monday', 'Tuesday']);
});

test('closedWeekdaysOf says nothing about a venue whose hours belong to another entity', () => {
  const wrong = post({ hours: WEEK(['Monday']), place: { hoursOmitted: 'park office hours' } });
  assert.deepEqual(closedWeekdaysOf(wrong), []);
  assert.deepEqual(closedWeekdaysOf(post({})), []);
});

test('closuresInRange lists a day only when something is shut on it', () => {
  const posts = [
    post({ id: 'a.md', hours: WEEK(['Monday']), name: 'B Museum' }),
    post({ id: 'b.md', hours: WEEK(['Monday']), name: 'A Gallery' }),
    post({ id: 'c.md', hours: WEEK(['Thursday']), name: 'C Garden' }),
  ];
  const out = closuresInRange(posts, { country: 'Japan', fromISO: '2026-03-16', toISO: '2026-03-18' });
  assert.deepEqual(out.map((d) => d.date), ['2026-03-16']);
  assert.deepEqual(out[0].venues.map((v) => v.name), ['A Gallery', 'B Museum']);
  assert.equal(out[0].venues[0].slug, 'b');
  assert.equal(out[0].weekday, 'Monday');
});

test('closuresInRange keeps to the country asked for', () => {
  const posts = [
    post({ id: 'jp.md', hours: WEEK(['Monday']) }),
    post({ id: 'th.md', hours: WEEK(['Monday']), country: 'Thailand', name: 'Wat Arun' }),
  ];
  const out = closuresInRange(posts, { country: 'Japan', fromISO: '2026-03-16', toISO: '2026-03-16' });
  assert.deepEqual(out[0].venues.map((v) => v.name), ['Tokyo Museum']);
});

test('closuresInRange survives empty and malformed input', () => {
  assert.deepEqual(closuresInRange([], { country: 'Japan', fromISO: '2026-03-16', toISO: '2026-03-18' }), []);
  assert.deepEqual(closuresInRange(null, { country: 'Japan', fromISO: '2026-03-16', toISO: '2026-03-18' }), []);
  assert.deepEqual(closuresInRange([post({ hours: WEEK(['Monday']) })], { country: 'Japan', fromISO: 'x', toISO: 'y' }), []);
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd /c/Users/user/wa-main && pwd && node --test src/lib/whats-closed.test.mjs
```

Expected: FAIL — `Cannot find module './whats-closed.mjs'`.

- [ ] **Step 3: Write the implementation**

```js
// src/lib/whats-closed.mjs
//
// "Is anything shut while I'm there?" answered from two facts the site already
// holds: dated public holidays per country (data/country-facts.json) and each
// venue's ordinary weekly hours from Google Places.
//
// What this deliberately does NOT know is holiday opening hours. A public holiday
// falling inside a range is a fact; "the museum will be closed for it" is a guess,
// and guesses dressed as findings are what the 2026-09 repairs removed.
//
// Data arrives as arguments rather than being imported, so these stay pure
// functions testable in plain node — the same contract as when-to-go.mjs.

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Nobody plans a 60-day range, and an unbounded loop on bad input is how a build
// hangs. The cap is a guard, not a product rule.
const MAX_DAYS = 60;

const utc = (iso) => (ISO.test(String(iso)) ? Date.parse(`${iso}T00:00:00Z`) : NaN);

/** Every date from `fromISO` to `toISO` inclusive, ascending. `[]` on bad input. */
export function eachDateInRange(fromISO, toISO) {
  const a = utc(fromISO); const b = utc(toISO);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return [];
  const out = [];
  for (let t = a; t <= b && out.length < MAX_DAYS; t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** The weekday name for an ISO date, read in UTC so it cannot shift by timezone. */
export function weekdayOf(iso) {
  const t = utc(iso);
  return Number.isNaN(t) ? null : DAYS[new Date(t).getUTCDay()];
}

/** Public holidays of `country` inside the range, ascending. */
export function holidaysInRange(countryFacts, country, fromISO, toISO) {
  const a = utc(fromISO); const b = utc(toISO);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return [];
  const facts = (countryFacts?.countries ?? countryFacts ?? {})[country];
  return (facts?.holidays ?? [])
    .filter((h) => {
      const t = utc(h?.date);
      return !Number.isNaN(t) && t >= a && t <= b;
    })
    .sort((x, y) => x.date.localeCompare(y.date));
}

// Google writes one line per weekday: "Monday: 9:00 AM – 5:00 PM" or
// "Monday: Closed". Anything else is somebody else's format and is left alone
// rather than guessed at.
const CLOSED_LINE = /^\s*(\w+day)\s*:\s*closed\s*$/i;

/** Weekday names this venue is ordinarily shut. `[]` when we should not say. */
export function closedWeekdaysOf(post) {
  const place = post?.data?.place;
  if (!place || place.hoursOmitted) return [];
  return (place.openingHours ?? [])
    .map((line) => CLOSED_LINE.exec(String(line))?.[1])
    .filter(Boolean)
    .map((d) => d[0].toUpperCase() + d.slice(1).toLowerCase())
    .filter((d) => DAYS.includes(d));
}

/**
 * For each date in the range with at least one covered venue shut, the venues.
 * Dates ascending, venues by name, so the same input always renders the same page.
 */
export function closuresInRange(posts, { country, fromISO, toISO } = {}) {
  const dates = eachDateInRange(fromISO, toISO);
  if (!dates.length || !Array.isArray(posts)) return [];

  const byWeekday = new Map();
  for (const p of posts) {
    if (p?.data?.country !== country) continue;
    const closed = closedWeekdaysOf(p);
    if (!closed.length) continue;
    const venue = {
      slug: String(p.id ?? '').replace(/\.md$/, ''),
      name: p.data.place?.name ?? String(p.data.title ?? '').split(':')[0].trim(),
      city: p.data.region ?? null,
    };
    for (const d of closed) {
      if (!byWeekday.has(d)) byWeekday.set(d, []);
      byWeekday.get(d).push(venue);
    }
  }
  for (const list of byWeekday.values()) list.sort((a, b) => a.name.localeCompare(b.name));

  return dates
    .map((date) => ({ date, weekday: weekdayOf(date), venues: byWeekday.get(weekdayOf(date)) ?? [] }))
    .filter((d) => d.venues.length > 0);
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
cd /c/Users/user/wa-main && pwd && node --test src/lib/whats-closed.test.mjs
```

Expected: PASS, 11 tests, 0 failures.

- [ ] **Step 5: Check the library against the real catalogue**

```bash
cd /c/Users/user/wa-main && pwd && node -e "const fs=require('fs');import('./src/lib/whats-closed.mjs').then((m)=>{const f=JSON.parse(fs.readFileSync('data/country-facts.json','utf8'));const h=m.holidaysInRange(f,'Japan','2026-12-28','2027-01-04');console.log('Japan holidays in that window:',h.map(x=>x.date+' '+x.localName).join(' / ')||'(none)');});"
```

Expected: at least one dated Japanese holiday. An empty list means the data file's
shape changed — stop and read `data/country-facts.json` before continuing.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/user/wa-main && pwd && git add src/lib/whats-closed.mjs src/lib/whats-closed.test.mjs && git commit -m "feat: pure library for what is closed on a date range"
```

---

### Task 2: The five-language strings, with a test that they all exist

**Files:**
- Modify: `src/i18n/ui.ts` — five language blocks. Find each by searching for that block's `'wtg.title':` line and insert immediately after it.
- Create: `src/i18n/whats-closed-keys.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: the `wc.*` keys below, reached in Task 3 through `useTranslations(lang)`.

- [ ] **Step 1: Write the failing test**

```js
// src/i18n/whats-closed-keys.test.mjs
//
// Adding a page means adding its strings to five language blocks by hand. Miss one
// and the failure is silent — English leaks into a Korean page. Same registration
// check the essentials topics gained on 2026-09-05.
//
//   node --test src/i18n/whats-closed-keys.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const UI = readFileSync(new URL('./ui.ts', import.meta.url), 'utf8');

const KEYS = [
  'wc.title', 'wc.dek', 'wc.country', 'wc.from', 'wc.to', 'wc.check',
  'wc.holidaysHeading', 'wc.noHolidays', 'wc.closedHeading', 'wc.noClosures',
  'wc.caveat', 'wc.hoursSource', 'wc.quietLink',
];

test('every whats-closed string exists in all five languages', () => {
  for (const key of KEYS) {
    const count = UI.split(`'${key}':`).length - 1;
    assert.equal(count, 5, `${key} defined ${count} time(s), expected 5`);
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /c/Users/user/wa-main && pwd && node --test src/i18n/whats-closed-keys.test.mjs
```

Expected: FAIL — `wc.title defined 0 time(s), expected 5`.

- [ ] **Step 3: Add the strings — `en` block, after its `'wtg.title':` line**

```ts
    'wc.title': "What's closed on your dates",
    'wc.dek': 'Pick a country and your dates. Public holidays that fall inside them, and the places we cover that are ordinarily shut on those days.',
    'wc.country': 'Country',
    'wc.from': 'From',
    'wc.to': 'To',
    'wc.check': 'Check these dates',
    'wc.holidaysHeading': 'Public holidays in your dates',
    'wc.noHolidays': 'No public holidays fall inside these dates.',
    'wc.closedHeading': 'Ordinarily closed while you are there',
    'wc.noClosures': 'None of the places we cover keep a regular closing day inside these dates.',
    'wc.caveat': 'Holiday opening hours are set by each venue and are not in this data. Treat a public holiday as a reason to check, not as a closure.',
    'wc.hoursSource': 'Weekly hours come from Google Places. Each venue links to its own guide, where the full week is printed.',
    'wc.quietLink': 'Looking for the quietest hour instead?',
```

- [ ] **Step 4: Add the strings — `ko` block, after its `'wtg.title':` line**

```ts
    'wc.title': '내 여행 날짜에 뭐가 닫나',
    'wc.dek': '나라와 날짜를 고르면, 그 사이에 걸리는 공휴일과 그 요일에 정기 휴무인 수록 장소를 알려드립니다.',
    'wc.country': '나라',
    'wc.from': '시작일',
    'wc.to': '종료일',
    'wc.check': '이 날짜로 확인',
    'wc.holidaysHeading': '이 기간의 공휴일',
    'wc.noHolidays': '이 기간에는 공휴일이 없습니다.',
    'wc.closedHeading': '이 기간에 정기 휴무인 곳',
    'wc.noClosures': '이 기간에 정기 휴무일이 걸리는 수록 장소는 없습니다.',
    'wc.caveat': '공휴일 영업시간은 장소마다 다르고 그 정보는 이 데이터에 없습니다. 공휴일은 닫는다는 뜻이 아니라 확인해볼 이유로 보세요.',
    'wc.hoursSource': '요일별 영업시간은 구글 Places 자료입니다. 각 장소를 누르면 해당 가이드에서 한 주 전체를 볼 수 있습니다.',
    'wc.quietLink': '몇 시가 한산한지 찾고 계신가요?',
```

- [ ] **Step 5: Add the strings — `ja` block, after its `'wtg.title':` line**

```ts
    'wc.title': '旅行の日程で休みになる場所',
    'wc.dek': '国と日程を選ぶと、その期間にかかる祝日と、その曜日が定休日にあたる掲載スポットを表示します。',
    'wc.country': '国',
    'wc.from': '開始日',
    'wc.to': '終了日',
    'wc.check': 'この日程で調べる',
    'wc.holidaysHeading': 'この期間の祝日',
    'wc.noHolidays': 'この期間に祝日はありません。',
    'wc.closedHeading': 'この期間に定休日となる場所',
    'wc.noClosures': 'この期間に定休日がかかる掲載スポットはありません。',
    'wc.caveat': '祝日の営業時間は施設ごとに異なり、このデータには含まれていません。祝日は休みと決めつけず、確認する理由と考えてください。',
    'wc.hoursSource': '曜日ごとの営業時間はGoogle Placesの情報です。各スポットのガイドで一週間分を確認できます。',
    'wc.quietLink': '空いている時間帯をお探しですか？',
```

- [ ] **Step 6: Add the strings — `es` block, after its `'wtg.title':` line**

```ts
    'wc.title': 'Qué cierra en tus fechas',
    'wc.dek': 'Elige un país y tus fechas. Verás los festivos que caen dentro y los lugares que cubrimos que cierran habitualmente esos días.',
    'wc.country': 'País',
    'wc.from': 'Desde',
    'wc.to': 'Hasta',
    'wc.check': 'Consultar estas fechas',
    'wc.holidaysHeading': 'Festivos en tus fechas',
    'wc.noHolidays': 'No hay festivos dentro de estas fechas.',
    'wc.closedHeading': 'Cierres habituales durante tu viaje',
    'wc.noClosures': 'Ningún lugar que cubrimos tiene su día de cierre dentro de estas fechas.',
    'wc.caveat': 'El horario de los festivos lo fija cada sitio y no está en estos datos. Toma un festivo como motivo para comprobar, no como un cierre.',
    'wc.hoursSource': 'Los horarios semanales vienen de Google Places. Cada lugar enlaza con su guía, donde está la semana completa.',
    'wc.quietLink': '¿Buscas la hora más tranquila?',
```

- [ ] **Step 7: Add the strings — `zh` block, after its `'wtg.title':` line**

```ts
    'wc.title': '你的日期里有什么关门',
    'wc.dek': '选择国家和日期，查看这段时间里的公共假日，以及我们收录的、在那些星期几例行休息的地点。',
    'wc.country': '国家',
    'wc.from': '开始日期',
    'wc.to': '结束日期',
    'wc.check': '查询这些日期',
    'wc.holidaysHeading': '这段时间的公共假日',
    'wc.noHolidays': '这段时间没有公共假日。',
    'wc.closedHeading': '这段时间例行休息的地点',
    'wc.noClosures': '我们收录的地点中，没有哪家的例行休息日落在这段时间。',
    'wc.caveat': '假日营业时间由各家自行决定，不在这份数据里。请把公共假日当作值得再确认的理由，而不是已经关门。',
    'wc.hoursSource': '每周营业时间来自 Google Places。点击地点可在其指南页看到完整一周。',
    'wc.quietLink': '想找最空的时段？',
```

- [ ] **Step 8: Run the test and watch it pass**

```bash
cd /c/Users/user/wa-main && pwd && node --test src/i18n/whats-closed-keys.test.mjs
```

Expected: PASS, 1 test.

- [ ] **Step 9: Commit**

```bash
cd /c/Users/user/wa-main && pwd && git add src/i18n/ui.ts src/i18n/whats-closed-keys.test.mjs && git commit -m "i18n: strings for the whats-closed tool, with a test that all five languages have them"
```

---

### Task 3: The page

**Files:**
- Create: `src/components/WhatsClosed.astro`
- Create: `src/pages/tools/whats-closed.astro`
- Create: `src/pages/[lang]/tools/whats-closed.astro`
- Modify: `src/pages/llms.txt.ts` — the `## Tools` block, after the `/tools/best-time` line
- Read first: `src/components/BestTimeTool.astro` for the surrounding conventions (`BaseLayout`, `Props { lang }`, `useTranslations`, `localizePath`)

**Interfaces:**
- Consumes: `whats-closed.mjs` (Task 1), the `wc.*` keys (Task 2).
- Produces: the routes `/tools/whats-closed/` and `/{ko,ja,es,zh}/tools/whats-closed/`.

- [ ] **Step 1: Write the component**

```astro
---
// "WHAT'S CLOSED ON YOUR DATES" — the date-range question, answered from data we
// already hold: dated public holidays per country and each venue's ordinary weekly
// hours. Deliberately one page rather than a country x month grid: indexing has
// been frozen since 2026-07-25, so a thousand new template URLs would reach nobody.
// Traffic comes from internal links, not new URLs.
//
// The default view (first country, next 14 days) is SERVER-rendered, so the answer
// exists as text in the delivered HTML — the same reason BestTimeTool renders its
// cards at build time. The pickers then filter a build-time island.
import BaseLayout from '../layouts/BaseLayout.astro';
import { getCollection } from 'astro:content';
import { useTranslations, localizePath, type Lang } from '../i18n/utils';
import { holidayLabel } from '../i18n/holidays';
import { closuresInRange, holidaysInRange } from '../lib/whats-closed.mjs';
import countryFacts from '../../data/country-facts.json';

interface Props { lang: Lang }
const { lang } = Astro.props;
const t = useTranslations(lang);

const posts = await getCollection('posts', ({ data }) => !data.draft);

// Countries with holiday dates AND at least one venue we cover. A country that can
// only ever answer "nothing" is not worth offering in the picker.
const facts = (countryFacts as any).countries ?? {};
const countries = Object.keys(facts)
  .filter((c) => (facts[c].holidays ?? []).length > 0)
  .filter((c) => posts.some((p) => p.data.country === c))
  .sort();

const today = new Date().toISOString().slice(0, 10);
const in14 = new Date(Date.now() + 13 * 86400000).toISOString().slice(0, 10);
const initial = countries[0] ?? '';

// The island: per country, its holidays and the venues that keep a closing day.
// Small (20 countries, ~130 venues) and built from the same data as the server
// view, so the two cannot disagree.
const island = Object.fromEntries(countries.map((c) => [c, {
  holidays: (facts[c].holidays ?? []).map((h: any) => ({
    date: h.date,
    label: holidayLabel(c, h.localName, h.name, lang),
  })),
  venues: posts
    .filter((p) => p.data.country === c)
    .map((p) => ({
      slug: p.id.replace(/\.md$/, ''),
      name: p.data.place?.name ?? String(p.data.title).split(':')[0].trim(),
      city: p.data.region ?? null,
      hours: p.data.place?.hoursOmitted ? [] : (p.data.place?.openingHours ?? []),
    }))
    .filter((v) => v.hours.length > 0),
}]));

const holidays = initial ? holidaysInRange(countryFacts, initial, today, in14) : [];
const closures = initial ? closuresInRange(posts, { country: initial, fromISO: today, toISO: in14 }) : [];
---

<BaseLayout title={t('wc.title')} description={t('wc.dek')} lang={lang}>
  <main class="wc">
    <h1>{t('wc.title')}</h1>
    <p class="dek">{t('wc.dek')}</p>

    <form class="wc-form" id="wc-form">
      <label>{t('wc.country')}
        <select id="wc-country">
          {countries.map((c) => <option value={c} selected={c === initial}>{c}</option>)}
        </select>
      </label>
      <label>{t('wc.from')} <input type="date" id="wc-from" value={today} /></label>
      <label>{t('wc.to')} <input type="date" id="wc-to" value={in14} /></label>
      <button type="submit">{t('wc.check')}</button>
    </form>

    <section id="wc-holidays">
      <h2>{t('wc.holidaysHeading')}</h2>
      <ul id="wc-holiday-list">
        {holidays.map((h: any) => (
          <li><time datetime={h.date}>{h.date}</time> — {holidayLabel(initial, h.localName, h.name, lang)}</li>
        ))}
      </ul>
      <p id="wc-holiday-empty" hidden={holidays.length > 0}>{t('wc.noHolidays')}</p>
      <p class="caveat">{t('wc.caveat')}</p>
    </section>

    <section id="wc-closures">
      <h2>{t('wc.closedHeading')}</h2>
      <ul id="wc-closure-list">
        {closures.map((d: any) => (
          <li>
            <time datetime={d.date}>{d.date}</time>
            <ul>
              {d.venues.map((v: any) => (
                <li><a href={localizePath(`/posts/${v.slug}`, lang)}>{v.name}</a>{v.city ? `, ${v.city}` : ''}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <p id="wc-closure-empty" hidden={closures.length > 0}>{t('wc.noClosures')}</p>
      <p class="caveat">{t('wc.hoursSource')}</p>
      <p><a href={localizePath('/tools/best-time', lang)}>{t('wc.quietLink')} →</a></p>
    </section>
  </main>

  <script is:inline define:vars={{ island, postBase: localizePath('/posts', lang) }}>
    // Client filter over the same island the server view was built from.
    const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    const closedDays = (hours) => hours
      .map((l) => /^\s*(\w+day)\s*:\s*closed\s*$/i.exec(l)?.[1])
      .filter(Boolean)
      .map((d) => d[0].toUpperCase() + d.slice(1).toLowerCase());

    const spanOf = (from, to) => {
      const a = Date.parse(from + 'T00:00:00Z'); const b = Date.parse(to + 'T00:00:00Z');
      if (Number.isNaN(a) || Number.isNaN(b) || b < a) return [];
      const out = [];
      for (let t = a; t <= b && out.length < 60; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
      return out;
    };

    document.getElementById('wc-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const data = island[document.getElementById('wc-country').value];
      if (!data) return;
      const span = spanOf(document.getElementById('wc-from').value, document.getElementById('wc-to').value);

      const hs = data.holidays.filter((h) => span.includes(h.date));
      document.getElementById('wc-holiday-list').innerHTML =
        hs.map((h) => `<li><time datetime="${h.date}">${h.date}</time> — ${esc(h.label)}</li>`).join('');
      document.getElementById('wc-holiday-empty').hidden = hs.length > 0;

      const byDay = {};
      for (const v of data.venues) for (const d of closedDays(v.hours)) (byDay[d] ||= []).push(v);
      for (const list of Object.values(byDay)) list.sort((x, y) => x.name.localeCompare(y.name));
      const rows = span
        .map((d) => ({ date: d, venues: byDay[DAYS[new Date(d + 'T00:00:00Z').getUTCDay()]] || [] }))
        .filter((r) => r.venues.length);
      document.getElementById('wc-closure-list').innerHTML = rows.map((r) =>
        `<li><time datetime="${r.date}">${r.date}</time><ul>${
          r.venues.map((v) => `<li><a href="${postBase}/${esc(v.slug)}">${esc(v.name)}</a>${v.city ? ', ' + esc(v.city) : ''}</li>`).join('')
        }</ul></li>`).join('');
      document.getElementById('wc-closure-empty').hidden = rows.length > 0;
    });
  </script>
</BaseLayout>
```

- [ ] **Step 2: Write the two routes**

`src/pages/tools/whats-closed.astro`:

```astro
---
import WhatsClosed from '../../components/WhatsClosed.astro';
---

<WhatsClosed lang="en" />
```

`src/pages/[lang]/tools/whats-closed.astro`:

```astro
---
import WhatsClosed from '../../../components/WhatsClosed.astro';
import type { Lang } from '../../../i18n/utils';
export function getStaticPaths() {
  return (['ko', 'ja', 'es', 'zh'] as Lang[]).map((lang) => ({ params: { lang }, props: { lang } }));
}
const { lang } = Astro.props;
---

<WhatsClosed lang={lang} />
```

- [ ] **Step 3: Add the llms.txt line**

In `src/pages/llms.txt.ts`, directly after the `/tools/best-time` line in the `## Tools` block:

```ts
- [What's closed on your dates](${base}/tools/whats-closed): Public holidays in a date range, and the venues we cover that are shut on those weekdays
```

- [ ] **Step 4: Build**

```bash
cd /c/Users/user/wa-main && pwd && npm run build 2>&1 | tail -5
```

Expected: the log ends with `Complete!`. The build takes roughly 50 minutes.

- [ ] **Step 5: Check the five pages exist and the answer is in the HTML**

```bash
cd /c/Users/user/wa-main && pwd && for p in "tools/whats-closed" "ko/tools/whats-closed" "ja/tools/whats-closed" "es/tools/whats-closed" "zh/tools/whats-closed"; do [ -f "dist/$p/index.html" ] && echo "OK $p" || echo "MISSING $p"; done; grep -c "whats-closed" dist/llms.txt
```

Expected: five `OK` lines and `1`.

```bash
cd /c/Users/user/wa-main && pwd && sed 's/<script[^>]*>/\n<SCRIPT>\n/' dist/tools/whats-closed/index.html | sed '/<SCRIPT>/,/<\/script>/d' | grep -oE "<time datetime=\"[0-9-]+\">" | head -5
```

Expected: at least one dated row from OUTSIDE the script tag. Nothing here means the
server-rendered view is not working — fix that before committing, because a page whose
answer appears only after JavaScript is a page no assistant can quote.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/user/wa-main && pwd && git add src/components/WhatsClosed.astro src/pages/tools/whats-closed.astro "src/pages/[lang]/tools/whats-closed.astro" src/pages/llms.txt.ts && git commit -m "feat: whats-closed tool page in five languages"
```

---

### Task 4: The internal links, and the live check

**Files:**
- Modify: `src/components/WhenToGoPage.astro` — the holidays section, found by its `t('wtg.holidays')` heading around line 146
- Modify: `src/components/Footer.astro` — next to the existing `/tools/best-time` link, around line 24

**Interfaces:**
- Consumes: the route from Task 3 and the `wc.title` key from Task 2.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Link from the when-to-go holidays section**

In `src/components/WhenToGoPage.astro`, immediately after the holiday list closes
inside the `t('wtg.holidays')` section, add:

```astro
        <p class="section-more">
          <a href={localizePath('/tools/whats-closed', lang)}>{t('wc.title')} →</a>
        </p>
```

`localizePath` and `t` are already imported in that file — do not add imports.

- [ ] **Step 2: Link from the footer**

In `src/components/Footer.astro`, directly after the existing
`<a href={localizePath('/tools/best-time', lang)}>{t('nav.quietTimes')}</a>` line:

```astro
      <a href={localizePath('/tools/whats-closed', lang)}>{t('wc.title')}</a>
```

- [ ] **Step 3: Full verification before pushing**

```bash
cd /c/Users/user/wa-main && pwd && node --test src/lib/whats-closed.test.mjs src/i18n/whats-closed-keys.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail)"; node scripts/lint-regex.mjs 2>&1 | tail -2; node scripts/validate-content.mjs 2>&1 | tail -3
```

Expected: `fail 0`, the regex lint clean, the validator clean.

```bash
cd /c/Users/user/wa-main && pwd && npm run build 2>&1 | tail -4
```

Expected: the log ends with `Complete!`.

- [ ] **Step 4: Commit and push**

```bash
cd /c/Users/user/wa-main && pwd && git add src/components/WhenToGoPage.astro src/components/Footer.astro && git commit -m "feat: link the whats-closed tool from when-to-go and the footer" && git push origin main
```

- [ ] **Step 5: Verify live once the deploy lands**

```bash
cd /c/Users/user/wa-main && pwd && for p in "/tools/whats-closed/" "/ko/tools/whats-closed/" "/ja/tools/whats-closed/" "/es/tools/whats-closed/" "/zh/tools/whats-closed/"; do echo "$(curl -s -o /dev/null -w '%{http_code}' -m 25 https://wanderatlasguides.com$p)  $p"; done
```

Expected: five `200`s.

```bash
cd /c/Users/user/wa-main && pwd && curl -s -m 25 "https://wanderatlasguides.com/ko/tools/whats-closed/" | grep -c "내 여행 날짜에"
```

Expected: at least `1`. A `0` means the `ko` block of `ui.ts` did not take — check Task 2.

---

## Self-Review

**Spec coverage.** Holidays in range → Task 1 `holidaysInRange`, rendered in Task 3.
Weekly closures → Task 1 `closuresInRange`, rendered in Task 3. The `hoursOmitted`
exclusion → Task 1, tested. No holiday-hours claim → the `wc.caveat` string in Task 2,
shown in Task 3. Five languages → Task 2 with its own test, Task 3's routes, verified
live in Task 4. Internal links from when-to-go and the footer → Task 4. `llms.txt` →
Task 3 Step 3. The spec's testing table maps to Task 1 (unit), Task 2 (key coverage),
Task 3 Steps 4–5 (build), Task 4 Step 5 (live).

One spec line is deliberately not implemented here: the spec also names the country
guides as a link source. Those bodies are generated prose, and editing 20 guides is a
content change rather than a tool change — it belongs to whichever run next touches
those files.

**Placeholders.** None: every step carries the code or the command it needs.

**Type consistency.** `closuresInRange` returns `{date, weekday, venues[{slug, name, city}]}`
in Task 1 and is read with exactly those names in Task 3. `holidaysInRange` returns
`{date, localName, name}`, and Task 3 passes them to `holidayLabel(country, localName, name, lang)` in that order — the local name comes FIRST in that signature. The `wc.*`
key list in Task 2's test matches every key Task 3 calls; `wc.closedOn` was dropped
from both after the render stopped needing a per-venue weekday label.
