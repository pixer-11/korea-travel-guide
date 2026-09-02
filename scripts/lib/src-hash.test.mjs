import test from 'node:test';
import assert from 'node:assert/strict';
import {
  srcHashOf, srcHashOfValues, srcHashOfPostFile, srcHashOfSourceFile,
  parseSourceFile, storedHashIn, stampSrcHash, quoteSrcHashLine,
} from './src-hash.mjs';

const post = `---\ntitle: T\ndescription: D\nquickAnswer: Q\nfaq:\n  - q: a\n    a: b\n---\n\nBody here.\n`;

test('srcHashOf is unchanged by the generic helper underneath it', () => {
  // The post formula must keep producing the values stamped into ~12,000
  // files on 2026-08-01, or every translation re-queues at once.
  const data = { title: 'T', description: 'D', quickAnswer: 'Q', faq: [{ q: 'a', a: 'b' }], body: 'Body here.' };
  assert.equal(srcHashOf(data), srcHashOfValues(['T', 'D', 'Q', [{ q: 'a', a: 'b' }], 'Body here.']));
  assert.equal(srcHashOfPostFile(post), srcHashOf(data));
  assert.match(srcHashOf(data), /^[0-9a-f]{12}$/);
});

test('CRLF and trailing whitespace do not change a source hash', () => {
  const lf = srcHashOfPostFile(post);
  assert.equal(srcHashOfPostFile(post.replace(/\n/g, '\r\n')), lf);
  assert.equal(srcHashOfPostFile(post + '\n\n'), lf);
  const topic = `---\nmetaTitle: M\nh1: H\n---\n\nText\n`;
  assert.equal(
    srcHashOfSourceFile(topic.replace(/\n/g, '\r\n'), ['metaTitle', 'h1']),
    srcHashOfSourceFile(topic, ['metaTitle', 'h1']),
  );
});

test('srcHashOfSourceFile follows exactly the named fields', () => {
  const a = `---\nmetaTitle: M\nh1: H\nicon: x\n---\n\nText\n`;
  const fields = ['metaTitle', 'h1'];
  const h = srcHashOfSourceFile(a, fields);
  // A non-translated field (icon) does not enter the hash.
  assert.equal(srcHashOfSourceFile(a.replace('icon: x', 'icon: y'), fields), h);
  // A translated field does; so does the body.
  assert.notEqual(srcHashOfSourceFile(a.replace('h1: H', 'h1: H2'), fields), h);
  assert.notEqual(srcHashOfSourceFile(a.replace('Text', 'Text2'), fields), h);
  // Field ORDER is part of the contract.
  assert.notEqual(srcHashOfSourceFile(a, ['h1', 'metaTitle']), h);
  assert.equal(srcHashOfSourceFile('no frontmatter', fields), null);
  assert.equal(parseSourceFile('---\n: bad: [\n---\nx'), null);
});

test('stampSrcHash inserts a quoted hash after slug: once, preserving line endings', () => {
  const legacy = `---\nlang: ko\nslug: visa\nmetaTitle: X\n---\n\nBody\n`;
  const out = stampSrcHash(legacy, 'abc123def456');
  assert.equal(out, `---\nlang: ko\nslug: visa\nsrcHash: 'abc123def456'\nmetaTitle: X\n---\n\nBody\n`);
  assert.equal(storedHashIn(out), 'abc123def456');
  // Already stamped: leave alone.
  assert.equal(stampSrcHash(out, 'abc123def456'), null);
  // CRLF file keeps CRLF.
  const crlf = stampSrcHash(legacy.replace(/\n/g, '\r\n'), 'abc123def456');
  assert.ok(crlf.includes("slug: visa\r\nsrcHash: 'abc123def456'\r\n"));
  // No slug line to anchor on.
  assert.equal(stampSrcHash(`---\nlang: ko\n---\nBody`, 'abc123def456'), null);
});

test('quoteSrcHashLine quotes a bare hash and leaves a quoted one alone', () => {
  assert.equal(
    quoteSrcHashLine('lang: ko\nsrcHash: 818631094e44\ntitle: t\n'),
    "lang: ko\nsrcHash: '818631094e44'\ntitle: t\n",
  );
  assert.equal(quoteSrcHashLine("srcHash: '818631094e44'\n"), "srcHash: '818631094e44'\n");
});
