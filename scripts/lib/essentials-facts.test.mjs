// essentials-facts — 필수정보 카드는 본문에 있는 사실만 싣는다 (2026-09-30).
// 양방향: 본문에 있는 사실은 통과, 지어낸 숫자·이름·달은 탈락.
import test from 'node:test';
import assert from 'node:assert/strict';
import { vetFacts, monthRuns, unsupportedMonths, translationProblems, withStructureFrom, textView, sectionsOf, bodyHash } from './essentials-facts.mjs';

const BODY = `**Quick answer:** Most visitors need an ETA or eVisitor before departure.

## Visa & entry

- **ETA (subclass 601):** for South Korea and Japan passport holders, stays limited to three months, an application service fee of AUD20.
- **eVisitor (subclass 651):** a free visa for European passport holders.

Watch out for scam websites charging exorbitant fees.

## Getting around

Opal in Sydney, Myki in Melbourne, go card in Brisbane. Sydney and Brisbane accept contactless bank cards; Melbourne remains in final testing.

## Money & costs

A mid-range benchmark is roughly AUD 220 to 380 per person per day. Tipping is optional, around 10 per cent.

## Best time to visit

In the south, spring (September–November) and autumn (March–May) are best. In the tropical north the dry season runs from May to October. Summer (December–February) is peak beach season and the most crowded.

## Emergencies & safety

Triple Zero (000) is the emergency number. From a mobile you can also dial 112. The Emergency+ app shares your GPS location.

## Official sources

- [Home Affairs](https://immi.homeaffairs.gov.au)
`;

const RAW = {
  summary: [
    { key: 'entry', title: 'ETA before you fly', sub: 'App fee AUD 20' },
    { key: 'money', title: 'Australian dollar', sub: 'Tip optional, about 10%' },
    { key: 'season', title: 'Mar–May · Sep–Nov', sub: 'North: dry May–Oct' },
    { key: 'transport', title: 'Tap a bank card', sub: 'Melbourne still testing' },
  ],
  visa: {
    cards: [
      { name: 'ETA', code: '601', who: 'South Korea, Japan', cost: 'AUD 20 app fee', stay: 'Three months', note: '' },
      { name: 'eVisitor', code: '651', who: 'European passports', cost: 'Free', stay: 'Three months', note: '' },
    ],
    warnings: [{ title: 'Scam websites', text: 'Third-party sites charge exorbitant fees.' }],
  },
  transport: {
    rows: [
      { city: 'Sydney', card: 'Opal', contactless: 'yes' },
      { city: 'Melbourne', card: 'Myki', contactless: 'soon' },
      { city: 'Brisbane', card: 'go card', contactless: 'yes' },
    ],
    tips: [],
  },
  money: { budget: { amount: 'AUD 220–380', label: 'Mid-range, per person per day', note: '' }, tips: [] },
  season: {
    best: [3, 4, 5, 9, 10, 11],
    rows: [
      { label: 'South', sub: '', best: [3, 4, 5, 9, 10, 11], busy: [12, 1, 2] },
      { label: 'Tropical north', sub: '', best: [5, 6, 7, 8, 9, 10], busy: [] },
    ],
  },
  emergency: { numbers: [{ number: '000', label: 'Police, fire, ambulance', note: '' }, { number: '112', label: 'From a mobile', note: '' }], chips: ['Emergency+ app'] },
};

test('본문에 있는 사실은 전부 통과한다', () => {
  const { facts, dropped } = vetFacts(RAW, BODY);
  assert.deepEqual(dropped, []);
  assert.equal(facts.summary.length, 4);
  assert.equal(facts.visa.cards.length, 2);
  assert.equal(facts.transport.rows.length, 3);
  assert.equal(facts.money.budget.amount, 'AUD 220–380');
  assert.equal(facts.season.rows.length, 2);
  assert.equal(facts.emergency.numbers.length, 2);
});

test('본문에 없는 숫자가 든 카드는 버린다', () => {
  const raw = structuredClone(RAW);
  raw.visa.cards[0].cost = 'AUD 25 app fee';
  raw.money.budget.amount = 'AUD 250–400';
  const { facts, dropped } = vetFacts(raw, BODY);
  assert.equal(facts.visa.cards.length, 1);
  assert.equal(facts.money.budget, null);
  assert.ok(dropped.some((d) => d.includes('25')));
});

