// Live check (2026-11-03, widened 11-04): double quotes in Chinese and Korean
// prose open and close the right way.
//
// smartypants guessed each quote's direction from the characters around it,
// which in CJK prose goes wrong both ways: ”光之雨” (an opening quote after a
// Han character) and “빛의 비(rain of light)“라 (a closing quote after a
// bracket). src/lib/rehype-cjk-quotes.mjs makes an even number of quotes in a
// block alternate “ ” “ ”; this keeps the live pages that way. A block with an
// even number of quotes that do not alternate is the defect; an odd number is
// left alone there and here (German „…“). Blocks are read by
// src/lib/cjk-quote-scan.mjs, which splits them exactly as the plugin does
// (a nested list item counts on its own). Pages that carry quotes in both
// languages, so one being retired does not fail the run; at least one quote
// must be read, or the check saw nothing.
// Fetch only — no browser, no JS, so nothing reaches the analytics.
//
// Run: node scripts/live/cjk-quotes.mjs [base]
import { BASE, verdict, deployLag } from './lib.mjs';
import { quoteOrderIssues } from '../../src/lib/cjk-quote-scan.mjs';

const PAGES = [
  'zh/posts/abu-dhabi-louvre-abu-dhabi/',
  'zh/posts/las-vegas-bellagio-conservatory-botanical-gardens/',
  'zh/posts/abu-dhabi-art-house-cafe/',
  'ko/posts/abu-dhabi-louvre-abu-dhabi/',
  'ko/posts/adana-world-rak-festival/',
];

const { lag } = await deployLag();
let quotesRead = 0;
for (const path of PAGES) {
  const r = await fetch(`${BASE}/${path}?v=${Date.now()}`, { headers: { 'user-agent': 'Mozilla/5.0 (WanderAtlas live check)' }, redirect: 'manual' });
  if (r.status !== 200) { console.log(`- /${path} ${r.status} (건너뜀)`); continue; }
  const { read, bad: found } = quoteOrderIssues(await r.text());
  quotesRead += read;
  const bad = found.length;
  const samples = found.slice(0, 2);
  if (bad && lag) { console.log(`WARN /${path} — 배포 전: 따옴표 순서가 틀린 문단 ${bad}`); continue; }
  verdict(`${bad ? '✗' : '✓'} /${path}${bad ? ` 따옴표 순서가 틀린 문단 ${bad}개 — ${samples.join(' / ')}` : ''}`, bad > 0);
}
// Nothing read is not a pass (scripts/audit-checkers.mjs contract).
if (quotesRead === 0 && !lag) verdict('✗ 따옴표를 하나도 읽지 못했다 — 통과가 아니다', true);
