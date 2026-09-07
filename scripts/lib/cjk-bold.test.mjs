import test from 'node:test';
import assert from 'node:assert/strict';
import { fixCjkBold, fixCjkBoldLine, rendersBold } from './cjk-bold.mjs';

test('the failing shape really does fail to render', () => {
  // If this ever passes, CommonMark changed and the repair is obsolete.
  assert.equal(rendersBold('**왓 랏차부라나(Wat Ratchaburana)**와 함께'), false);
});

test('moves the closer in front of a parenthetical gloss', () => {
  const out = fixCjkBoldLine('- 길 건너편의 **왓 랏차부라나(Wat Ratchaburana)**와 함께 방문해 보자.');
  assert.equal(out, '- 길 건너편의 **왓 랏차부라나**(Wat Ratchaburana)와 함께 방문해 보자.');
  assert.ok(rendersBold(out));
});

test('handles full-width parentheses and Japanese/Chinese text', () => {
  for (const line of [
    'BTSで**サラデーン駅(Sala Daeng station)**まで行く。',
    '走到**内堡（Inner Fort）**是最快的。',
  ]) {
    const out = fixCjkBoldLine(line);
    assert.ok(rendersBold(out), `still broken: ${out}`);
    assert.ok(out.includes('**'), 'bold was dropped entirely');
  }
});

test('moves the closer in front of trailing punctuation', () => {
  const out = fixCjkBoldLine('**입장료、**는 무료다.');
  assert.ok(rendersBold(out), out);
});

test('leaves correct lines untouched', () => {
  const fine = [
    '- **나무뿌리에 감싸인 불상 머리**: 동쪽 경계벽 근처.',
    '**Wat Mahathat** is the one with the head in the roots.',
    'no bold at all here',
    '',
  ];
  for (const line of fine) assert.equal(fixCjkBoldLine(line), line);
});

test('a line it cannot fix is returned unchanged, never mangled', () => {
  const weird = '**unclosed bold with no closer at all';
  assert.equal(fixCjkBoldLine(weird), weird);
});

test('works over a whole body and leaves other lines alone', () => {
  const body = [
    '첫 문단은 멀쩡하다.',
    '',
    '- 길 건너편의 **왓 랏차부라나(Wat Ratchaburana)**와 함께.',
    '- **정상 볼드**: 이건 그대로.',
  ].join('\n');
  const out = fixCjkBold(body).split('\n');
  assert.equal(out[0], '첫 문단은 멀쩡하다.');
  assert.equal(out[3], '- **정상 볼드**: 이건 그대로.');
  assert.ok(rendersBold(out[2]), out[2]);
});

test('the opener punctuation blocks — a bracketed proper noun', () => {
  // 2026-09-07: the mirror image of the closer bug. `**` cannot OPEN when a
  // bracket follows it and a word character sits in front, so the whole line
  // shows literal asterisks. Fix is the same shape: brackets outside the bold.
  const line = 'ボメラーノとノチェッレを結ぶ尾根道**「神々の小径」**(センティエロ)がおすすめです。';
  assert.equal(rendersBold(line), false, 'premise: this shape must not render');
  const out = fixCjkBoldLine(line);
  assert.ok(rendersBold(out), `still broken: ${out}`);
  assert.ok(out.includes('**'), 'bold was dropped entirely');
  assert.equal(out.replace(/\*/g, ''), line.replace(/\*/g, ''), 'no words may be lost');
});

test('leaves correct bracketed bold untouched', () => {
  const fine = [
    '「**神々の小径**」がおすすめ。',
    '**「神々の小径」** で始まる行はそのまま。',
  ];
  for (const line of fine) assert.equal(fixCjkBoldLine(line), line);
});
