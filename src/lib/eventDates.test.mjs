import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fmtEventLong, fmtEventRange, isMonthOnlyEvent } from './eventDates.mjs';

test('one-day event prints one date; a run prints a range', () => {
  assert.equal(fmtEventRange('2026-08-09', '2026-08-09', 'en'), 'Aug 9');
  assert.equal(fmtEventRange('2026-08-09', null, 'en'), 'Aug 9');
  assert.equal(fmtEventRange('2026-08-09', '2026-09-05', 'en'), 'Aug 9 – Sep 5');
});

test('follows the locale and survives bad input', () => {
  assert.match(fmtEventRange('2026-08-09', '2026-09-05', 'ja'), /8月9日/);
  assert.equal(fmtEventRange(undefined, undefined, 'en'), '');
  assert.equal(fmtEventRange('not a date', null, 'en'), '');
});

test('the long date stops at the month when the event only has a month', () => {
  // paris-aespa: a day here would state one the guide never claims.
  assert.equal(fmtEventLong('2027-02-01', '2027-02-01', 'en', true), 'February 2027');
  assert.equal(fmtEventLong('2026-12-01', '2026-12-31', 'en', true), 'December 2026');
  assert.match(fmtEventLong('2026-09-01', '2026-12-31', 'en', true), /^September\s*–\s*December 2026$/);
  for (const [locale, month] of [['ko', '2027년 2월'], ['ja', '2027年2月'], ['zh-Hans', '2027年2月'], ['es', 'febrero de 2027']]) {
    assert.equal(fmtEventLong('2027-02-01', '2027-02-01', locale, true), month, locale);
  }
});

test('the long date keeps its day otherwise, and survives bad input', () => {
  assert.equal(fmtEventLong('2026-12-01', '2026-12-01', 'en'), 'December 1, 2026');
  assert.equal(fmtEventLong('2026-12-01', null, 'es'), '1 de diciembre de 2026');
  assert.match(fmtEventLong('2026-10-03', '2026-10-04', 'en'), /^October 3\s*–\s*4, 2026$/);
  // ja/zh: two long dates, never ICU's numeric 2026/10/03.
  assert.equal(fmtEventLong('2026-10-03', '2026-10-04', 'ja'), '2026年10月3日～2026年10月4日');
  assert.equal(fmtEventLong('2026-10-03', '2026-10-04', 'zh-Hans'), '2026年10月3日至2026年10月4日');
  assert.equal(fmtEventLong(undefined, undefined, 'en'), '');
  assert.equal(fmtEventLong('not a date', null, 'en'), '');
});

test('a placeholder first-of-month stops at the month', () => {
  // paris-aespa: 2027-02-01 stored, the guide only says "in February 2027".
  assert.equal(isMonthOnlyEvent('2027-02-01', '2027-02-01', 'brings the tour to Paris in February 2027.'), true);
  // Whole months are a placeholder even when the text happens to name the 1st.
  assert.equal(isMonthOnlyEvent('2026-12-01', '2026-12-31', 'That matters in December.'), true);
  assert.equal(isMonthOnlyEvent('2026-12-01', '2026-12-31', 'Opens December 1, 2026.'), true);
  assert.equal(isMonthOnlyEvent('2026-09-01', '2026-12-31', 'runs from September to December'), true);
  assert.equal(isMonthOnlyEvent(new Date('2026-12-01'), new Date('2026-12-31'), ''), true);
});

test('a real first-of-month date keeps its day', () => {
  // hong-kong-khalid, istanbul-pubg, tokyo-enhypen, guwahati.
  assert.equal(isMonthOnlyEvent('2026-12-01', '2026-12-01', 'The date falls on Tuesday, December 1, 2026.'), false);
  assert.equal(isMonthOnlyEvent('2026-11-01', '2026-12-01', 'is set for November 1 to December 1, 2026'), false);
  assert.equal(isMonthOnlyEvent('2026-12-01', '2026-12-02', 'fills it on December 1 and 2, 2026'), false);
  assert.equal(isMonthOnlyEvent('2026-12-01', '2026-12-06', 'runs December 1-6, 2026'), false);
  for (const said of ['Dec. 1', 'Dec 1', 'December 1st', 'December 01', '1 December 2026', '1st of December', '1-6 December', '1–6 Dec', '1st to 6th December', '1 through 6 December', '1 until 6 December', 'December the 1st', '2026-12-01']) {
    assert.equal(isMonthOnlyEvent('2026-12-01', '2026-12-06', `Doors open ${said}.`), false, said);
  }
  assert.equal(isMonthOnlyEvent('2026-09-01', '2026-09-03', 'Sept 1 is the opening night'), false);
});

test('a date that only looks like the 1st does not count, and other days are never month-only', () => {
  for (const said of ['December 10', 'December 15, 2026', '11 December', '21 Dec', 'November 1', '2026-12-10']) {
    assert.equal(isMonthOnlyEvent('2026-12-01', '2026-12-06', `Doors open ${said}.`), true, said);
  }
  // A verb is not a month.
  assert.equal(isMonthOnlyEvent('2026-05-01', '2026-05-02', 'Visitors may 1 day ahead book.'), true);
  assert.equal(isMonthOnlyEvent('2026-11-11', '2026-11-11', 'no date in this text'), false);
  assert.equal(isMonthOnlyEvent('2026-11-02', '2026-11-30', 'no date in this text'), false);
  assert.equal(isMonthOnlyEvent(undefined, undefined, ''), false);
  assert.equal(isMonthOnlyEvent('not a date', null, ''), false);
});

test('the article head shows the date line only for upcoming events, above the disclosure', () => {
  const tpl = readFileSync(new URL('../components/PostArticle.astro', import.meta.url), 'utf8');
  const at = (s) => tpl.indexOf(s);
  assert.ok(at('class="byline post-byline"') > 0);
  assert.ok(at('class="byline post-byline"') < at('class="byline-event"'), 'below the byline');
  assert.ok(at('class="byline-event"') < at('class="disclosure-details"'), 'the disclosure stays after it');
  assert.match(tpl, /isEvent && !isEventPast\(d\) && d\.eventStartDate/, 'finished events keep their own notice');
  assert.match(tpl, /upcomingDates = [^;]*fmtEventRange\(d\.eventStartDate, d\.eventEndDate, isMonthOnlyEvent\(d\.eventStartDate, d\.eventEndDate, post\.body\)\)/, 'placeholder dates stop at the month, judged on the English source');
  assert.match(tpl, /const fmtEventRange = \(start: any, end: any, monthOnly = false\) => fmtEventLong\(start, end, localeCodes\[lang\], monthOnly\)/, 'the page prints what fmtEventLong returns, in its own language');
  assert.match(tpl, /upcomingWhen = [^;]*\.replace\('\{city\}', \(\) => regionLabel\)/, 'the line says where as well as when');
});
