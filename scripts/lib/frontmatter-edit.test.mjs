// Every test here is a defect that was live in this repo on 2026-09-08, in one
// of the seven scripts that edited frontmatter with hand-written patterns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { editFrontmatter, DELETE } from './frontmatter-edit.mjs';

const BODY = '\n## Why go\n\n' + 'word '.repeat(80) + '\n';
const file = (fm, body = BODY) => `---\n${fm}\n---\n${body}`;

test('a draft: true inside a body code sample is not the one edited', () => {
  // gate-new-posts, repair-held-posts and restore-retired-posts all did this.
  const body = '\n## Example\n\n```yaml\ndraft: true\n```\n' + BODY;
  const out = editFrontmatter(file('title: A\ndraft: true', body), { draft: false });
  const back = matter(out);
  assert.equal(back.data.draft, false, 'the real flag must change');
  assert.match(back.content, /```yaml\ndraft: true\n```/, 'the code sample must not');
});

test('a key written with a space before the colon is still found', () => {
  // `heldReason : cancelled` is valid YAML that /^heldReason:/ misses — the
  // shape that would have let a cancelled event be republished.
  const out = editFrontmatter(file('title: A\nheldReason : cancelled\ndraft: true'), { heldReason: DELETE });
  assert.equal(matter(out).data.heldReason, undefined);
});

test('an inline mapping is removed whole, not left as a fragment', () => {
  const out = editFrontmatter(file('title: A\nheroImage: {url: https://x/w.jpg}\ndraft: true'), { heroImage: DELETE });
  const back = matter(out);
  assert.equal(back.data.heroImage, undefined);
  assert.equal(back.data.title, 'A', 'the rest of the frontmatter must survive');
});

test('a nested block and everything indented under it goes together', () => {
  const fm = 'title: A\nheroImage:\n  url: https://x/w.jpg\n  credit: someone\n  focus:\n    x: 1\ngallery: []\ndraft: true';
  const out = editFrontmatter(file(fm), { heroImage: DELETE });
  const back = matter(out);
  assert.equal(back.data.heroImage, undefined);
  assert.deepEqual(back.data.gallery, [], 'the key after the block must survive');
});

test('a url written as a block scalar is still recognised as its key', () => {
  const fm = 'title: A\nheroImage:\n  url: >-\n    https://upload.wikimedia.org/very/long/name.jpg\ndraft: true';
  const out = editFrontmatter(file(fm), { heroImage: DELETE });
  assert.equal(matter(out).data.heroImage, undefined);
});

test('a body that begins with a horizontal rule survives byte for byte', () => {
  // matter.stringify read this as a second frontmatter block and swallowed it:
  // 414 words became 2, and the checks of the day all passed.
  const body = '---\n' + 'word '.repeat(410) + '\n---\nRemaining text\n';
  const out = editFrontmatter(file('title: A\ndraft: true', body), { draft: false });
  assert.equal(matter(out).content, matter(file('title: A\ndraft: true', body)).content);
});

test('quoting that carries meaning is not lost', () => {
  // description: "09" unquoted is the number 9 under Astro's YAML parser, which
  // violates z.string() and stops the build.
  const out = editFrontmatter(file('title: A\ndescription: "09"\ncode: "0o17"\ndraft: true'), { draft: false });
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(out)[1];
  const core = yaml.load(fm, { schema: yaml.CORE_SCHEMA });
  assert.equal(typeof core.description, 'string', 'description must still be a string to Astro');
  assert.equal(typeof core.code, 'string');
});

test('a value we set is quoted correctly even when it looks like a number', () => {
  const out = editFrontmatter(file('title: A\ndraft: true'), { description: '09' });
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(out)[1];
  assert.equal(typeof yaml.load(fm, { schema: yaml.CORE_SCHEMA }).description, 'string');
});

test('a key that does not exist yet is added', () => {
  const out = editFrontmatter(file('title: A\ndraft: true'), { photoless: true });
  assert.equal(matter(out).data.photoless, true);
});

test('a file with no frontmatter is refused, not mangled', () => {
  assert.throws(() => editFrontmatter('just a body\n', { draft: false }), /no frontmatter/);
});

test('frontmatter that does not parse is refused', () => {
  assert.throws(() => editFrontmatter(file('title: [broken\ndraft: true'), { draft: false }), /does not parse/);
});

test('unicode and multi-line values are left exactly as they were', () => {
  const fm = 'title: 서울의 맛집\nsummary: >-\n  first line\n  second line\ndraft: true';
  const before = matter(file(fm));
  const after = matter(editFrontmatter(file(fm), { draft: false }));
  assert.equal(after.data.title, before.data.title);
  assert.equal(after.data.summary, before.data.summary);
});

// 2026-10-05: split('---')[1] and indexOf('---', 3) cut at a photo credit.
test('splitFrontmatter ends at the first line that IS ---, not a --- inside a value', async () => {
  const { splitFrontmatter } = await import('./frontmatter-edit.mjs');
  const raw = "---\ntitle: X\ncredit: 'Photo: Heribert Pohl --- Thanks for half a million clicks!'\nplace:\n  busyness: [1]\n---\nBody text.\n";
  const { fm, body } = splitFrontmatter(raw);
  assert.match(fm, /busyness/);
  assert.equal(body, 'Body text.\n');
  const crlf = splitFrontmatter(raw.replace(/\n/g, '\r\n'));
  assert.match(crlf.fm, /busyness/);
  assert.deepEqual(splitFrontmatter('no frontmatter here'), { fm: '', body: 'no frontmatter here' });
});

// 2026-10-06: a CRLF file came back with '---\n' around CRLF lines — two line
// endings in one file — and fill-event-city-heroes then found no front matter.
test('the file keeps its own line ending, CRLF or LF, all the way through', async () => {
  const { editFrontmatter, DELETE } = await import('./frontmatter-edit.mjs');
  const crlf = '---\r\ntitle: T\r\nheroImage:\r\n  url: x\r\ngallery: []\r\ndescription: >-\r\n  long line\r\n---\r\nBody one.\r\n\r\nTwo.\r\n';
  const out = editFrontmatter(crlf, { heroImage: DELETE, draft: true });
  assert.ok(!/[^\r]\n/.test(out), JSON.stringify(out.slice(0, 80)));
  const lf = editFrontmatter(crlf.replace(/\r\n/g, '\n'), { draft: true });
  assert.ok(!lf.includes('\r'));
});