test('본문에 없는 이름(도시·상호)이 든 줄은 버린다', () => {
  const raw = structuredClone(RAW);
  raw.transport.rows.push({ city: 'Perth', card: 'SmartRider', contactless: 'yes' });
  const { facts, dropped } = vetFacts(raw, BODY);
  assert.equal(facts.transport.rows.length, 3);
  assert.ok(dropped.some((d) => d.includes('SmartRider') || d.includes('Perth')));
});

test('본문이 이름 붙인 적 없는 달은 칠하지 않는다', () => {
  const raw = structuredClone(RAW);
  raw.season.rows.push({ label: 'Whale watching', sub: '', best: [6, 7], busy: [] });
  const { facts, dropped } = vetFacts(raw, BODY);
  assert.equal(facts.season.rows.length, 2);
  assert.ok(dropped.some((d) => d.includes('june')));
});

test('월 묶음: 12월→1월은 한 덩어리', () => {
  assert.deepEqual(monthRuns([12, 1, 2]), [[12, 2]]);
  assert.deepEqual(monthRuns([3, 4, 5, 9, 10, 11]), [[3, 5], [9, 11]]);
  assert.deepEqual(unsupportedMonths([12, 1, 2], 'Summer (December–February)'), []);
  assert.deepEqual(unsupportedMonths([6, 7], 'dry season from May to October'), ['june–july']);
});

test('교통 표는 두 도시 이상일 때만', () => {
  const raw = structuredClone(RAW);
  raw.transport.rows = [raw.transport.rows[0]];
  assert.deepEqual(vetFacts(raw, BODY).facts.transport.rows, []);
});

test('번역: 숫자가 바뀌거나 카드가 빠지면 그 언어는 탈락', () => {
  const { facts } = vetFacts(RAW, BODY);
  const en = textView(facts);
  const good = structuredClone(en);
  good.visa.cards[0].stay = '3개월';
  good.visa.cards[1].stay = '3개월';
  assert.deepEqual(translationProblems(en, good).filter((p) => !p.includes('stay')), []);
  const bad = structuredClone(en);
  bad.money.budget.amount = 'AUD 220–390';
  assert.ok(translationProblems(en, bad).some((p) => p.includes('budget')));
  const short = structuredClone(en);
  short.visa.cards.pop();
  assert.ok(translationProblems(en, short).some((p) => p.includes('length')));
});

test('번역본은 달·상태·키를 영어에서 그대로 가져온다', () => {
  const { facts } = vetFacts(RAW, BODY);
  const tr = textView(facts);
  const merged = withStructureFrom(facts, tr);
  assert.deepEqual(merged.season.rows[0].best, [3, 4, 5, 9, 10, 11]);
  assert.equal(merged.transport.rows[1].contactless, 'soon');
  assert.equal(merged.summary[0].key, 'entry');
});

test('절 나누기와 해시', () => {
  const { sections } = sectionsOf(BODY);
  assert.equal(sections.length, 6);
  assert.equal(sections[0].heading, 'Visa & entry');
  assert.equal(bodyHash(BODY), bodyHash(BODY.replace(/\n/g, '\r\n')));
});

test('도구 응답 정리: 한 겹 감싸기와 문자열 JSON을 푼다', async () => {
  const { normalizeToolOutput } = await import('./essentials-facts.mjs');
  const keys = ['summary', 'visa'];
  assert.deepEqual(normalizeToolOutput({ facts: { summary: [], visa: {} } }, keys), { summary: [], visa: {} });
  assert.deepEqual(normalizeToolOutput({ summary: '[{"key":"entry"}]', visa: '{"cards":[]}' }, keys), { summary: [{ key: 'entry' }], visa: { cards: [] } });
  assert.deepEqual(normalizeToolOutput({ summary: [], visa: {} }, keys), { summary: [], visa: {} });
});

test('비자: 긴 칸은 비우고 카드는 남긴다 · 설명형 이름은 단어 단위로 확인', () => {
  const raw = structuredClone(RAW);
  raw.visa.cards[0].who = 'South Korea, Japan '.repeat(8);
  raw.visa.cards.push({ name: 'Free visa', code: '', who: '', cost: 'Free', stay: '', note: '' });
  raw.visa.cards.push({ name: 'Golden visa', code: '', who: '', cost: '', stay: '', note: '' });
  const { facts } = vetFacts(raw, BODY);
  assert.equal(facts.visa.cards[0].name, 'ETA');
  assert.equal(facts.visa.cards[0].who, '');
  assert.ok(facts.visa.cards.some((c) => c.name === 'Free visa'), '단어가 모두 본문에 있으면 통과');
  assert.ok(!facts.visa.cards.some((c) => c.name === 'Golden visa'), 'golden 은 본문에 없다');
});

