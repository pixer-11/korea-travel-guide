// 본문 맨 앞의 구분선은 글을 잡아먹는다 — 양방향으로 고정한다.
//   node --test scripts/lib/body-normalize.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import matter from 'gray-matter';
import { stripLeadingRule } from './body-normalize.mjs';

test('맨 앞 구분선을 지운다 (툴루즈 글이 CI 를 빨갛게 만든 모양)', () => {
  assert.equal(stripLeadingRule('---\n\n## What you are walking into\n\nbody'),
    '## What you are walking into\n\nbody');
  assert.equal(stripLeadingRule('***\n## T'), '## T');
  assert.equal(stripLeadingRule('___\n## T'), '## T');
  assert.equal(stripLeadingRule('  ---  \n\n## T'), '## T');
  assert.equal(stripLeadingRule('-----\r\n\r\n## T'), '## T');
});

test('맨 앞 하나만 지운다 — 두 줄이면 둘째는 본문이다', () => {
  assert.equal(stripLeadingRule('---\n---\n## T'), '---\n## T');
});

test('본문 중간의 구분선은 평범한 마크다운이므로 건드리지 않는다', () => {
  const md = '## A\n\ntext\n\n---\n\n## B';
  assert.equal(stripLeadingRule(md), md);
});

test('구분선이 없으면 그대로 돌려준다', () => {
  const md = '## Title\n\nbody with -- dashes and *stars*';
  assert.equal(stripLeadingRule(md), md);
  assert.equal(stripLeadingRule(''), '');
  assert.equal(stripLeadingRule(undefined), '');
});

// 이 함수가 존재하는 이유 자체를 테스트한다: 정규화한 본문은 수리 도구의
// 왕복을 견디고, 안 한 본문은 못 견딘다.
test('정규화하면 matter 왕복에서 본문이 살아남는다', () => {
  const data = { title: 'T', country: 'France' };
  const raw = '---\n\n## Heading\n\n' + 'word '.repeat(200).trim() + '\n';

  const broken = matter(matter.stringify(raw, data));
  assert.ok(broken.content.split(/\s+/).filter(Boolean).length < 200,
    '전제가 깨졌다 — 이 모양이 더는 위험하지 않다면 이 정규화는 필요 없다');

  const fixed = matter(matter.stringify(stripLeadingRule(raw), data));
  assert.ok(fixed.content.split(/\s+/).filter(Boolean).length >= 200,
    '정규화 후에도 본문이 줄었다');
  assert.equal(fixed.data.title, 'T');
});
