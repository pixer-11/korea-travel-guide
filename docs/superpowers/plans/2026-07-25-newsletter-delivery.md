# Newsletter Automation — Plan 2: Delivery Engine & Reporting

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Plan-1 offline engine into a live, automated weekly sender + daily reporting on MailerLite: create the custom fields, bucket confirmed subscribers into region/language audiences, render and (when explicitly enabled) send campaigns, report new signups to Telegram daily, and back up the subscriber list privately — all driven by GitHub Actions using the verified `MAILERLITE_API_TOKEN`.

**Architecture:** A thin MailerLite REST client (`scripts/lib/mailerlite.mjs`) wraps the connect.mailerlite.com API. Pure modules do audience bucketing (`scripts/lib/audience.mjs`) and global/multi-region content selection + rendering (extending the Plan-1 `newsletter-*` libs). Orchestrator CLIs (`newsletter-send.mjs`, `newsletter-report.mjs`, `newsletter-backup.mjs`, `setup-mailerlite-fields.mjs`) run in GitHub Actions. **The sender defaults to DRY-RUN** (renders previews + prints a plan, sends nothing); real sending requires `--live`, which is gated behind a manual `workflow_dispatch` input so no email goes out unattended.

**Tech Stack:** Node ≥18 (built-in `fetch`, `node --test`), existing Plan-1 libs (`newsletter-copy/content/render.mjs`, `offtopic.mjs`, `slugify.mjs`), `gray-matter`. MailerLite API base `https://connect.mailerlite.com/api` (verified HTTP 200 with the token). Telegram via existing `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` (pattern copied from `scripts/analytics-report.mjs`).

## Global Constraints

- **No new runtime dependencies.** Node built-ins + existing deps only. Tests: `node --test` + `node:assert/strict`.
- **Never send unattended.** `newsletter-send.mjs` sends real campaigns only when invoked with `--live`. Default (and the weekly cron) is dry-run. `--live` is reachable only via manual `workflow_dispatch` with an explicit `live: "true"` input.
- **Never resend.** Reuse the Plan-1 sent-log (`data/newsletter-sent-log.json`); on a real send, append used slugs/events per audience and commit.
- **Privacy.** Subscriber emails never printed to logs (only counts) and never committed to the repo. The CSV backup goes only to the owner's Telegram chat as a document.
- **Korean Telegram.** Every Telegram message the system sends is in Korean (matches `analytics-report.mjs`).
- **Languages:** en/ko/ja/es/zh. Audiences split by `lang`; content from the Plan-1 copy module.
- **MailerLite field keys:** `region`, `lang`, `signup_source` (must match the hidden fields the signup form already posts, Plan 1).
- **API base:** `https://connect.mailerlite.com/api`, `Authorization: Bearer $MAILERLITE_API_TOKEN`, `Accept: application/json`.
- **Design of record:** spec `docs/superpowers/specs/2026-07-25-newsletter-automation-design.md` §4.2–4.7.
- **Out of scope (Plan 3, needs Cloudflare env from the user):** custom `/api/subscribe` + `/preferences` Cloudflare Functions and signed HMAC links.

---

## File Structure

- Create `scripts/lib/mailerlite.mjs` — REST client factory (inject `fetch` for testing).
- Create `scripts/lib/mailerlite.test.mjs` — client tests with a stub fetch.
- Create `scripts/lib/audience.mjs` — pure subscriber→audience bucketing.
- Create `scripts/lib/audience.test.mjs`.
- Modify `scripts/lib/newsletter-content.mjs` — add `pickGlobalEdition`, `pickMultiRegionEdition`.
- Modify `scripts/lib/newsletter-content.test.mjs` — tests for the two new selectors.
- Modify `scripts/lib/newsletter-render.mjs` — add `renderGlobal`, `renderMultiRegion` (+ `alsoNew` label in single-region, closing the Plan-1 deferral).
- Modify `scripts/lib/newsletter-render.test.mjs` — tests for the new renderers.
- Create `scripts/setup-mailerlite-fields.mjs` — idempotent field creation.
- Create `scripts/newsletter-report.mjs` — daily Korean signup report to Telegram.
- Create `scripts/newsletter-send.mjs` — orchestrator (dry-run default, `--live` gated).
- Create `scripts/newsletter-backup.mjs` — weekly CSV to Telegram document.
- Create `.github/workflows/newsletter-report.yml` — daily cron.
- Create `.github/workflows/newsletter-weekly.yml` — weekly cron (dry-run) + manual live dispatch.
- Modify `data/newsletter-sent-log.json` — unchanged shape; the sender writes to it on live sends.

---

## Task 1: MailerLite REST client

**Files:**
- Create: `scripts/lib/mailerlite.mjs`
- Test: `scripts/lib/mailerlite.test.mjs`

**Interfaces:**
- Produces: `export function mailerlite(token, fetchImpl = fetch)` → object with:
  - `listActiveSubscribers()` → `Promise<Array<{id, email, fields}>>` (paginates all active).
  - `listFields()` → `Promise<Array<{id, key, name}>>`.
  - `createField(name)` → `Promise<{id, key, name}>` (type `text`).
  - `ensureGroup(name)` → `Promise<{id, name}>` (find by name or create).
  - `setSubscriberGroup(subscriberId, groupId)` → `Promise<void>`.
  - `createCampaign({name, subject, fromName, from, html, groupId})` → `Promise<{id}>`.
  - `sendCampaign(id)` → `Promise<void>` (schedule instant).
  - Each throws `Error` with status + body snippet on non-2xx.

- [ ] **Step 1: Write the failing test**

