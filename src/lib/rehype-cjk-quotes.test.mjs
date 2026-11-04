import { test } from 'node:test';
import assert from 'node:assert/strict';
import rehypeCjkQuotes from './rehype-cjk-quotes.mjs';
import { blockTexts, quoteOrderIssues } from './cjk-quote-scan.mjs';

const text = (value) => ({ type: 'text', value });
const el = (tagName, children) => ({ type: 'element', tagName, properties: {}, children });
const flat = (node) => (node.type === 'text' ? node.value : (node.children ?? []).map(flat).join(''));
const run = (tree, path) => { rehypeCjkQuotes()(tree, { path }); return tree; };
const ZH = 'C:\\repo\\src\\content\\i18n\\zh\\abu-dhabi-louvre-abu-dhabi.md';

test('live 11-03: smartypants turned both quotes after a Han character into closing quotes', () => {
  const tree = run(el('root', [el('p', [text('建筑评论家们称之为”光之雨”。')])]), ZH);
  assert.equal(flat(tree), '建筑评论家们称之为“光之雨”。');
});

test('a pair split by bold or a link, several pairs, and an already-correct pair', () => {
  const tree = run(el('root', [
    el('p', [text('他说”'), el('strong', [text('左侧超越')]), text('”，然后”快”和“慢”。')]),
  ]), ZH);
  assert.equal(flat(tree), '他说“左侧超越”，然后“快”和“慢”。');
});

test('live 11-04: a closing quote after a bracket or ? came out as an opening one', () => {
  const ko = run(el('root', [el('p', [text('이를 두고 “빛의 비(rain of light)“라 부릅니다.')])]), '/repo/src/content/i18n/ko/abu-dhabi-louvre-abu-dhabi.md');
  assert.equal(flat(ko), '이를 두고 “빛의 비(rain of light)”라 부릅니다.');
  const zh = run(el('root', [el('p', [text('问一句“多少钱？“常能换来一笑，临走时说声”dhanyabad“。')])]), ZH);
  assert.equal(flat(zh), '问一句“多少钱？”常能换来一笑，临走时说声“dhanyabad”。');
});

test('two wrong pairs that happen to look nested are still two pairs (Goa, 11-04)', () => {
  const tree = run(el('root', [el('p', [text('“阿瓜达(aguada)“这个名字正是源于此，意为”取水处”。')])]), ZH);
  assert.equal(flat(tree), '“阿瓜达(aguada)”这个名字正是源于此，意为“取水处”。');
});

test('an odd number of quotes is not guessed at: German „…“ stays as written', () => {
  const tree = run(el('root', [el('p', [text('매표소에서 „구텐 탁(Guten Tag)“이라고 인사합니다.')])]), '/repo/src/content/i18n/ko/dresden.md');
  assert.equal(flat(tree), '매표소에서 „구텐 탁(Guten Tag)“이라고 인사합니다.');
});

test('each block counts on its own; code is never touched', () => {
  const tree = run(el('root', [
    el('ul', [el('li', [text('”一”')]), el('li', [el('p', [text('”二”')]), el('code', [text('a ” b')])])]),
    el('pre', [el('code', [text('”x”')])]),
  ]), ZH);
  assert.equal(flat(tree), '“一”“二”a ” b”x”');
});

test('English and Spanish pages are left exactly as smartypants made them', () => {
  for (const path of ['/repo/src/content/posts/x.md', '/repo/src/content/i18n/es/x.md']) {
    const tree = run(el('root', [el('p', [text('”odd”')])]), path);
    assert.equal(flat(tree), '”odd”');
  }
  const ja = run(el('root', [el('p', [text('”例”')])]), '/repo/src/content/static-pages-i18n/ja/about.md');
  assert.equal(flat(ja), '“例”');
});

test('live-check reader: a nested list is two blocks, not one merged at the first </li> (Codex 11-04)', () => {
  const html = '<ul><li>“outer<ul><li>”wrong”</li></ul>”</li></ul>';
  assert.deepEqual(blockTexts(html), ['”wrong”', '“outer”']);
  const r = quoteOrderIssues(html);
  assert.equal(r.read, 4);
  assert.equal(r.bad.length, 1);
});

test('live-check reader: code is skipped, entities are read, a correct page passes', () => {
  const html = '<p>称之为&ldquo;光之雨&rdquo;。<code>a ” b</code></p><p>“빛의 비(rain of light)”라</p><pre><code>”x”</code></pre>';
  assert.deepEqual(quoteOrderIssues(html), { read: 4, bad: [] });
  assert.equal(quoteOrderIssues('<p>이를 두고 “빛의 비(rain of light)“라 부릅니다.</p>').bad.length, 1);
  assert.equal(quoteOrderIssues('<p>„Guten Tag)“이라고</p>').bad.length, 0);
});
