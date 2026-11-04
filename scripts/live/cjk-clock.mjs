// Live check (2026-11-04): clock times in Korean, Japanese and Chinese pages are
// written the way each language writes them — in the prose and in the crowd box.
//
// 6,816 English times sat in the prose of 553 ko/ja/zh pages («宫殿每天11am至6pm
// 开放», «7am～8amが空いている», «평일 9am부터»), and the box beside them printed
// 「上午 10点」「下午 12点」 — a space Chinese and Japanese never write, and 下午 for
// noon. scripts/lib/localize-clock.mjs rewrites the prose (at translation and
// nightly), src/lib/hours.mjs writes the box. This keeps both that way:
//   · prose: no English clock token (9am, 2:30pm, 10:00 PM) in any block;
//   · box (ja/zh): no word + space + digit, no 下午12点.
// Each page must show a native clock time somewhere, or the check saw nothing.
// Fetch only — no browser, no JS, so nothing reaches the analytics.
//
// Run: node scripts/live/cjk-clock.mjs [base]
import { BASE, verdict, deployLag } from './lib.mjs';
import { blockTexts } from '../../src/lib/cjk-quote-scan.mjs';
import { englishClocks } from '../lib/localize-clock.mjs';

// The pages that carried the most English times, two per language, and two with a crowd box.
const PAGES = [
  'zh/posts/hobart-born-in-brunswick/',
  'zh/posts/cairns-the-chambers/',
  'zh/posts/abu-dhabi-louvre-abu-dhabi/',
  'ja/posts/brighton-starfish-coffee/',
  'ja/posts/los-angeles-eggslut/',
  'ja/posts/abu-dhabi-louvre-abu-dhabi/',
  'ko/posts/brighton-starfish-coffee/',
  'ko/posts/cairns-the-chambers/',
];
const NATIVE = /(上午|下午|晚上|早上|中午|凌晨|午夜|午前|午後|深夜|오전|오후|정오|자정|새벽)\s?\d|정오|자정/;
const BOX_SPACE = /(上午|下午|晚上|早上|中午|凌晨|午夜|午前|午後) \d|下午 ?12点/;

const { lag } = await deployLag();
let boxes = 0;
const read = { zh: 0, ja: 0, ko: 0 };
for (const path of PAGES) {
  const r = await fetch(`${BASE}/${path}?v=${Date.now()}`, { headers: { 'user-agent': 'Mozilla/5.0 (WanderAtlas live check)' }, redirect: 'manual' });
  if (r.status !== 200) { console.log(`- /${path} ${r.status} (건너뜀)`); continue; }
  read[path.slice(0, 2)]++;
  const html = await r.text();
  const blocks = blockTexts(html);
  const english = blocks.flatMap(englishClocks); // the band 2PM is not a time
  const problems = [];
  if (english.length) problems.push(`영어식 시각 ${english.length}개 — ${english.slice(0, 3).join(' / ')}`);
  if (!blocks.some((t) => NATIVE.test(t))) problems.push('자국어 시각을 하나도 못 읽었다 — 통과가 아니다');
  const at = html.indexOf('class="pcrowd"');
  if (at !== -1 && !path.startsWith('ko/')) {
    boxes++;
    const box = html.slice(at, html.indexOf('</section>', at));
    const spaced = box.match(new RegExp(BOX_SPACE.source, 'g')) || [];
    if (spaced.length) problems.push(`혼잡 상자 띄어쓰기·정오 ${spaced.length}곳 — ${[...new Set(spaced)].slice(0, 3).join(' / ')}`);
  }
  if (problems.length && lag) { console.log(`WARN /${path} — 배포 전: ${problems.join(' · ')}`); continue; }
  verdict(`${problems.length ? '✗' : '✓'} /${path}${problems.length ? ` ${problems.join(' · ')}` : ''}`, problems.length > 0);
}
// The band 2PM stays a name (the first apply run wrote 「男团下午2点的成员」, 11-04).
for (const path of ['zh/posts/london-jay-park-serenades-body-rolls-world-tour/', 'ko/posts/london-jay-park-serenades-body-rolls-world-tour/']) {
  const r = await fetch(`${BASE}/${path}?v=${Date.now()}`, { headers: { 'user-agent': 'Mozilla/5.0 (WanderAtlas live check)' }, redirect: 'manual' });
  if (r.status !== 200) { console.log(`- /${path} ${r.status} (건너뜀)`); continue; }
  const text = blockTexts(await r.text()).join('\n');
  const bad = !/2PM/.test(text) || /男团下午2点|보이그룹 오후 2시/.test(text);
  verdict(`${bad ? '✗' : '✓'} /${path} 그룹 이름 2PM${bad ? '이 시각으로 바뀌었다' : ' 그대로'}`, bad);
}
// Nothing read is not a pass (scripts/audit-checkers.mjs contract). One retired
// page may be skipped; a language with none read, or most pages gone, may not
// (Codex, 11-04: seven 404s and one good box passed).
if (!lag) {
  if (boxes === 0) verdict('✗ 중국어·일본어 혼잡 상자를 하나도 못 읽었다 — 통과가 아니다', true);
  const gone = Object.entries(read).filter(([, n]) => n === 0).map(([l]) => l);
  const total = Object.values(read).reduce((a, b) => a + b, 0);
  if (gone.length) verdict(`✗ ${gone.join('·')} 쪽을 하나도 못 읽었다 — 통과가 아니다`, true);
  else if (total < PAGES.length - 2) verdict(`✗ ${PAGES.length}쪽 중 ${total}쪽만 열렸다 — 표본을 새로 골라야 한다`, true);
}