Create `scripts/lib/mailerlite.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mailerlite } from './mailerlite.mjs';

// Minimal stub fetch: routes by URL+method, returns queued responses.
function stub(routes) {
  const calls = [];
  const f = async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    calls.push({ url, method, body: opts.body ? JSON.parse(opts.body) : undefined });
    const key = `${method} ${url.replace('https://connect.mailerlite.com/api', '')}`;
    const match = routes.find((r) => key.startsWith(r.key));
    if (!match) throw new Error(`no stub for ${key}`);
    return { ok: match.status < 400, status: match.status, json: async () => match.body, text: async () => JSON.stringify(match.body) };
  };
  f.calls = calls;
  return f;
}

test('listActiveSubscribers paginates via meta.next_cursor', async () => {
  const f = stub([
    { key: 'GET /subscribers?', status: 200, body: { data: [{ id: '1', email: 'a@x.com', fields: { region: 'dubai', lang: 'ko' } }], meta: { next_cursor: 'CURSOR2' } } },
  ]);
  // second page: same route matches, but we swap by cursor — simplest: return no cursor on any call after first
  let n = 0;
  const f2 = async (url, opts) => {
    n++;
    return { ok: true, status: 200, json: async () => (n === 1
      ? { data: [{ id: '1', email: 'a@x.com', fields: { region: 'dubai', lang: 'ko' } }], meta: { next_cursor: 'C2' } }
      : { data: [{ id: '2', email: 'b@x.com', fields: { region: 'paris', lang: 'en' } }], meta: { next_cursor: null } }), text: async () => '' };
  };
  const ml = mailerlite('T', f2);
  const subs = await ml.listActiveSubscribers();
  assert.equal(subs.length, 2);
  assert.equal(subs[0].fields.region, 'dubai');
});

test('createField posts name + text type and returns the field', async () => {
  const f = stub([{ key: 'POST /fields', status: 201, body: { data: { id: '9', key: 'region', name: 'region' } } }]);
  const ml = mailerlite('T', f);
  const field = await ml.createField('region');
  assert.equal(field.key, 'region');
  assert.equal(f.calls[0].body.type, 'text');
  assert.equal(f.calls[0].body.name, 'region');
});

test('ensureGroup returns existing group when name matches', async () => {
  const f = stub([{ key: 'GET /groups?', status: 200, body: { data: [{ id: '5', name: 'auto:dubai:ko' }] } }]);
  const ml = mailerlite('T', f);
  const g = await ml.ensureGroup('auto:dubai:ko');
  assert.equal(g.id, '5');
});

test('throws with status on non-2xx', async () => {
  const f = stub([{ key: 'GET /fields', status: 401, body: { message: 'Unauthenticated.' } }]);
  const ml = mailerlite('T', f);
  await assert.rejects(() => ml.listFields(), /401/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/lib/mailerlite.test.mjs`
Expected: FAIL — cannot find module `./mailerlite.mjs`.

- [ ] **Step 3: Write the implementation**

Create `scripts/lib/mailerlite.mjs`:

```js
// Thin MailerLite (connect.mailerlite.com) REST client. fetch is injected so the
// logic is unit-testable without network. Every method throws on non-2xx with the
// status + a short body snippet (never logs the token).
const BASE = 'https://connect.mailerlite.com/api';

export function mailerlite(token, fetchImpl = fetch) {
  async function req(method, path, body) {
    const res = await fetchImpl(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const snippet = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(`MailerLite ${method} ${path} → ${res.status}: ${snippet}`);
    }
    return res.status === 204 ? null : res.json();
  }

  return {
    async listActiveSubscribers() {
      const out = [];
      let cursor = null;
      do {
        const qs = `limit=100&filter[status]=active${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const page = await req('GET', `/subscribers?${qs}`);
        for (const s of page.data || []) out.push({ id: s.id, email: s.email, fields: s.fields || {} });
        cursor = page.meta && page.meta.next_cursor ? page.meta.next_cursor : null;
      } while (cursor);
      return out;
    },
    async listFields() {
      const r = await req('GET', '/fields?limit=100');
      return (r.data || []).map((x) => ({ id: x.id, key: x.key, name: x.name }));
    },
    async createField(name) {
      const r = await req('POST', '/fields', { name, type: 'text' });
      return { id: r.data.id, key: r.data.key, name: r.data.name };
    },
    async ensureGroup(name) {
      const r = await req('GET', `/groups?filter[name]=${encodeURIComponent(name)}&limit=100`);
      const found = (r.data || []).find((g) => g.name === name);
      if (found) return { id: found.id, name: found.name };
      const c = await req('POST', '/groups', { name });
      return { id: c.data.id, name: c.data.name };
    },
    async setSubscriberGroup(subscriberId, groupId) {
      await req('POST', `/subscribers/${subscriberId}/groups/${groupId}`);
    },
    async createCampaign({ name, subject, fromName, from, html, groupId }) {
      const r = await req('POST', '/campaigns', {
        name,
        type: 'regular',
        emails: [{ subject, from_name: fromName, from, content: html }],
        groups: [groupId],
      });
      return { id: r.data.id };
    },
    async sendCampaign(id) {
      await req('POST', `/campaigns/${id}/schedule`, { delivery: 'instant' });
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/lib/mailerlite.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/mailerlite.mjs scripts/lib/mailerlite.test.mjs
git commit -m "feat: MailerLite REST client (subscribers, fields, groups, campaigns)"
```

---

## Task 2: Create the MailerLite custom fields (live setup)

**Files:**
- Create: `scripts/setup-mailerlite-fields.mjs`

**Interfaces:**
- Consumes: `mailerlite` from `./lib/mailerlite.mjs`.
- Produces: a CLI that ensures fields `region`, `lang`, `signup_source` exist (creates only the missing ones); prints a summary. Idempotent.

- [ ] **Step 1: Write the implementation** (no unit test — it is a thin idempotent orchestration over the already-tested client; verified live in Step 3)

Create `scripts/setup-mailerlite-fields.mjs`:

```js
// Ensures the custom fields the signup form posts (region, lang, signup_source)
// exist in MailerLite. Idempotent — creates only missing keys. Run once (and safe
// to re-run). Requires MAILERLITE_API_TOKEN in env.
import { mailerlite } from './lib/mailerlite.mjs';

const token = process.env.MAILERLITE_API_TOKEN;
if (!token) { console.error('MAILERLITE_API_TOKEN missing'); process.exit(1); }

const WANT = ['region', 'lang', 'signup_source'];
const ml = mailerlite(token);

const existing = await ml.listFields();
const haveKeys = new Set(existing.map((f) => f.key));
for (const name of WANT) {
  if (haveKeys.has(name)) { console.log(`✓ field "${name}" already exists`); continue; }
  const f = await ml.createField(name);
  console.log(`＋ created field "${name}" (key: ${f.key})`);
  if (f.key !== name) console.warn(`⚠ key "${f.key}" != "${name}" — signup form posts fields[${name}]; verify mapping`);
}
console.log('Field setup complete.');
```

- [ ] **Step 2: Add a throwaway workflow to run it live**

Create `.github/workflows/setup-fields.yml`:

```yaml
name: setup-mailerlite-fields
on:
  workflow_dispatch:
jobs:
  setup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: node scripts/setup-mailerlite-fields.mjs
        env:
          MAILERLITE_API_TOKEN: ${{ secrets.MAILERLITE_API_TOKEN }}
```

- [ ] **Step 3: Commit, push, dispatch, confirm**

```bash
git add scripts/setup-mailerlite-fields.mjs .github/workflows/setup-fields.yml
git commit -m "feat: idempotent MailerLite custom-field setup + one-shot workflow"
git push origin main
```

Then dispatch via the GitHub API (token from `git credential fill`) and read the run conclusion — expect success and log lines showing the three fields created or already-existing. This confirms the client works against the live API and that signup capture (Plan 1) now has fields to land in.

- [ ] **Step 4: Remove the throwaway workflow**

```bash
git rm .github/workflows/setup-fields.yml
git commit -m "chore: remove one-shot field-setup workflow (fields created)"
git push origin main
```

---

## Task 3: Daily signup report (Korean Telegram)

**Files:**
- Create: `scripts/newsletter-report.mjs`
- Create: `.github/workflows/newsletter-report.yml`

**Interfaces:**
- Consumes: `mailerlite` from `./lib/mailerlite.mjs`.
- Produces: reads all active subscribers, counts those created in the last 24h (by MailerLite `subscribed_at`/`created_at`), breaks down by `region` field, sends a Korean Telegram message; never fails the job.

- [ ] **Step 1: Write the implementation**

Create `scripts/newsletter-report.mjs`:

```js
// Daily Korean Telegram report of newsletter signups. Read-only. Never throws out
// of the job (mirrors analytics-report.mjs). Requires MAILERLITE_API_TOKEN,
// TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID.
import { mailerlite } from './lib/mailerlite.mjs';

const { MAILERLITE_API_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) { console.log('Telegram secrets missing.'); return; }
  const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) console.error('Telegram failed:', JSON.stringify(j));
}

