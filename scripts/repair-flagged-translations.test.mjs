// repair-flagged-translations 재시도 회귀 테스트 (2026-09-28).
//
// 재시도 때 8편 목록을 통째로 다시 넘겨서, 1편이 계속 실패하는 동안 이미 고친
// 7편이 두 번 더 번역됐다(13·12·12 호출, 약 $1.6). --only 로 이름을 받은 파일은
// 있어도 덮어쓰기 때문이다. 가짜 번역기로 실제 스크립트를 돌려 재시도가 빠진
// 파일만 넘기는지, 그리고 끝까지 실패한 파일은 옛 번역으로 되돌리는지 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const DOC = (tag) => `---\ntitle: ${tag}\n---\n\n${'번역된 본문입니다. '.repeat(60)}\n`;

// 이름 받은 키마다 파일을 쓰되 ko/bad 는 끝까지 못 쓰고 exit 1.
const FAKE = `
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
const keys = (process.argv.find((a) => a.startsWith('--only=')) || '--only=').slice(7).split(',').filter(Boolean);
appendFileSync('calls.log', keys.join(',') + '\\n');
let failed = 0;
for (const k of keys) {
  if (k === 'ko/bad') { failed++; continue; }
  const [lang, slug] = k.split('/');
  mkdirSync('src/content/i18n/' + lang, { recursive: true });
  writeFileSync('src/content/i18n/' + lang + '/' + slug + '.md', ${JSON.stringify(DOC('new'))});
}
console.log('TRANSLATE_SUMMARY done=' + (keys.length - failed) + ' failed=' + failed + ' jobs=' + keys.length);
process.exit(failed ? 1 : 0);
`;

test('재시도는 아직 없는 파일만 번역기에 넘기고, 끝까지 실패한 파일은 되돌린다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'repair-retry-'));
  try {
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    mkdirSync(join(dir, 'data'), { recursive: true });
    mkdirSync(join(dir, 'src/content/i18n/ko'), { recursive: true });
    copyFileSync('scripts/repair-flagged-translations.mjs', join(dir, 'scripts/repair-flagged-translations.mjs'));
    writeFileSync(join(dir, 'scripts/translate-posts.mjs'), FAKE);
    const keys = ['ko/a', 'ko/b', 'ko/bad'];
    for (const k of keys) writeFileSync(join(dir, `src/content/i18n/${k}.md`), DOC('old'));
    writeFileSync(join(dir, 'data/translation-quality.json'), JSON.stringify(Object.fromEntries(keys.map((k) => [k, { score: 3 }]))));

    const r = spawnSync(process.execPath, ['scripts/repair-flagged-translations.mjs'], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, LIMIT: '8', BATCH: '8' },
    });
    const calls = readFileSync(join(dir, 'calls.log'), 'utf8').trim().split('\n');

    assert.equal(calls.length, 3, `3번 시도해야 한다: ${r.stdout}`);
    assert.deepEqual(calls[0].split(',').sort(), ['ko/a', 'ko/b', 'ko/bad']);
    assert.equal(calls[1], 'ko/bad', '2번째 시도는 빠진 파일만');
    assert.equal(calls[2], 'ko/bad', '3번째 시도는 빠진 파일만');
    assert.match(readFileSync(join(dir, 'src/content/i18n/ko/a.md'), 'utf8'), /title: new/);
    assert.match(readFileSync(join(dir, 'src/content/i18n/ko/bad.md'), 'utf8'), /title: old/, '실패한 파일은 옛 번역으로');
    assert.match(r.stdout, /repaired=2 restored=1/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
