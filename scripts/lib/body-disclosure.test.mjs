import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripBodyDisclosure, hasBodyDisclosure } from './body-disclosure.mjs';

const EN = '> **How this guide was made:** Editor-reviewed, AI-assisted. Facts are pulled from live Google Places data; images are licensed or public domain. See our [editorial policy](/about).';
const KO = '> **이 가이드는 이렇게 만들어졌습니다:** 에디터 검수를 거쳤으며 AI의 도움을 받아 작성했습니다. 자세한 내용은 [편집 정책](/about)을 참고하세요.';
const JA = '> **このガイドについて：** 編集者によるレビューとAIによる補助を経て作成されています。詳しくは[編集方針](/about)をご覧ください。';
const ES = '> **Cómo se hizo esta guía:** revisada por un editor y con asistencia de IA. Consulte nuestra [política editorial](/about).';
const ZH = '> **本指南制作说明：** 经编辑审核，并借助人工智能辅助完成。详见我们的[编辑政策](/about)。';

for (const [lang, line] of [['en', EN], ['ko', KO], ['ja', JA], ['es', ES], ['zh', ZH]]) {
  test(`removes the ${lang} disclosure and leaves the rest byte-identical`, () => {
    const rest = '## First sight of the dome\n\nThe marble reads warm at dawn.\n';
    const out = stripBodyDisclosure(`${line}\n\n${rest}`);
    assert.equal(out.body, rest);
    assert.equal(out.removed, line);
  });
}

test('the real corpus shape: body starts with a blank line, which is preserved', () => {
  // Measured 2026-08-31: every translation and 601 of 883 English bodies begin
  // with a CRLF before the disclosure. An implementation anchored at index 0
  // matches 282 files and silently misses 601 — this test is why.
  const out = stripBodyDisclosure(`\r\n${EN}\r\n\r\n## Why go\r\n\r\nText.\r\n`);
  assert.equal(out.body, '\r\n## Why go\r\n\r\nText.\r\n');
  assert.equal(out.removed, EN);
});

test('a body without a disclosure comes back byte-identical', () => {
  const body = '## Why go\n\nA quiet courtyard behind the market.\n';
  const out = stripBodyDisclosure(body);
  assert.equal(out.body, body);
  assert.equal(out.removed, null);
});

test('leaves a blockquote that is not the disclosure alone', () => {
  // A pull-quote must survive: the rule is "first line, blockquote, links /about".
  const body = '> The queue moves faster than it looks.\n\n## Why go\n\nText.\n';
  assert.equal(stripBodyDisclosure(body).body, body);
});

test('leaves an /about link that is not a leading blockquote alone', () => {
  const body = '## Why go\n\nSee our [editorial policy](/about) for how we work.\n';
  assert.equal(stripBodyDisclosure(body).body, body);
});

test('survives CRLF without leaving a stray carriage return', () => {
  const out = stripBodyDisclosure(`${EN}\r\n\r\n## Why go\r\n\r\nText.\r\n`);
  assert.equal(out.body, '## Why go\r\n\r\nText.\r\n');
});

test('hasBodyDisclosure agrees with stripBodyDisclosure', () => {
  assert.equal(hasBodyDisclosure(`${KO}\n\n## 왜 가야 할까\n`), true);
  assert.equal(hasBodyDisclosure('## 왜 가야 할까\n'), false);
});