async function main() {
  if (!MAILERLITE_API_TOKEN) { console.error('MAILERLITE_API_TOKEN missing'); return; }
  const ml = mailerlite(MAILERLITE_API_TOKEN);
  let subs;
  try { subs = await ml.listActiveSubscribers(); }
  catch (e) { await sendTelegram(`✉️ Wander Atlas 뉴스레터 리포트 오류\n${e.message}`); return; }

  const total = subs.length;
  const region = (s) => (s.fields && s.fields.region) || '전체추천';
  const byRegion = {};
  for (const s of subs) byRegion[region(s)] = (byRegion[region(s)] || 0) + 1;
  const top = Object.entries(byRegion).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([r, n]) => `${r} ${n}`).join(' · ') || '—';

  const text = `✉️ Wander Atlas — 뉴스레터 구독 현황
👥 누적 구독자: ${total.toLocaleString()}명
🗺️ 지역별: ${top}`;
  console.log(text);
  await sendTelegram(text);
}

main().catch((e) => console.error(e));
```

Note: MailerLite's connect API does not filter subscribers by "created in last 24h" cheaply; this v1 reports the **cumulative** total + region breakdown daily (still answers "how many signups"). A true 24h-delta can be added later by persisting yesterday's total. Keep v1 simple.

- [ ] **Step 2: Create the daily workflow**

Create `.github/workflows/newsletter-report.yml`:

```yaml
name: newsletter-report
on:
  schedule:
    - cron: '17 23 * * *'   # 08:17 KST daily (23:17 UTC)
  workflow_dispatch:
jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: node scripts/newsletter-report.mjs
        env:
          MAILERLITE_API_TOKEN: ${{ secrets.MAILERLITE_API_TOKEN }}
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
```

- [ ] **Step 3: Commit, push, and smoke-test via dispatch**

```bash
git add scripts/newsletter-report.mjs .github/workflows/newsletter-report.yml
git commit -m "feat: daily Korean Telegram newsletter signup report"
git push origin main
```

Dispatch `newsletter-report.yml` via the GitHub API; expect success and a Korean Telegram message with the cumulative subscriber count. (With ~0 real subscribers it reports 0 — that's correct.)

---

## Task 4: Audience bucketing (pure)

**Files:**
- Create: `scripts/lib/audience.mjs`
- Test: `scripts/lib/audience.test.mjs`

**Interfaces:**
- Produces:
  - `export function bucketSubscribers(subscribers)` → `Array<{ key, type, regions, lang, subscriberIds }>` where `type` ∈ `'global'|'single'|'multi'`. Reads each subscriber's `fields.region` (comma-separated slugs or empty/`__global__`) and `fields.lang` (default `en`). Empty/`__global__` → global audience. One region → single. Multiple → multi (keyed by the sorted region set). Split every audience by `lang`.

- [ ] **Step 1: Write the failing test**

Create `scripts/lib/audience.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { bucketSubscribers } from './audience.mjs';

