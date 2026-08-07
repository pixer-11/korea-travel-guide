// node src/lib/paragraphs.test.mjs
//
// This module edits 792 published guides in five languages. The one thing it
// must never do is change a word — it may only add blank lines. Most of these
// tests exist to prove exactly that.
import { sentences, splitParagraph, reflow, words } from './paragraphs.mjs';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('문장 분리가 원문을 그대로 복원한다', () => {
  const s = 'The gate opens at nine. Come early. The queue forms fast, so plan for it!';
  return sentences(s).join('') === s ? null : `복원 실패: ${JSON.stringify(sentences(s).join(''))}`;
});

t('약어의 마침표로는 자르지 않는다', () => {
  // "Sukhumvit Rd. The" 를 자르면 주소가 반토막 난다.
  const s = 'Head down Sukhumvit Rd. The stalls start after the bridge.';
  const got = sentences(s);
  return got.length === 2 && got[0].trim().endsWith('Rd. The stalls start after the bridge.') === false
    ? (got[0].includes('Sukhumvit Rd.') && got[0].trim() === 'Head down Sukhumvit Rd. The stalls start after the bridge.'
        ? '약어에서 잘렸다'
        : null)
    : got.length === 1
      ? null
      : `약어에서 잘렸다: ${JSON.stringify(got)}`;
});

t('짧은 문단은 건드리지 않는다', () => {
  const p = 'A small counter with six stools. Order at the till.';
  const out = splitParagraph(p);
  return out.length === 1 && out[0] === p ? null : `건드렸다: ${JSON.stringify(out)}`;
});

t('긴 문단은 나뉘고 단어는 하나도 바뀌지 않는다', () => {
  const sent = (n) => `Sentence number ${n} runs on for a while with several clauses and a closing thought.`;
  const p = Array.from({ length: 8 }, (_, i) => sent(i + 1)).join(' ');
  const out = splitParagraph(p);
  if (out.length < 2) return '나뉘지 않았다';
  const before = p.split(/\s+/).join(' ');
  const after = out.join(' ').split(/\s+/).join(' ');
  return before === after ? null : `단어가 바뀌었다\n  전: ${before.slice(0, 120)}\n  후: ${after.slice(0, 120)}`;
});

t('나뉜 조각은 상한을 크게 넘지 않는다', () => {
  const sent = (n) => `This is sentence ${n} and it carries about a dozen words of real content here.`;
  const p = Array.from({ length: 12 }, (_, i) => sent(i + 1)).join(' ');
  const out = splitParagraph(p, { target: 60, max: 90, min: 20 });
  const over = out.filter((x) => words(x) > 110);
  return over.length === 0 ? null : `${over.length}조각이 110단어 초과: ${over.map(words).join(',')}`;
});

t('한 줄짜리 미아를 만들지 않는다', () => {
  const long = Array.from({ length: 6 }, (_, i) => `Sentence ${i} with a fair number of words in it for weight.`).join(' ');
  const out = splitParagraph(long + ' Tiny.', { target: 40, max: 60, min: 20 });
  const orphans = out.filter((x) => words(x) < 20);
  return orphans.length === 0 ? null : `미아 ${orphans.length}개: ${JSON.stringify(orphans)}`;
});

t('문장이 하나뿐인 초장문은 손대지 않는다', () => {
  const p = 'word '.repeat(150).trim();
  const out = splitParagraph(p);
  return out.length === 1 ? null : '문장 경계가 없는데 잘랐다';
});

t('제목·목록·표·이미지는 통과시킨다', () => {
  const body = [
    '## Getting there',
    '- Take Line 3 to Gyeongbokgung Station and use Exit 5, which puts you at the gate.',
    '| A | B |',
    '![alt](https://example.com/x.jpg)',
    '> A quoted line that is quite long and would otherwise be a candidate for splitting entirely.',
  ].join('\n\n');
  const { body: out, split } = reflow(body);
  return out === body && split === 0 ? null : `구조 블록을 건드렸다 (split=${split})`;
});

t('reflow 는 단어를 보존한다', () => {
  const para = Array.from({ length: 10 }, (_, i) => `Sentence ${i} has enough words to matter for this test case.`).join(' ');
  const body = `## Why go\n\n${para}\n\n- a list item\n\n${para}`;
  const { body: out, split } = reflow(body);
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  if (split === 0) return '아무것도 나뉘지 않았다';
  return norm(out) === norm(body) ? null : '단어가 바뀌었다';
});

t('CRLF 파일의 줄끝을 유지한다', () => {
  const para = Array.from({ length: 10 }, (_, i) => `Sentence ${i} has enough words to matter for this test case.`).join(' ');
  const { body: out } = reflow(`## H\r\n\r\n${para}`);
  return out.includes('\r\n') && !/[^\r]\n/.test(out) ? null : '줄끝이 섞였다';
});