test('글자로 쓴 숫자와 아라비아 숫자는 같은 사실이다 — 없는 숫자는 여전히 거절', async () => {
  const { unsupportedIn } = await import('./essentials-facts.mjs');
  assert.equal(unsupportedIn({ stay: '3 months per visit' }, 'stays limited to three months'), null);
  assert.equal(unsupportedIn({ stay: '90 days' }, 'up to ninety days'), null);
  assert.match(unsupportedIn({ stay: '6 months' }, 'stays limited to three months'), /6/);
});

test('번역: "24/7"은 24시간 연중무휴로 옮겨도 통과, 진짜 숫자 변경은 탈락', () => {
  const en = { emergency: { numbers: [{ number: '119', label: 'Fire', note: 'Answered 24/7' }] } };
  assert.deepEqual(translationProblems(en, { emergency: { numbers: [{ number: '119', label: '소방', note: '24시간 연중무휴' }] } }), []);
  assert.ok(translationProblems(en, { emergency: { numbers: [{ number: '112', label: '소방', note: '24시간' }] } }).length > 0);
});

test('번역: 7-Eleven 같은 숫자 상표는 숫자 검사에서 뺀다', () => {
  const en = { money: { budget: null, tips: [{ title: 'ATMs', text: '7-Eleven ATMs take foreign cards.' }] } };
  assert.deepEqual(translationProblems(en, { money: { budget: null, tips: [{ title: 'ATM', text: '세븐일레븐 ATM은 해외 카드를 받습니다.' }] } }), []);
});

test('번역 문제는 그 칸만 뺀다 — 구조가 깨지면 언어 전체 탈락', async () => {
  const { pruneProblems } = await import('./essentials-facts.mjs');
  const { facts } = vetFacts(RAW, BODY);
  const view = textView(facts);
  const tr = structuredClone(view);
  tr.money.tips = [];
  const en2 = structuredClone(facts); en2.money.tips = [{ title: 'Tip', text: 'Tipping is optional, around 10 per cent.' }, { title: 'X', text: 'Y' }];
  const view2 = textView(en2);
  const tr2 = structuredClone(view2); tr2.money.tips[0].text = '팁은 선택, 약 15%';
  const problems = translationProblems(view2, tr2);
  const p = pruneProblems(en2, tr2, problems);
  assert.equal(p.en.money.tips.length, 1);
  assert.equal(p.tr.money.tips.length, 1);
  assert.equal(p.tr.money.tips[0].title, 'X');
  // sub 에 문제가 있으면 줄은 남기고 칸만 비운다
  const pr = pruneProblems(facts, view, ['season.rows[0].sub: numbers 68,86 → 20,30']);
  assert.equal(pr.en.season.rows.length, 2);
  assert.equal(pr.tr.season.rows[0].sub, '');
  assert.equal(pruneProblems(facts, view, ['visa: missing']), null);
  const merged = withStructureFrom(p.en, p.tr);
  assert.equal(merged.money.tips.length, 1);
});

// ── 코드 검토(09-30) 재현 입력 — 전부 막혀야 한다 ─────────────────────────
test('검토: 숫자는 통째로 비교한다 (16 안의 6, 112 안의 11, 연도 범위 2,000)', async () => {
  const { unsupportedIn } = await import('./essentials-facts.mjs');
  assert.ok(unsupportedIn({ stay: '6 months' }, 'subclass 601 … 16 days'));
  assert.ok(unsupportedIn({ number: '11', label: 'x' }, 'dial 112 from a mobile'));
  assert.ok(unsupportedIn({ text: 'Fee is THB 2,000' }, 'a fee of THB 220'));
  assert.equal(unsupportedIn({ text: 'THB 1,000 to 2,000 a day' }, 'plan on THB 1,000 to 2,000'), null);
  assert.equal(unsupportedIn({ number: '000', label: 'x' }, 'Triple Zero (000) is'), null);
});

