// node --test scripts/lib/search-report-extras.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bingCall, bingWeekLine } from './bing.mjs';
import { makeNavigationalTest, placeOfTitle, frontmatterScalar } from './navigational.mjs';

const D = (iso) => `/Date(${Date.parse(iso + 'T00:00:00Z')})/`;
const answer = (d) => async () => ({ ok: true, json: async () => ({ d }) });

test('the Bing line: last seven recorded days against the seven before', async () => {
  const days = Array.from({ length: 14 }, (_, i) => ({
    Date: D(`2026-09-${String(20 + i).padStart(2, '0')}`.replace('09-31', '10-01').replace('09-32', '10-02').replace('09-33', '10-03')),
    Clicks: i < 7 ? 10 : 20,
    Impressions: 100,
  }));
  const line = await bingWeekLine('k', answer(days));
  assert.match(line, /최근 7일\(10-03까지\): 👆 클릭 140, 직전 7일 70 \(\+100%\)/);
});

test('no key, a failed call, or too few days is said, never shown as zeros', async () => {
  assert.match(await bingWeekLine(''), /BING_API_KEY 가 없어 못 봤다/);
  assert.match(await bingWeekLine('k', async () => ({ ok: false, status: 400 })), /조회 실패 — Bing GetRankAndTrafficStats: HTTP 400/);
  assert.match(await bingWeekLine('k', async () => ({ ok: true, json: async () => ({}) })), /조회 실패 — .*no data array/);
  assert.match(await bingWeekLine('k', answer([{ Date: D('2026-10-01'), Clicks: 0, Impressions: 0 }])), /7일치가 안 돼/);
  await assert.rejects(bingCall('GetRankAndTrafficStats', 'k', async () => ({ ok: false, status: 401 })), /HTTP 401/);
});

test('the business name is navigational; a topic is not', () => {
  const common = JSON.parse(readFileSync(new URL('../../data/common-words.json', import.meta.url), 'utf8')).words;
  const isNav = makeNavigationalTest([
    { place: placeOfTitle('Vandal Restaurant | Elevated Global Street Food: Where to Eat in Lombok'), region: 'Lombok' },
    { place: placeOfTitle('Gyeongju Bulguksa Temple: Travel Guide'), region: 'Gyeongju' },
    { place: 'Wolmi Theme Park', region: 'Incheon', category: 'attraction' },
    { place: 'Hug Street Food Kata Phuket', region: 'Phuket', category: 'restaurant' },
  ], common);
  // A landmark's name is a question a guide answers; a restaurant's is not.
  assert.equal(isNav('wolmi theme park'), false);
  assert.equal(isNav('hug street food kata'), true);
  // Codex, 10-05: a place word alone is a topic, not the business.
  assert.equal(isNav('street food kata'), false);
  assert.equal(isNav('phuket'), false);
  assert.equal(isNav('lombok'), false);
  // The two queries of the 2026-10-04 report.
  assert.equal(isNav('vandal restaurant | elevated global street food reviews'), true, 'name + "reviews" is still the business');
  // A question a guide can answer stays actionable.
  assert.equal(isNav('vandal restaurant menu'), false);
  assert.equal(isNav('vandal restaurant | elevated global street food'), true);
  assert.equal(isNav('vandal lombok'), true);
  // Topics stay actionable.
  assert.equal(isNav('street food lombok'), false);
  assert.equal(isNav('best restaurant lombok'), false);
  assert.equal(isNav('慶州 観光'), false);
  assert.equal(isNav('bulguksa temple'), true);
});

test('frontmatter scalars without a YAML library', () => {
  const fm = ["title: 'Vandal Restaurant | Elevated Global Street Food: Where to Eat in Lombok'", 'description: >-', '  Two lines', '  folded.', 'region: Lombok', "name: 'Bob''s Bar'", 'q: "x"'].join('\n');
  assert.equal(placeOfTitle(frontmatterScalar(fm, 'title')), 'Vandal Restaurant | Elevated Global Street Food');
  assert.equal(frontmatterScalar(fm, 'description'), 'Two lines folded.');
  assert.equal(frontmatterScalar(fm, 'region'), 'Lombok');
  assert.equal(frontmatterScalar(fm, 'name'), "Bob's Bar");
  assert.equal(frontmatterScalar(fm, 'q'), 'x');
  assert.equal(frontmatterScalar(fm, 'missing'), '');
});

test('bingQuotaLine reads the object-shaped quota answer and never throws', async () => {
  const { bingQuotaLine } = await import('./bing.mjs');
  assert.equal(await bingQuotaLine(''), '');
  const ok = await bingQuotaLine('k', async () => ({ ok: true, json: async () => ({ d: { DailyQuota: 85, MonthlyQuota: 2400 } }) }));
  assert.match(ok, /오늘 남음 85 · 이달 남음 2400/);
  assert.match(await bingQuotaLine('k', async () => ({ ok: false, status: 401 })), /HTTP 401/);
  assert.match(await bingQuotaLine('k', async () => { throw new Error('down'); }), /down/);
});