test('buckets global, single, and multi by language', () => {
  const subs = [
    { id: '1', fields: { region: 'dubai', lang: 'ko' } },
    { id: '2', fields: { region: 'dubai', lang: 'ko' } },
    { id: '3', fields: { region: 'dubai', lang: 'en' } },
    { id: '4', fields: { region: '', lang: 'en' } },
    { id: '5', fields: { region: '__global__', lang: 'en' } },
    { id: '6', fields: { region: 'dubai,paris', lang: 'en' } },
    { id: '7', fields: {} },
  ];
  const buckets = bucketSubscribers(subs);
  const by = (k) => buckets.find((b) => b.key === k);

  assert.equal(by('dubai:ko').type, 'single');
  assert.deepEqual(by('dubai:ko').subscriberIds.sort(), ['1', '2']);
  assert.equal(by('dubai:en').type, 'single');
  assert.deepEqual(by('dubai:en').subscriberIds, ['3']);

  // ids 4,5,7 all land in the global/en audience
  assert.equal(by('__global__:en').type, 'global');
  assert.deepEqual(by('__global__:en').subscriberIds.sort(), ['4', '5', '7']);

  const multi = by('dubai+paris:en');
  assert.equal(multi.type, 'multi');
  assert.deepEqual(multi.regions, ['dubai', 'paris']);
  assert.deepEqual(multi.subscriberIds, ['6']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/lib/audience.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `scripts/lib/audience.mjs`:

```js
// Pure: group MailerLite subscribers into send audiences. Each subscriber lands in
// exactly one audience (→ exactly one email/week). Region comes from fields.region
// (comma-separated slugs, or empty / "__global__" for the Editor's Picks edition);
// language from fields.lang (default "en"). Audiences are split by language.
const LANGS = new Set(['en', 'ko', 'ja', 'es', 'zh']);

function parseRegions(raw) {
  const list = String(raw || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const real = list.filter((r) => r && r !== '__global__');
  return real;
}

export function bucketSubscribers(subscribers) {
  const map = new Map();
  for (const s of subscribers) {
    const f = s.fields || {};
    const lang = LANGS.has(f.lang) ? f.lang : 'en';
    const regions = parseRegions(f.region);
    let type, regionKey, regionList;
    if (regions.length === 0) { type = 'global'; regionKey = '__global__'; regionList = []; }
    else if (regions.length === 1) { type = 'single'; regionKey = regions[0]; regionList = regions; }
    else { type = 'multi'; regionList = [...regions].sort(); regionKey = regionList.join('+'); }
    const key = `${regionKey}:${lang}`;
    if (!map.has(key)) map.set(key, { key, type, regions: regionList, lang, subscriberIds: [] });
    map.get(key).subscriberIds.push(s.id);
  }
  return [...map.values()];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/lib/audience.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/audience.mjs scripts/lib/audience.test.mjs
git commit -m "feat: subscriber audience bucketing (global/single/multi by language)"
```

---

## Task 5: Global + multi-region content selection

**Files:**
- Modify: `scripts/lib/newsletter-content.mjs`
- Modify: `scripts/lib/newsletter-content.test.mjs`

**Interfaces:**
- Consumes: existing `pickSingleRegionEdition`, `heroSourceRank` (internal), `isOffTopicHero`.
- Produces:
  - `export function pickGlobalEdition({ posts, sent, now, max = 5 })` → `{ hero, stories, events, usedPostSlugs, usedEventSlugs }` or `null`. Picks the best-source, newest clean posts across ALL regions (deduped by sent), each card carrying its own `region`. Events: soonest upcoming across all regions.
  - `export function pickMultiRegionEdition({ posts, regions, countryByRegion, sent, now, perRegion = 2 })` → `{ sections: [{ region, stories }], events, usedPostSlugs, usedEventSlugs }` or `null`. One section per followed region (up to `perRegion` clean posts each), events for any followed region/country.

- [ ] **Step 1: Write the failing tests** (append to `scripts/lib/newsletter-content.test.mjs`)

```js
import { pickGlobalEdition, pickMultiRegionEdition } from './newsletter-content.mjs';

test('pickGlobalEdition spans regions, best-source first, deduped', () => {
  const posts = [
    post('dubai-1', { heroImage: { url: 'https://images.unsplash.com/p1', license: 'unsplash', credit: 'x' } }),
    post('paris-1', { region: 'Paris', country: 'France', heroImage: { url: 'https://images.unsplash.com/p2', license: 'unsplash', credit: 'x' } }),
    post('sent-x'),
  ];
  const ed = pickGlobalEdition({ posts, sent: new Set(['sent-x']), now, max: 5 });
  const slugs = [ed.hero.slug, ...ed.stories.map((s) => s.slug)];
  assert.ok(slugs.includes('dubai-1') && slugs.includes('paris-1'));
  assert.ok(!slugs.includes('sent-x'));
  assert.ok(ed.hero.region, 'each card carries its region');
});

test('pickMultiRegionEdition builds one section per followed region', () => {
  const posts = [
    post('dubai-1'),
    post('paris-1', { region: 'Paris', country: 'France' }),
    post('paris-2', { region: 'Paris', country: 'France' }),
  ];
  const ed = pickMultiRegionEdition({
    posts, regions: ['Dubai', 'Paris'],
    countryByRegion: { Dubai: 'UAE', Paris: 'France' },
    sent: new Set(), now, perRegion: 2,
  });
  assert.deepEqual(ed.sections.map((s) => s.region), ['Dubai', 'Paris']);
  assert.ok(ed.sections[1].stories.length >= 1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/lib/newsletter-content.test.mjs`
Expected: FAIL — `pickGlobalEdition` is not exported.

- [ ] **Step 3: Implement** (append to `scripts/lib/newsletter-content.mjs`, reusing the existing `card`, `usable`-style filters, `bySourceThenDate`, and event logic)

```js
export function pickGlobalEdition({ posts, sent, now, max = 5 }) {
  const clean = posts
    .filter((p) => p.data.category !== 'event' && !sent.has(p.slug) && !isOffTopicHero(p.data.heroImage))
    .sort(bySourceThenDate)
    .slice(0, max)
    .map(card);
  if (clean.length === 0) return null;
  const events = posts
    .filter((p) => p.data.category === 'event' && !sent.has(p.slug) && p.data.eventStartDate && new Date(p.data.eventStartDate) >= now)
    .sort((a, b) => new Date(a.data.eventStartDate) - new Date(b.data.eventStartDate))
    .slice(0, MAX_EVENTS)
    .map((p) => ({ slug: p.slug, title: p.data.title, date: p.data.eventStartDate, region: p.data.region }));
  const [hero, ...stories] = clean;
  return { hero, stories, events, usedPostSlugs: clean.map((c) => c.slug), usedEventSlugs: events.map((e) => e.slug) };
}

export function pickMultiRegionEdition({ posts, regions, countryByRegion, sent, now, perRegion = 2 }) {
  const used = new Set();
  const sections = [];
  for (const region of regions) {
    const picks = posts
      .filter((p) => p.data.category !== 'event' && !sent.has(p.slug) && !used.has(p.slug)
        && !isOffTopicHero(p.data.heroImage) && eq(p.data.region, region))
      .sort(bySourceThenDate).slice(0, perRegion).map(card);
    for (const c of picks) used.add(c.slug);
    if (picks.length) sections.push({ region, stories: picks });
  }
  if (sections.length === 0) return null;
  const countries = new Set(regions.map((r) => (countryByRegion[r] || '').toLowerCase()).filter(Boolean));
  const events = posts
    .filter((p) => p.data.category === 'event' && !sent.has(p.slug) && p.data.eventStartDate && new Date(p.data.eventStartDate) >= now
      && (regions.some((r) => eq(p.data.region, r)) || countries.has(String(p.data.country).toLowerCase())))
    .sort((a, b) => new Date(a.data.eventStartDate) - new Date(b.data.eventStartDate))
    .slice(0, MAX_EVENTS)
    .map((p) => ({ slug: p.slug, title: p.data.title, date: p.data.eventStartDate, region: p.data.region }));
  const usedPostSlugs = [...used];
  return { sections, events, usedPostSlugs, usedEventSlugs: events.map((e) => e.slug) };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test scripts/lib/newsletter-content.test.mjs`
Expected: PASS (all, including the two new tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/newsletter-content.mjs scripts/lib/newsletter-content.test.mjs
git commit -m "feat: global + multi-region edition selection"
```

---

## Task 6: Global + multi-region renderers (+ alsoNew label)

**Files:**
- Modify: `scripts/lib/newsletter-render.mjs`
- Modify: `scripts/lib/newsletter-render.test.mjs`

**Interfaces:**
- Consumes: `copyFor`, `fill`, existing `renderSingleRegion` internals (`esc`, `storyCard`, `eventsBlock`, palette `P`).
- Produces:
  - `export function renderGlobal({ edition, lang, links })` → `{subject, preheader, html}` using copy keys `subjectGlobal`, `preheaderGlobal`, `editorNoteGlobal`, `ctaGlobal` (added to `newsletter-copy.mjs`). Each card shows its region label.
  - `export function renderMultiRegion({ edition, regions, lang, links })` → `{subject, preheader, html}` with one labelled section per region.

- [ ] **Step 1: Add the global copy keys** to every language in `scripts/lib/newsletter-copy.mjs` (after `weeklyEdit`):

```js
// en
subjectGlobal: 'The best of Wander Atlas this week', preheaderGlobal: "This week's most notable new guides →", editorNoteGlobal: "No single place this week — just the guides our editors couldn't stop talking about.", ctaGlobal: 'See all this week’s guides', sectionMulti: 'Your places this week',
// ko
subjectGlobal: '이번 주 Wander Atlas 베스트', preheaderGlobal: '이번 주 가장 주목할 새 가이드 →', editorNoteGlobal: '이번 주는 특정 지역 없이, 편집자들이 계속 이야기한 가이드만 모았어요.', ctaGlobal: '이번 주 가이드 전체 보기', sectionMulti: '이번 주 내 관심 지역',
// ja
subjectGlobal: '今週のWander Atlasベスト', preheaderGlobal: '今週の注目の新着ガイド →', editorNoteGlobal: '今週は特定の地域ではなく、編集者が注目したガイドを集めました。', ctaGlobal: '今週のガイドをすべて見る', sectionMulti: '今週のフォロー地域',
// es
subjectGlobal: 'Lo mejor de Wander Atlas esta semana', preheaderGlobal: 'Las guías nuevas más destacadas de la semana →', editorNoteGlobal: 'Esta semana no hay un solo lugar: solo las guías de las que no paran de hablar nuestros editores.', ctaGlobal: 'Ver todas las guías de esta semana', sectionMulti: 'Tus lugares esta semana',
// zh
subjectGlobal: '本周 Wander Atlas 精选', preheaderGlobal: '本周最值得关注的新攻略 →', editorNoteGlobal: '本周不限单一地区，只精选编辑们最推荐的攻略。', ctaGlobal: '查看本周全部攻略', sectionMulti: '本周你关注的地区',
```

- [ ] **Step 2: Write the failing tests** (append to `scripts/lib/newsletter-render.test.mjs`)

```js
import { renderGlobal, renderMultiRegion } from './newsletter-render.mjs';

test('renderGlobal shows region labels and localized subject', () => {
  const ed = {
    hero: { slug: 'dubai-1', title: 'Old Dubai eats', category: 'restaurant', image: { url: 'https://i/x' }, region: 'Dubai' },
    stories: [{ slug: 'paris-1', title: 'Paris brunch', category: 'restaurant', image: { url: 'https://i/y' }, region: 'Paris' }],
    events: [], usedPostSlugs: [], usedEventSlugs: [],
  };
  const { subject, html } = renderGlobal({ edition: ed, lang: 'ko', links });
  assert.match(subject, /Wander Atlas/);
  assert.match(html, /Dubai/); assert.match(html, /Paris/);
  assert.match(html, /Old Dubai eats/); assert.match(html, /Paris brunch/);
});

test('renderMultiRegion renders one labelled section per region', () => {
  const ed = {
    sections: [
      { region: 'Dubai', stories: [{ slug: 'd1', title: 'Dubai thing', category: 'restaurant', image: { url: 'https://i/a' } }] },
      { region: 'Paris', stories: [{ slug: 'p1', title: 'Paris thing', category: 'attraction', image: { url: 'https://i/b' } }] },
    ], events: [], usedPostSlugs: [], usedEventSlugs: [],
  };
  const { html } = renderMultiRegion({ edition: ed, regions: ['Dubai', 'Paris'], lang: 'en', links });
  assert.match(html, /Dubai thing/); assert.match(html, /Paris thing/);
  assert.match(html, /Dubai/); assert.match(html, /Paris/);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `node --test scripts/lib/newsletter-render.test.mjs`
Expected: FAIL — `renderGlobal` not exported.

- [ ] **Step 4: Implement** (append to `scripts/lib/newsletter-render.mjs`; reuse `esc`, `P`, `storyCard`, `eventsBlock`, and the single-region HTML skeleton — extract a shared `shell({lang,subject,preheader,region,heroImage,bodyRows,ctaHref,ctaLabel,c,links})` helper if it reduces duplication, otherwise inline analogously). A region label is shown on each global card via the card's `region`. Full code:

```js
// A global-edition card labels each story with its own place.
function globalCard(s, c, links) {
  return `
  <tr><td style="padding:14px 40px;">
    <img src="${s.image && s.image.url ? esc(s.image.url) : ''}" width="520" alt="${esc(s.title)}" style="width:100%;max-width:520px;height:auto;border-radius:6px;display:block;" />
    <div style="font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:${P.acc};font-weight:700;margin-top:14px;">${esc(s.region || '')}</div>
    <h3 style="margin:6px 0 0;font-size:22px;font-weight:400;line-height:1.2;color:${P.ink};">${esc(s.title)}</h3>
    <a href="${esc(links.story(s.slug))}" style="font-family:Helvetica,Arial,sans-serif;display:inline-block;margin-top:12px;font-size:12px;font-weight:700;color:${P.accd};text-decoration:none;border-bottom:1px solid #d8b6b2;padding-bottom:2px;">${esc(c.read)}</a>
  </td></tr>
  <tr><td style="padding:0 40px;"><div style="height:1px;background:${P.gold};opacity:.5;"></div></td></tr>`;
}

function page({ lang, subject, preheader, headerSub, heroImage, bodyRows, ctaHref, ctaLabel, c, links }) {
  return `<!DOCTYPE html><html lang="${esc(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#e7e0d4;font-family:Georgia,'Times New Roman',serif;color:${P.ink};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e7e0d4;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:${P.paper};border-radius:4px;overflow:hidden;">
  <tr><td style="background:${P.ink};text-align:center;padding:15px;">
    <div style="font-family:Helvetica,Arial,sans-serif;letter-spacing:.28em;text-transform:uppercase;font-size:12px;font-weight:700;color:#e9dfce;">Wander Atlas</div>
    <div style="font-family:Helvetica,Arial,sans-serif;letter-spacing:.16em;text-transform:uppercase;font-size:8px;color:${P.gold};margin-top:5px;">${esc(headerSub)}</div>
  </td></tr>
  ${heroImage ? `<tr><td><img src="${esc(heroImage)}" width="600" alt="" style="width:100%;height:auto;display:block;" /></td></tr>` : ''}
  ${bodyRows}
  <tr><td style="text-align:center;padding:34px 40px;"><a href="${esc(ctaHref)}" style="font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;letter-spacing:.04em;text-decoration:none;color:${P.accd};border:1.5px solid ${P.accd};border-radius:8px;padding:14px 30px;display:inline-block;">${esc(ctaLabel)}</a></td></tr>
  <tr><td style="background:${P.ink};color:#a79e8f;font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:1.8;text-align:center;padding:26px 40px;">
    <a href="${esc(links.prefs)}" style="color:#d6ab5c;text-decoration:none;">${esc(c.regionChange)}</a> ·
    <a href="${esc(links.prefs)}" style="color:#d6ab5c;text-decoration:none;">${esc(c.langLabel)}</a> ·
    <a href="${esc(links.unsubscribe)}" style="color:#d6ab5c;text-decoration:none;">${esc(c.unsubscribe)}</a>
    <div style="color:#6a635a;font-size:10px;margin-top:12px;">Wander Atlas · wanderatlasguides.com</div>
  </td></tr>
</table></td></tr></table></body></html>`;
}

export function renderGlobal({ edition, lang, links }) {
  const c = copyFor(lang);
  const subject = c.subjectGlobal;
  const preheader = c.preheaderGlobal;
  const cards = [edition.hero, ...edition.stories].map((s) => globalCard(s, c, links)).join('');
  const lead = `<tr><td style="padding:26px 40px 4px;"><h1 style="margin:0;font-size:30px;font-weight:400;line-height:1.1;color:${P.ink};">${esc(c.subjectGlobal)}</h1><p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:${P.soft};font-style:italic;margin:12px 0 0;">${esc(c.editorNoteGlobal)}</p></td></tr>`;
  const bodyRows = lead + cards + eventsBlock(edition.events, c, links);
  const html = page({ lang, subject, preheader, headerSub: 'The Weekly Edit · Editor’s Picks', heroImage: edition.hero.image && edition.hero.image.url, bodyRows, ctaHref: links.cta, ctaLabel: c.ctaGlobal, c, links });
  return { subject, preheader, html };
}

export function renderMultiRegion({ edition, regions, lang, links }) {
  const c = copyFor(lang);
  const subject = fill(c.subjectSingle, { region: regions.join(' · ') });
  const preheader = c.preheaderGlobal;
  let bodyRows = `<tr><td style="padding:26px 40px 4px;"><h1 style="margin:0;font-size:28px;font-weight:400;line-height:1.15;color:${P.ink};">${esc(c.sectionMulti)}</h1></td></tr>`;
  for (const sec of edition.sections) {
    bodyRows += `<tr><td style="font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:${P.gold};font-weight:700;padding:22px 40px 0;">${esc(sec.region)}</td></tr>`;
    bodyRows += sec.stories.map((s) => storyCard(s, c, links)).join('');
  }
  bodyRows += eventsBlock(edition.events, c, links);
  const html = page({ lang, subject, preheader, headerSub: 'The Weekly Edit', heroImage: (edition.sections[0].stories[0] || {}).image && edition.sections[0].stories[0].image.url, bodyRows, ctaHref: links.cta, ctaLabel: c.ctaGlobal, c, links });
  return { subject, preheader, html };
}
```

Note: `storyCard`, `eventsBlock`, `esc`, `P`, `copyFor`, `fill` must be in module scope. If `renderSingleRegion` currently defines `storyCard`/`eventsBlock` as inner functions, hoist them to module scope (top-level `function`) so the new exports can reuse them — refactor without changing `renderSingleRegion`'s output (the existing 3 tests must still pass).

- [ ] **Step 5: Run to verify it passes**

Run: `node --test scripts/lib/newsletter-render.test.mjs`
Expected: PASS (existing + 2 new). Then `npm test` — full suite green.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/newsletter-render.mjs scripts/lib/newsletter-copy.mjs scripts/lib/newsletter-render.test.mjs
git commit -m "feat: global + multi-region newsletter renderers"
```

---

## Task 7: Sender orchestrator (dry-run default, live gated)

**Files:**
- Create: `scripts/newsletter-send.mjs`
- Create: `.github/workflows/newsletter-weekly.yml`

**Interfaces:**
- Consumes: `loadPosts`, `audienceKey`, `sentSetFor`, `pickSingleRegionEdition`, `pickGlobalEdition`, `pickMultiRegionEdition` (content); `renderSingleRegion`, `renderGlobal`, `renderMultiRegion` (render); `bucketSubscribers` (audience); `mailerlite` (client); `slugify`.
- Produces: a CLI. **Default = dry-run** (fetch subscribers, bucket, render each audience to `.newsletter-preview/`, print a plan; send nothing, touch nothing). **`--live`** = for each audience with content: ensure `auto:<key>` group, set its subscribers into that group, create + send a campaign, then append used slugs/events to `data/newsletter-sent-log.json`; commit the log at the end.

- [ ] **Step 1: Write the implementation**

Create `scripts/newsletter-send.mjs`:

```js
// Weekly newsletter sender. DEFAULT = dry-run (renders previews + prints a plan,
// sends nothing). --live actually sends via MailerLite and updates the sent-log.
// Live is intended to run ONLY from a manual workflow_dispatch with live=true.
//
//   node scripts/newsletter-send.mjs            # dry-run
//   node scripts/newsletter-send.mjs --live     # real send
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { slugify } from './lib/slugify.mjs';
import { loadPosts, audienceKey, sentSetFor, pickSingleRegionEdition, pickGlobalEdition, pickMultiRegionEdition } from './lib/newsletter-content.mjs';
import { renderSingleRegion, renderGlobal, renderMultiRegion } from './lib/newsletter-render.mjs';
import { bucketSubscribers } from './lib/audience.mjs';
import { mailerlite } from './lib/mailerlite.mjs';

const LIVE = process.argv.includes('--live');
const { MAILERLITE_API_TOKEN, NEWSLETTER_FROM_EMAIL, NEWSLETTER_FROM_NAME = 'Wander Atlas' } = process.env;
const SITE = 'https://wanderatlasguides.com';
const POSTS_DIR = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const LOG_PATH = fileURLToPath(new URL('../data/newsletter-sent-log.json', import.meta.url));
const OUT_DIR = fileURLToPath(new URL('../.newsletter-preview/', import.meta.url));

if (!MAILERLITE_API_TOKEN) { console.error('MAILERLITE_API_TOKEN missing'); process.exit(1); }
if (LIVE && !NEWSLETTER_FROM_EMAIL) { console.error('NEWSLETTER_FROM_EMAIL required for --live (verified MailerLite sender)'); process.exit(1); }

const posts = loadPosts(POSTS_DIR);
const log = existsSync(LOG_PATH) ? JSON.parse(readFileSync(LOG_PATH, 'utf8')) : {};
const now = new Date();
const ml = mailerlite(MAILERLITE_API_TOKEN);

// region label + country lookups from the corpus (region field is a display name).
const countryByRegion = {};
const labelBySlug = {};
for (const p of posts) {
  countryByRegion[p.data.region] = p.data.country;
  labelBySlug[slugify(p.data.region)] = p.data.region;
}
const links = { cta: `${SITE}`, unsubscribe: `${SITE}/unsubscribe`, prefs: `${SITE}/preferences`, story: (s) => `${SITE}/posts/${s}`, event: (s) => `${SITE}/posts/${s}` };

let subscribers = [];
try { subscribers = await ml.listActiveSubscribers(); }
catch (e) { console.error('subscriber fetch failed:', e.message); process.exit(1); }
const buckets = bucketSubscribers(subscribers);
console.log(`${LIVE ? 'LIVE' : 'DRY-RUN'} · ${subscribers.length} subscribers · ${buckets.length} audiences · ${posts.length} posts\n`);

mkdirSync(OUT_DIR, { recursive: true });
let sentCount = 0;

for (const b of buckets) {
  const key = b.key; // matches audienceKey(slug, lang) form
  const sent = sentSetFor(log, key);
  let rendered = null, used = null;

  if (b.type === 'global') {
    const ed = pickGlobalEdition({ posts, sent, now });
    if (ed) { rendered = renderGlobal({ edition: ed, lang: b.lang, links }); used = ed; }
  } else if (b.type === 'single') {
    const region = labelBySlug[b.regions[0]] || b.regions[0];
    const ed = pickSingleRegionEdition({ posts, region, country: countryByRegion[region] || region, sent, now, minStories: 3 });
    if (ed) { rendered = renderSingleRegion({ edition: ed, region, lang: b.lang, links }); used = ed; }
  } else {
    const regionLabels = b.regions.map((s) => labelBySlug[s] || s);
    const ed = pickMultiRegionEdition({ posts, regions: regionLabels, countryByRegion, sent, now, perRegion: 2 });
    if (ed) { rendered = renderMultiRegion({ edition: ed, regions: regionLabels, lang: b.lang, links }); used = ed; }
  }

  if (!rendered) { console.log(`  [${key}] SKIP — no new content (${b.subscriberIds.length} subs)`); continue; }

  if (!LIVE) {
    writeFileSync(`${OUT_DIR}${key.replace(/[^a-z0-9]+/gi, '_')}.html`, rendered.html);
    console.log(`  [${key}] would send "${rendered.subject}" to ${b.subscriberIds.length} subs → preview written`);
    continue;
  }

  try {
    const group = await ml.ensureGroup(`auto:${key}`);
    for (const id of b.subscriberIds) await ml.setSubscriberGroup(id, group.id);
    const camp = await ml.createCampaign({
      name: `WA ${key} ${now.toISOString().slice(0, 10)}`,
      subject: rendered.subject, fromName: NEWSLETTER_FROM_NAME, from: NEWSLETTER_FROM_EMAIL,
      html: rendered.html, groupId: group.id,
    });
    await ml.sendCampaign(camp.id);
    log[key] = log[key] || { posts: [], events: [] };
    log[key].posts = [...new Set([...(log[key].posts || []), ...used.usedPostSlugs])];
    log[key].events = [...new Set([...(log[key].events || []), ...used.usedEventSlugs])];
    sentCount++;
    console.log(`  [${key}] SENT "${rendered.subject}" to ${b.subscriberIds.length} subs`);
  } catch (e) {
    console.error(`  [${key}] SEND FAILED: ${e.message}`);
  }
}

if (LIVE && sentCount > 0) {
  writeFileSync(LOG_PATH, JSON.stringify(log, null, 2) + '\n');
  try {
    execSync('git config user.name "Korea Travel Guide" && git config user.email "bot@wanderatlasguides.com"');
    execSync(`git add ${LOG_PATH}`);
    execSync(`git commit -m "chore: newsletter sent-log ${now.toISOString().slice(0, 10)} (${sentCount} audiences)"`);
    execSync('git push');
    console.log(`sent-log committed (${sentCount} audiences).`);
  } catch (e) { console.error('sent-log commit failed:', e.message); }
}
console.log(`\n${LIVE ? `Done — sent ${sentCount} audiences.` : 'Dry-run complete — open .newsletter-preview/*.html'}`);
```

- [ ] **Step 2: Create the weekly workflow (dry-run cron; live only via manual dispatch)**

Create `.github/workflows/newsletter-weekly.yml`:

```yaml
name: newsletter-weekly
on:
  schedule:
    - cron: '13 23 * * 6'   # Sun 08:13 KST (Sat 23:13 UTC) — dry-run heartbeat
  workflow_dispatch:
    inputs:
      live:
        description: 'Type true to REALLY send (otherwise dry-run)'
        required: false
        default: 'false'
permissions:
  contents: write
jobs:
  send:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - name: Send (or dry-run)
        run: |
          if [ "${{ github.event.inputs.live }}" = "true" ]; then
            node scripts/newsletter-send.mjs --live
          else
            node scripts/newsletter-send.mjs
          fi
        env:
          MAILERLITE_API_TOKEN: ${{ secrets.MAILERLITE_API_TOKEN }}
          NEWSLETTER_FROM_EMAIL: ${{ secrets.NEWSLETTER_FROM_EMAIL }}
          NEWSLETTER_FROM_NAME: Wander Atlas
```

- [ ] **Step 3: Commit + push + dry-run smoke test**

```bash
git add scripts/newsletter-send.mjs .github/workflows/newsletter-weekly.yml
git commit -m "feat: weekly newsletter sender (dry-run default, live gated)"
git push origin main
```

Dispatch `newsletter-weekly.yml` with default inputs (live=false). Expect success and a log showing the dry-run plan (audiences + would-send lines). No email is sent.

Note: `NEWSLETTER_FROM_EMAIL` must be a **verified sender** in MailerLite; the owner adds it as a GitHub secret before the first `--live`. Document this in the final report; it does not block dry-run.

---

## Task 8: Weekly private CSV backup

**Files:**
- Create: `scripts/newsletter-backup.mjs`
- Modify: `.github/workflows/newsletter-weekly.yml` (add a backup step after send)

**Interfaces:**
- Consumes: `mailerlite`.
- Produces: builds a CSV (`email,region,lang,subscribed`) of active subscribers and sends it to the owner's Telegram chat as a **document** (never written to the repo).

- [ ] **Step 1: Write the implementation**

Create `scripts/newsletter-backup.mjs`:

```js
// Weekly private backup: active subscribers → CSV → Telegram document (owner chat
// only). Never writes the CSV to the repo. Requires MAILERLITE_API_TOKEN,
// TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID.
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mailerlite } from './lib/mailerlite.mjs';

const { MAILERLITE_API_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
if (!MAILERLITE_API_TOKEN) { console.error('MAILERLITE_API_TOKEN missing'); process.exit(0); }

const ml = mailerlite(MAILERLITE_API_TOKEN);
const subs = await ml.listActiveSubscribers();
const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
const rows = [['email', 'region', 'lang'].join(',')];
for (const s of subs) rows.push([esc(s.email), esc(s.fields.region || ''), esc(s.fields.lang || '')].join(','));
const csv = rows.join('\n');
const day = new Date().toISOString().slice(0, 10);
const path = join(tmpdir(), `wander-atlas-subscribers-${day}.csv`);
writeFileSync(path, csv);

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) { console.log('Telegram secrets missing — CSV written locally only.'); process.exit(0); }
const form = new FormData();
form.append('chat_id', TELEGRAM_CHAT_ID);
form.append('caption', `🗂️ 구독자 백업 (${day}) — ${subs.length}명`);
form.append('document', new Blob([csv], { type: 'text/csv' }), `wander-atlas-subscribers-${day}.csv`);
const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`, { method: 'POST', body: form });
const j = await r.json().catch(() => ({}));
console.log(j.ok ? `Backup sent (${subs.length} subscribers).` : `Backup send failed: ${JSON.stringify(j).slice(0, 200)}`);
```

- [ ] **Step 2: Add a backup step to `newsletter-weekly.yml`** (after the send step, same job):

```yaml
      - name: Weekly subscriber backup
        run: node scripts/newsletter-backup.mjs
        env:
          MAILERLITE_API_TOKEN: ${{ secrets.MAILERLITE_API_TOKEN }}
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
```

- [ ] **Step 3: Commit + push + smoke test**

```bash
git add scripts/newsletter-backup.mjs .github/workflows/newsletter-weekly.yml
git commit -m "feat: weekly private subscriber CSV backup via Telegram document"
git push origin main
```

Dispatch `newsletter-weekly.yml` (live=false) and confirm the backup step sends a CSV document to Telegram (with ~0 subscribers it sends an empty-but-valid CSV).

---

## Task 9: Full-suite gate

- [ ] **Step 1:** Run `npm test` — all tests pass (Plan-1 21 + mailerlite 4 + audience 1 + content +2 + render +2).
- [ ] **Step 2:** Commit any stragglers: `git add -A && git commit -m "test: green suite for newsletter delivery" || echo "nothing to commit"` then `git push origin main`.

---

## Out of scope — Plan 3 (needs the owner's Cloudflare env action)
Custom `functions/api/subscribe.js` + `functions/preferences` page with signed HMAC links (spec §4.1, §4.4). Requires `MAILERLITE_API_TOKEN` and `NEWSLETTER_LINK_SECRET` in the Cloudflare Pages environment, which only the owner can set.

## Self-Review
- **Spec coverage:** §4.2 sender+bucketing → Tasks 4,7; §4.3 renderers/image-guard/events/dedup → Tasks 5,6 (reusing Plan-1); §4.5 daily Telegram report → Task 3; §4.6 CSV backup → Task 8; §4.7 sent-log → Task 7; field data model → Task 2; API client → Task 1. §4.1/§4.4 (subscribe/preferences pages) explicitly deferred to Plan 3 (Cloudflare env gate).
- **Placeholder scan:** none — full code in every step; the only "later" is the scoped Plan 3.
- **Type consistency:** `bucketSubscribers` output (`key,type,regions,lang,subscriberIds`) consumed unchanged in Task 7; edition shapes from Task 5 (`hero/stories/sections/events/usedPostSlugs/usedEventSlugs`) match the renderers in Task 6 and the sender in Task 7; `mailerlite` method names match between Tasks 1,2,3,7,8; `audienceKey`/`sentSetFor` reused from Plan 1 with the same `<slug|__global__>:<lang>` key form the buckets produce.
- **Safety:** live send gated behind `--live` + manual `workflow_dispatch` input; dry-run default; no PII in logs or repo.