test('검토: 칸 첫 단어도 이름 검사를 받는다 (Tasmania / Hobart)', async () => {
  const { unsupportedIn } = await import('./essentials-facts.mjs');
  assert.match(unsupportedIn({ label: 'Tasmania', sub: 'Hobart', best: [9] }, 'In the south, spring is best.') ?? '', /Tasmania|Hobart/);
});

test('검토: 조동사 may 는 5월이 아니다 · 요약 카드 달은 좋은 시기 절에서만', () => {
  assert.equal(unsupportedMonths([5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3], 'March to May is best. You may find it busy.').length, 1);
  assert.deepEqual(unsupportedMonths([3, 4, 5], 'March to May is best. You may find it busy.'), []);
  assert.deepEqual(unsupportedMonths([5], 'you may find it busy'), ['may']);
  const body = BODY.replace('Triple Zero (000)', 'Triple Zero (000), busiest in August,');
  const raw = structuredClone(RAW);
  raw.summary[2] = { key: 'season', title: 'June to August best', sub: '' };
  const { facts, dropped } = vetFacts(raw, body);
  assert.ok(!facts.summary.some((c) => c.key === 'season'));
  assert.ok(dropped.some((d) => d.includes('summary.season')));
});

test('검토: 교통비 같은 한 항목은 하루 예산 카드가 아니다 (말레이시아)', () => {
  const raw = structuredClone(RAW);
  raw.money.budget = { amount: 'AUD 220–380', label: 'Transport budget', note: '' };
  assert.equal(vetFacts(raw, BODY).facts.money.budget, null);
});

test('검토: 번역이 숫자를 덧붙이면 탈락 · 영어가 빈 칸이면 번역도 빈 칸', () => {
  assert.ok(translationProblems({ s: 'Stay up to 3 months' }, { s: '최대 3개월 (연장 시 12개월)' }).length === 0, '12 는 달 표기일 수 있어 허용');
  assert.ok(translationProblems({ s: 'Stay up to 3 months' }, { s: '최대 3개월, 연장 시 90일' }).length > 0);
  assert.ok(translationProblems({ s: 'Fee THB 2,000' }, { s: '수수료 THB 2,050' }).length > 0);
  assert.equal(translationProblems({ s: 'up to three months' }, { s: '최대 3개월' }).length, 0);
  const { facts } = vetFacts(RAW, BODY);
  const en = structuredClone(facts); en.visa.cards[1].note = '';
  const tr = textView(en); tr.visa.cards[1].note = '수수료 AUD 50';
  assert.equal(withStructureFrom(en, tr).visa.cards[1].note, '');
});

test('검토: 좋은 시기 줄의 지역 라벨은 본문에 있어야 한다 (vetFacts 경로)', () => {
  const raw = structuredClone(RAW);
  raw.season.rows.push({ label: 'Tasmania', sub: 'Hobart', best: [9, 10, 11], busy: [], avoid: [] });
  const { facts, dropped } = vetFacts(raw, BODY);
  assert.ok(!facts.season.rows.some((r) => r.label === 'Tasmania'));
  assert.ok(dropped.some((d) => d.includes('Tasmania')));
});

test('역방향: 달 나열(April, May)·약어(Feb-Apr)·글자로 옮긴 숫자(seis)는 통과', async () => {
  const { unsupportedIn } = await import('./essentials-facts.mjs');
  assert.deepEqual(unsupportedMonths([4, 5, 9, 10], 'the months April, May, September, and October are best'), []);
  assert.equal(unsupportedIn({ key: 'season', title: 'Feb-Apr · Sep-Nov', sub: '' }, 'February to April and September to November'), null);
  assert.equal(unsupportedIn({ key: 'entry', title: 'Visa-free', sub: 'Depends on your passport' }, 'visa-free entry, depends on nationality'), null);
  assert.deepEqual(translationProblems({ s: 'Stay six months' }, { s: 'Estancia de seis meses' }), []);
  assert.deepEqual(translationProblems({ s: 'Stay 6 months' }, { s: 'Estancia de seis meses' }).length, 1);
});

test('a thousands dot is read as such only in the translation — an English decimal stays a decimal', () => {
  assert.deepEqual(translationProblems({ s: 'About 1,000 baht a day' }, { s: 'Unos 1.000 baht al día' }), []);
  // Codex review 2026-10-01: stripping the dot on the English side too let
  // 1.25 km pass as 1,250 km.
  assert.equal(translationProblems({ s: 'The walk is 1.250 km.' }, { s: '1,250km' }).length, 1);
});
