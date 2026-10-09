import test from 'node:test';
import assert from 'node:assert/strict';
import { localizeEnglishDates as L } from './localize-dates.mjs';

test('번역본에 남은 영어 날짜를 각 언어 형식으로 (10-09, 19곳)', () => {
  assert.equal(L('하롱베이 헤리티지 마라톤은 November 22, 2026에 개최됩니다.', 'ko'), '하롱베이 헤리티지 마라톤은 2026년 11월 22일에 개최됩니다.');
  assert.equal(L('사마르칸트 마라톤은 November 7-8, 2026에 열립니다.', 'ko'), '사마르칸트 마라톤은 2026년 11월 7~8일에 열립니다.');
  assert.equal(L('October 31부터 November 1, 2026까지', 'ko'), '10월 31일부터 2026년 11월 1일까지');
  assert.equal(L('**November 22, 2026**입니다', 'ko'), '**2026년 11월 22일**입니다');
  assert.equal(L('日程はDecember 8-13, 2026です', 'ja'), '日程は2026年12月8日〜13日です');
  assert.equal(L('比赛于November 22, 2026举行', 'zh'), '比赛于2026年11月22日举行');
  assert.equal(L('se celebra el November 22, 2026.', 'es'), 'se celebra el 22 de noviembre de 2026.');
  assert.equal(L('2026년 대회는 November 7-8에 열립니다', 'ko'), '2026년 대회는 11월 7~8일에 열립니다', 'a yearless range is a range, not "11월 7일-8"');
});

test('역방향: 영어 원문·고유명사·다른 언어는 건드리지 않는다', () => {
  assert.equal(L('November 22, 2026', 'en'), 'November 22, 2026');
  assert.equal(L('5·18 기념공원(May 18 Memorial Park)', 'ko'), '5·18 기념공원(May 18 Memorial Park)');
  assert.equal(L('2026년 11월 22일', 'ko'), '2026년 11월 22일');
  assert.equal(L('', 'ko'), '');
});
