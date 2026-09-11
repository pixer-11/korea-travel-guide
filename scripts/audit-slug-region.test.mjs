// 차단기는 "막히는가" 와 "정상까지 막진 않는가" 둘 다 재야 한다.
//   node --test scripts/audit-slug-region.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(process.cwd(), 'scripts', 'audit-slug-region.mjs');
const LIB = join(process.cwd(), 'scripts', 'lib', 'examined.mjs');

// The script reads 'src/content/posts' relative to the CWD, so a throwaway tree
// with the same shape is the whole fixture.
function tree(posts, legacy = []) {
  const root = mkdtempSync(join(tmpdir(), 'slugregion-'));
  mkdirSync(join(root, 'src', 'content', 'posts'), { recursive: true });
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'scripts', 'lib'), { recursive: true });
  for (const [name, region] of Object.entries(posts)) {
    writeFileSync(
      join(root, 'src', 'content', 'posts', name + '.md'),
      `---\ntitle: 'x'\nregion: ${region}\n---\n\nbody\n`,
      'utf8',
    );
  }
  writeFileSync(join(root, 'data', 'slug-region-legacy.json'), JSON.stringify({ slugs: legacy }), 'utf8');
  return root;
}

const run = (cwd) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8' }) };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout ?? '') };
  }
};

test('슬러그가 region 으로 시작하면 통과', () => {
  const root = tree({ 'seoul-gyeongbokgung-palace': 'Seoul', 'busan-haeundae-beach': 'Busan' });
  const r = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /새로 어긋난 슬러그 없음/);
});

test('다른 도시로 시작하면 막는다 — 국립중앙박물관 건', () => {
  const root = tree({ 'boryeong-national-museum-of-korea': 'Seoul' });
  const r = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /SLUG-REGION-MISMATCH: boryeong-national-museum-of-korea\.md/);
});

test('베이스라인에 있는 기존 글은 통과시킨다 (라이브 URL 보존)', () => {
  const root = tree({ 'goyang-gyeongdong-market': 'Seoul' }, ['goyang-gyeongdong-market']);
  const r = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /베이스라인 1편/);
});

test('공백·악센트가 있는 region 도 접는다', () => {
  const root = tree({
    'amalfi-coast-positano': 'Amalfi Coast',
    'alcaniz-parador-de-alcaniz': 'Alcañiz',
  });
  const r = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(r.code, 0, r.out);
});

test('빈 저장소로는 통과하지 않는다', () => {
  const root = tree({});
  const r = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /NOTHING-EXAMINED/);
});

test('region 이 없는 글은 판정 대상이 아니다 — 하지만 그것만 있으면 통과도 아니다', () => {
  const root = mkdtempSync(join(tmpdir(), 'slugregion-'));
  mkdirSync(join(root, 'src', 'content', 'posts'), { recursive: true });
  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(join(root, 'src', 'content', 'posts', 'x.md'), `---\ntitle: 'x'\n---\n\nbody\n`, 'utf8');
  writeFileSync(join(root, 'data', 'slug-region-legacy.json'), JSON.stringify({ slugs: [] }), 'utf8');
  const r = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /NOTHING-EXAMINED/);
});
