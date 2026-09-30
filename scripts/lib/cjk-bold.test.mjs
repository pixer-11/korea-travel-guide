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

test('straight ASCII quotes block the opener too (2026-09-09, zh)', () => {
  // The shape that sat in the ledger for two days marked unfixable: the same
  // glossed-proper-noun bold as above, written with " instead of “.
  const line = '著名的**"存钱猪"雷切尔（Rachel the Piggy Bank）**铜像和**飞鱼摊位**就在主入口处。';
  assert.equal(rendersBold(line), false, 'the shape must really fail first');
  const fixed = fixCjkBoldLine(line);
  assert.equal(rendersBold(fixed), true, 'still broken: ' + fixed);
  assert.equal(fixed.replace(/\*/g, ''), line.replace(/\*/g, ''), 'the repair must not change a single word');
});

test('leaves correct bracketed bold untouched', () => {
  const fine = [
    '「**神々の小径**」がおすすめ。',
    '**「神々の小径」** で始まる行はそのまま。',
  ];
  for (const line of fine) assert.equal(fixCjkBoldLine(line), line);
});

// 09-25: 남는 닫는 별표 하나가 중국어 라이브 페이지에 그대로 보였다.
test('brokenBoldLine 은 남는 ** 를 찾고, 정상 굵게는 넘긴다', async () => {
  const { brokenBoldLine } = await import('./cjk-bold.mjs');
  assert.equal(brokenBoldLine('- **农产品摊位一般不用给小费。** 咖啡和熟食摊位常见小费罐。**'), '- **农产品摊位一般不用给小费。** 咖啡和熟食摊位常见小费罐。**');
  assert.equal(brokenBoldLine('- **农产品摊位一般不用给小费。** 咖啡和熟食摊位常见小费罐。'), null);
  assert.equal(brokenBoldLine('no bold here'), null);
});

test('번역기가 깨진 굵게를 저장하지 않고 다시 시도한다', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync('scripts/translate-posts.mjs', 'utf8');
  assert.match(src, /literalBoldCount\(fixedBody\) > literalBoldCount\(data\.body\)/, '번역 저장 전 굵게 깨짐 검사가 없다(원문 대비)');
});

test('원문에도 있는 코드 표기 속 ** 는 번역 탓으로 세지 않는다 (코덱스 09-26)', async () => {
  const { literalBoldCount } = await import('./cjk-bold.mjs');
  const src = 'Type `**` to bold text. **Tipping isn\'t expected** here.';
  const zh = '输入 `**` 即可加粗。**这里不用给小费。**';
  assert.ok(literalBoldCount(zh) <= literalBoldCount(src), '같은 코드 표기가 번역 실패로 잡힌다');
  assert.ok(literalBoldCount(zh + ' 多余**') > literalBoldCount(src), '남는 ** 를 못 센다');
});

// 2026-09-29: "**Other Dutch wrecks:** *Vergulde Draeck*" → 중국어 "**其他荷兰沉船：***镀金龙号*".
// 닫는 ** 뒤에 기울임 * 가 바로 붙어 수리 규칙이 건너뛰었고, 세 번 다 실패해 중국어 페이지가
// 아예 안 만들어졌다(목록 링크 404). 기울임 * 하나는 허용, ** 는 여전히 불허.
test('닫는 ** 뒤에 기울임 * 가 붙어도 문장부호를 밖으로 뺀다', () => {
  const line = '- **其他荷兰沉船：***镀金龙号*（Vergulde Draeck）和*宗伊特多普号*（Zuytdorp）。';
  const fixed = fixCjkBoldLine(line);
  assert.equal(fixed, '- **其他荷兰沉船**：*镀金龙号*（Vergulde Draeck）和*宗伊特多普号*（Zuytdorp）。');
  assert.ok(rendersBold(fixed));
  assert.equal(fixCjkBoldLine('- **赞索号（SS Xantho）***早期蒸汽船*。'), '- **赞索号**（SS Xantho）*早期蒸汽船*。');
});

test('역방향: 이미 렌더되는 줄과 ** 가 이어지는 줄은 건드리지 않는다', () => {
  const ok = '- **其他荷兰沉船**：*镀金龙号*。';
  assert.equal(fixCjkBoldLine(ok), ok);
  const doubled = '**甲：****乙**丙';
  const out = fixCjkBoldLine(doubled);
  assert.ok(out === doubled || rendersBold(out), '고친다면 반드시 렌더되어야 한다');
});

test('굵은 글씨 안의 기울임은 마지막 수단으로만 벗긴다 (프리맨틀 09-30)', () => {
  const line = '- **桑索号蒸汽船（SS *Xantho*）：**一艘早期蒸汽船。';
  const fixed = fixCjkBoldLine(line);
  assert.ok(rendersBold(fixed), fixed);
  assert.ok(fixed.includes('**桑索号蒸汽船'), '굵은 글씨는 남아야 한다');
  // 기울임만 있고 굵은 글씨가 멀쩡한 줄은 그대로 — 벗기지 않는다.
  const fine = '- **赞索号**：一艘*早期*蒸汽船。';
  assert.equal(fixCjkBoldLine(fine), fine);
});

test('역방향: 굵은 글씨 밖의 기울임과 목록 기호는 지우지 않는다 (코덱스 09-30)', () => {
  const es = fixCjkBoldLine('**Barco *Xantho*:**visita el museo y lee *Don Quijote*.');
  assert.ok(es.includes('*Don Quijote*'), `굵은 글씨 밖 기울임이 사라졌다: ${es}`);
  assert.ok(rendersBold(es) || es === '**Barco *Xantho*:**visita el museo y lee *Don Quijote*.');
  const list = '* Visita *Xantho* y **barco *SS Xantho*:**descubre su historia.';
  const out = fixCjkBoldLine(list);
  assert.ok(out.startsWith('* Visita *Xantho* y '), `목록 기호·앞 기울임이 망가졌다: ${out}`);
});
