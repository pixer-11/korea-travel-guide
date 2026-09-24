// tg-clip — 알림을 자르되, 잘랐다고 말한다.
//   node --test scripts/tg-clip.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { clipForTelegram } from './tg-clip.mjs';

const lines = (n, w = 'line') => Array.from({ length: n }, (_, i) => `${w} ${i + 1}`).join('\n');

test('짧으면 그대로, 생략 표시 없음', () => {
  assert.equal(clipForTelegram(lines(3), 30), lines(3));
});

test('줄 수를 넘으면 자르고 몇 줄 뺐는지 말한다 — 09-24 "3편인데 1편" 건', () => {
  const out = clipForTelegram(lines(33), 30);
  const last = out.split('\n').at(-1);
  assert.equal(out.split('\n').length, 31);
  assert.match(last, /외 3줄 생략/);
});

test('글자 수 한도가 줄 수보다 먼저 걸리면 거기서 자른다 — 텔레그램은 4,096자 넘으면 통째로 거절', () => {
  const out = clipForTelegram(lines(60, 'x'.repeat(100)), 60, 3500);
  assert.ok(out.length <= 3500, `길이 ${out.length}`);
  assert.match(out, /줄 생략/);
});

test('한 줄 도중에 자르지 않는다 — 한국어 글자가 반쪽 나면 텔레그램이 거절한다', () => {
  const ko = Array.from({ length: 80 }, (_, i) => `평점 미달로 내려둔 글 ${i} — 구글 평점이 오르면 자동 복귀`).join('\n');
  const out = clipForTelegram(ko, 200, 1000);
  for (const l of out.split('\n').slice(0, -1)) assert.match(l, /자동 복귀$/, `잘린 줄: ${l}`);
});

test('빈 입력은 빈 출력', () => {
  assert.equal(clipForTelegram(''), '');
  assert.equal(clipForTelegram('\n\n'), '');
});

test('명령줄로도 같은 결과 — 워크플로가 쓰는 모양', () => {
  const out = execFileSync(process.execPath, [join(process.cwd(), 'scripts', 'tg-clip.mjs'), '2'], { input: 'a\nb\nc\nd\n', encoding: 'utf8' });
  assert.equal(out, 'a\nb\n…(외 2줄 생략 — 전체는 GitHub Actions 로그)\n');
});
