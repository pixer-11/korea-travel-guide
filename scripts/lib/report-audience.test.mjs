import test from 'node:test';
import assert from 'node:assert/strict';
import { audienceLines } from './report-audience.mjs';

// 2026-10-01 as it was: 45 readers, and our own live checks in Cloudflare's lists.
const cf = {
  countries: '미국 1506 · 베트남 897 · 싱가포르 347 · 중국 40 · 브라질 7',
  pages: '  • /my-trip · 한국어 — 133\n  • /events · 한국어 — 64',
};
const pl = {
  countries: '미국 9 · 중국 9 · 일본 6 · 인도네시아 2 · 홍콩 2',
  topSrc: 'Bing 20 · 직접 유입 10 · Yahoo! 8',
  topPages: '  • 글: 베이징 차이나오픈 · 중국어 — 6\n  • 홈 — 2',
  google: { day: 0, d28: 0 },
};

test('readers\' countries and pages lead; they are Plausible\'s, like the headline', () => {
  const L = audienceLines(cf, pl, false);
  assert.equal(L[1], '🌍 상위 국가 (실제 방문자): 미국 9 · 중국 9 · 일본 6 · 인도네시아 2 · 홍콩 2');
  const i = L.indexOf('🔥 인기 페이지 (실제 방문자)');
  assert.ok(i > 0);
  assert.match(L[i + 1], /베이징 차이나오픈/);
});

test('an ordinary day carries no Cloudflare list at all', () => {
  const text = audienceLines(cf, pl, false).join('\n');
  assert.doesNotMatch(text, /1506|my-trip|전체 접속/);
});

test('a surge day shows where the automated traffic came from and what it hit — labelled', () => {
  const L = audienceLines(cf, pl, true);
  assert.equal(L[1], '🌍 상위 국가 (실제 방문자): 미국 9 · 중국 9 · 일본 6 · 인도네시아 2 · 홍콩 2');
  assert.equal(L[2], '   └ 전체 접속 기준 — 봇·자동 접속 포함, 페이지뷰: 미국 1506 · 베트남 897 · 싱가포르 347 · 중국 40 · 브라질 7');
  const i = L.indexOf('🤖 자동 접속이 몰린 페이지 (전체 접속 기준 — 봇·자동 접속 포함, 페이지뷰)');
  assert.ok(i > L.indexOf('🔥 인기 페이지 (실제 방문자)'), 'after the readers\' pages, never instead of them');
  assert.match(L[i + 1], /my-trip · 한국어 — 133/);
});

test('Google is printed every day, zero included', () => {
  assert.ok(audienceLines(cf, pl, false).includes('🔎 구글 유입: 0명 · 최근 28일 0명'));
  assert.ok(audienceLines(cf, { ...pl, google: { day: 2, d28: 17 } }, false).includes('🔎 구글 유입: 2명 · 최근 28일 17명'));
  // The Google query failing drops the line rather than printing a made-up zero.
  assert.doesNotMatch(audienceLines(cf, { ...pl, google: null }, false).join('\n'), /구글 유입/);
});

test('Plausible down: Cloudflare\'s lists stand in, and say what they are', () => {
  const L = audienceLines(cf, null, false);
  assert.equal(L[1], '🌍 상위 국가 (전체 접속 기준 — 봇·자동 접속 포함, 페이지뷰): 미국 1506 · 베트남 897 · 싱가포르 347 · 중국 40 · 브라질 7');
  assert.ok(L.includes('🔥 인기 페이지 (전체 접속 기준 — 봇·자동 접속 포함, 페이지뷰)'));
  assert.doesNotMatch(L.join('\n'), /실제 방문자|유입원/);
});

test('Plausible up but without a country list: Cloudflare\'s countries, labelled; readers\' pages kept', () => {
  const L = audienceLines(cf, { ...pl, countries: '' }, false);
  assert.match(L[1], /^🌍 상위 국가 \(전체 접속 기준/);
  assert.ok(L.includes('🔥 인기 페이지 (실제 방문자)'));
});

test('Cloudflare down: readers\' lists alone, no dangling label even on a "surge"', () => {
  const text = audienceLines(null, pl, true).join('\n');
  assert.match(text, /상위 국가 \(실제 방문자\)/);
  assert.doesNotMatch(text, /전체 접속|자동 접속이 몰린/);
});

test('both down: just the spacer', () => {
  assert.deepEqual(audienceLines(null, null, false), ['']);
});
