// 은퇴글 복원 → 번역 감사 배선 (2026-09-20)
//
// 왜 있나. restore-retired-posts 는 옛 글을 **초안**으로 되살린다. 그런데
// audit-translations 는 "초안은 렌더되지 않으니 볼 필요 없다"며 초안을 통째로
// 건너뛴다(auditFrontmatter 의 `draft: true → null`). 그래서 되살아난 글의 낡은
// 번역 결함은 복원 시점엔 아무도 보지 않고, 몇 주 뒤 사진 순찰이 그 글을 공개한
// **다음 날 아침** 순찰 경고로 처음 나타났다. 결함을 만든 커밋과 그것이 보이는
// 날 사이에 몇 주가 끼어 있는 구조 — 그 간격을 없애는 배선을 여기서 고정한다.
//
// 고정하는 것 셋:
//  ① --slugs 모드는 초안이어도 본다(그게 이 모드의 존재 이유다).
//  ② 볼 것이 하나도 없으면 통과라고 말하지 않는다(검사기 계약).
//  ③ 복원 도구가 그 감사를 부르고, 나온 키를 수리 기계에 넘긴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const AUDIT = join(REPO, 'scripts', 'audit-translations.mjs');

/** A throwaway repo with one drafted EN post and one deliberately broken ko translation. */
function fixture({ draft = true, koBody = '이것은 한국어 문단입니다.\n' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wa-restore-audit-'));
  mkdirSync(join(dir, 'src', 'content', 'posts'), { recursive: true });
  mkdirSync(join(dir, 'src', 'content', 'i18n', 'ko'), { recursive: true });
  writeFileSync(
    join(dir, 'src', 'content', 'posts', 'ghost-cafe.md'),
    `---\ntitle: "Ghost Cafe"\ndescription: "A cafe."\nquickAnswer: "A cafe in town."\ndraft: ${draft}\n---\n\nA paragraph about the cafe.\n`,
  );
  writeFileSync(
    join(dir, 'src', 'content', 'i18n', 'ko', 'ghost-cafe.md'),
    `---\ntitle: "유령 카페"\ndescription: "카페입니다."\n---\n\n${koBody}`,
  );
  return dir;
}

const run = (cwd, args) => spawnSync(process.execPath, [AUDIT, ...args], { cwd, encoding: 'utf8' });

test('--slugs 모드는 초안 글의 번역도 본다 — 기본 모드는 건너뛴다', () => {
  // 원문에 있는 quickAnswer 가 번역본엔 없다 = MISSING-quickAnswer.
  // 기본 모드에서는 초안이라 아무 말도 하지 않아야 하고,
  // --slugs 로 콕 집어 물으면 반드시 잡아야 한다.
  const dir = fixture({ draft: true });
  try {
    const plain = run(dir, []);
    assert.doesNotMatch(plain.stdout, /MISSING-quickAnswer/, '기본 모드가 초안을 봤다');

    const asked = run(dir, ['--slugs=ghost-cafe']);
    assert.match(asked.stdout, /MISSING-quickAnswer/, '--slugs 모드가 초안을 건너뛰었다');
    assert.match(asked.stdout, /^TRANSLATION-DEFECT: ko\/ghost-cafe$/m, '수리 기계가 읽을 키가 없다');
    assert.notEqual(asked.status, 0, '결함을 찾고도 0 으로 끝났다');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('깨끗한 번역이면 --slugs 모드도 조용히 통과한다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wa-restore-audit-ok-'));
  try {
    mkdirSync(join(dir, 'src', 'content', 'posts'), { recursive: true });
    mkdirSync(join(dir, 'src', 'content', 'i18n', 'ko'), { recursive: true });
    writeFileSync(
      join(dir, 'src', 'content', 'posts', 'ghost-cafe.md'),
      '---\ntitle: "Ghost Cafe"\ndescription: "A cafe."\ndraft: true\n---\n\nA paragraph.\n',
    );
    writeFileSync(
      join(dir, 'src', 'content', 'i18n', 'ko', 'ghost-cafe.md'),
      '---\ntitle: "유령 카페"\ndescription: "카페입니다."\n---\n\n이것은 한국어 문단입니다.\n',
    );
    const r = run(dir, ['--slugs=ghost-cafe']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /TRANSLATION-DEFECT/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('물어본 슬러그의 번역이 한 장도 없으면 통과라고 말하지 않는다', () => {
  // 검사기 계약: 못 본 것과 결함 없는 것을 구별한다. 오타 난 슬러그를 주면
  // "깨끗하다"가 아니라 "아무것도 못 봤다"여야 한다.
  const dir = fixture();
  try {
    const r = run(dir, ['--slugs=no-such-post']);
    assert.notEqual(r.status, 0, '아무것도 안 보고 통과했다');
    assert.match(r.stdout + r.stderr, /0/, '몇 장을 봤는지 말하지 않는다');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('복원 도구가 감사를 부르고 그 키를 수리 기계에 넘긴다', () => {
  const src = readFileSync(join(REPO, 'scripts', 'restore-retired-posts.mjs'), 'utf8');
  assert.match(src, /audit-translations\.mjs/, '복원 후 번역 감사를 부르지 않는다');
  assert.match(src, /--slugs=/, '감사를 복원한 슬러그로 좁히지 않는다');
  assert.match(src, /TRANSLATION-DEFECT/, '감사 출력에서 키를 읽지 않는다');
  assert.match(src, /repair-flagged-translations\.mjs/, '나온 키를 수리 기계에 넘기지 않는다');
});
