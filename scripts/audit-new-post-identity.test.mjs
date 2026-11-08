// 15년 규칙(ARCHIVE-PHOTO)은 공연자 글에는 적용되지 않는다 — 양방향 회귀 테스트.
// 2026-11-08: 10-06 규칙("가수 글은 그 가수의 어떤 사진이든")으로 고른 사진을 발행 관문이
// 격리했고, 순찰은 12~75분 뒤 또 옛 사진으로 바꿔 풀어 줬다(10편 중 6편). 반대로 같은
// 증거 파일에 있는 행사 분류 사진은 08-15 규칙의 핵심 대상이라 계속 걸려야 한다.
//   node --test scripts/audit-new-post-identity.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve('scripts/audit-new-post-identity.mjs');
const H = 'https://example.org/a/b/';

function run(posts, proof) {
  const dir = mkdtempSync(join(tmpdir(), 'archive-photo-'));
  try {
    mkdirSync(join(dir, 'src/content/posts'), { recursive: true });
    mkdirSync(join(dir, 'data'));
    writeFileSync(join(dir, 'data/countries.json'), '{"countries":[]}');
    writeFileSync(join(dir, 'data/performer-category-heroes.json'), JSON.stringify(proof));
    for (const [slug, { file, performer }] of Object.entries(posts)) {
      writeFileSync(join(dir, `src/content/posts/${slug}.md`), [
        '---', `title: 'Example Show: Dates, Tickets & Venue (Auckland)'`, 'category: event', 'region: Auckland',
        ...(performer ? [`eventPerformer:\n  name: ${performer}`] : []),
        `heroImage:\n  url: ${H}${file}\n  focus:\n    x: 50\n    y: 40`, '---', 'body', '',
      ].join('\n'));
    }
    const r = spawnSync(process.execPath, [SCRIPT, `--slugs=${Object.keys(posts).join(',')}`], { cwd: dir, encoding: 'utf8' });
    return { out: `${r.stdout}${r.stderr}`, status: r.status };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('공연자 사진은 15년이 넘어도 격리하지 않는다 — 분류 증거 또는 파일명', () => {
  const file = 'Nobel_Peace_Prize_Concert_2009_Westlife2.jpg';
  const r = run({
    'by-proof': { file, performer: 'Westlife' },
    'by-name': { file: 'Jethro_Tull_-_Warsaw_2009.JPG', performer: 'Jethro Tull' },
  }, { 'by-proof': { url: `${H}${file}`, category: 'Westlife' } });
  assert.equal(r.status, 0, r.out);
  assert.doesNotMatch(r.out, /ARCHIVE-PHOTO/);
});

test('행사 분류 사진과 그 공연자의 것이 아닌 옛 사진은 계속 격리한다', () => {
  const toray = 'Toray_PPO_2009_Sabine_Lisicki-1.jpg';
  const r = run({
    'event-category': { file: toray },
    'other-photo': { file: 'Misano_paddock_1986.jpg', performer: 'Westlife' },
  }, {
    'event-category': { url: `${H}${toray}`, category: '2009 Toray Pan Pacific Open' },
    // 증거가 있어도 지금 사진이 아니면 증거가 아니다
    'other-photo': { url: `${H}Westlife_2024.jpg`, category: 'Westlife' },
  });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /ARCHIVE-PHOTO event-category\.md/);
  assert.match(r.out, /ARCHIVE-PHOTO other-photo\.md/);
});