t('실제 발행 문단으로 회귀 확인', () => {
  // 2026-08-07 감사에서 나온 최악 유형: 한 문단 190단어.
  const real =
    'The first thing you notice is the smell of charcoal drifting out onto the lane. ' +
    'Grills line the open front, and the woks behind them never seem to stop moving. ' +
    'By seven the counter is full and the staff start calling orders across the room. ' +
    'Tables turn quickly, so a short wait is normal rather than a bad sign. ' +
    'Order the grilled pork neck and a plate of som tam to share between two. ' +
    'Sticky rice arrives in a woven basket and is meant to be eaten with your hands. ' +
    'Pay at the till on your way out, in cash, and keep small notes ready.';
  const out = splitParagraph(real);
  if (out.length < 2) return `나뉘지 않았다 (${words(real)}단어)`;
  if (out.join(' ').replace(/\s+/g, ' ') !== real.replace(/\s+/g, ' ')) return '단어가 바뀌었다';
  return out.every((p) => words(p) <= 110) ? null : `조각이 여전히 길다: ${out.map(words).join(',')}`;
});

t('문단과 목록이 한 덩어리여도 목록은 안 깨진다', () => {
  // 일본어 글에서 흔한 모양 — 도입 문장 바로 아래 빈 줄 없이 불릿이 붙는다.
  // 통째로 건너뛰던 시절 185단어 문단 19개가 그대로 남아 있었다.
  const lead = Array.from({ length: 9 }, (_, i) => `Sentence ${i} carries a fair number of words for weight here.`).join(' ');
  const body = `${lead}\n- **First item** — a bullet that must survive intact.\n- **Second item** — likewise.`;
  const { body: out, split } = reflow(body);
  if (split === 0) return '도입 문단이 나뉘지 않았다';
  const bullets = out.split('\n').filter((l) => l.startsWith('- '));
  if (bullets.length !== 2) return `불릿이 ${bullets.length}개로 변했다`;
  // 불릿끼리는 빈 줄 없이 붙어 있어야 한 목록으로 렌더된다.
  return /- \*\*First item\*\* — a bullet that must survive intact\.\n- \*\*Second item\*\*/.test(out)
    ? null
    : '불릿 사이에 빈 줄이 끼어 목록이 쪼개졌다';
});

// ── 5개 언어 ──────────────────────────────────────────────────
// 번역본 3,172편도 같은 처리를 받는다. 일본어·중국어는 띄어쓰기가 없어서
// 단어 세기가 통하지 않는다 — 300자 문단이 "1단어"로 세어지면 모든 상한을
// 통과해버리고, 벽이 번역본에만 그대로 남는다.

t('일본어 문단은 문자수로 잰다', () => {
  const ja = 'この店は'.repeat(50); // 200자, 공백 0
  const n = words(ja);
  return n >= 80 && n <= 120 ? null : `200자를 ${n}단어로 셌다`;
});

t('한국어는 어절로 잰다', () => {
  const ko = '이 가게는 저녁 일곱 시가 되면 자리가 꽉 찹니다.';
  const n = words(ko);
  return n === 9 ? null : `어절 9개를 ${n}로 셌다`;
});

t('일본어 문장을 。 에서 나눈다', () => {
  const ja = '門は九時に開きます。早めに来てください。列はすぐにできます。';
  const got = sentences(ja);
  if (got.join('') !== ja) return '원문 복원 실패';
  return got.length === 3 ? null : `${got.length}문장으로 나뉨 (3이어야 함)`;
});

t('중국어 긴 문단이 실제로 나뉜다', () => {
  const zh = '这家店的炭火香气从巷口就能闻到，晚上七点以后座位基本坐满。'.repeat(8);
  const out = splitParagraph(zh);
  if (out.length < 2) return `나뉘지 않았다 (${words(zh)}단어 등가)`;
  return out.join('') === zh ? null : '글자가 바뀌었다';
});

t('한국어 긴 문단이 나뉘고 글자는 그대로다', () => {
  const one = '문을 열면 숯불 냄새가 먼저 들어옵니다. 일곱 시가 넘으면 카운터가 꽉 찹니다. ';
  const ko = one.repeat(9).trim();
  const out = splitParagraph(ko);
  if (out.length < 2) return `나뉘지 않았다 (${words(ko)}어절)`;
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  return norm(out.join(' ')) === norm(ko) ? null : '글자가 바뀌었다';
});

let fail = 0;
for (const [name, fn] of cases) {
  let err;
  try { err = fn(); } catch (e) { err = `threw: ${e.message}`; }
  console.log(`${err ? 'FAIL' : 'PASS'}  ${name}${err ? ' — ' + err : ''}`);
  if (err) fail++;
}
console.log(`\n${cases.length - fail}/${cases.length} passed`);
process.exit(fail ? 1 : 0);
