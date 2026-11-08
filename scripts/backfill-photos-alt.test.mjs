// 쿨다운 밤의 배선 — 실제 순찰 스크립트를 임시 폴더에서 돌리는 양방향 테스트.
// 2026-11-08: 쿨다운(심사가 30일에 사진을 두 장 뗀 글)은 글자 검색을 쉬게 하는데, 그 밤도
// '사진 못 찾은 밤'으로 세어 포기 시계(photo-retry, 7회)가 올라갔다. 항저우 BWF 글은
// 대회 한 달 전에 '7일간 사진 없음·검색 중단'으로 보고될 뻔했다. 비전 장애 밤을 세지
// 않는 것과 같은 이유다: 찾아보지 않은 밤은 아무것도 증명하지 못한다.
//   node --test scripts/backfill-photos-alt.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SCRIPT = resolve('scripts/backfill-photos-alt.mjs');
const SLUG = 'hangzhou-bwf-world-tour-finals';
const H = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/';
const REJECT = 'hand-reviewed: filename shares only bwf with the title (audit-event-hero-identity --reject)';

// 네트워크 없이 돈다: 모든 요청에 빈 답을 주고, 무엇을 물었는지만 남긴다.
const STUB = `globalThis.fetch = async (url) => {
  process.stderr.write('FETCH ' + url + '\\n');
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
};
`;

function patrol({ removed = [], nights = 6 }) {
  const dir = mkdtempSync(join(tmpdir(), 'patrol-night-'));
  try {
    mkdirSync(join(dir, 'src/content/posts'), { recursive: true });
    mkdirSync(join(dir, 'data'));
    writeFileSync(join(dir, 'stub.mjs'), STUB);
    writeFileSync(join(dir, 'data/countries.json'), JSON.stringify({ countries: [{ name: 'China', regions: ['Hangzhou'] }] }));
    writeFileSync(join(dir, 'data/photo-retry.json'), JSON.stringify({ [SLUG]: nights }));
    const at = new Date(Date.now() - 3 * 86400000).toISOString();
    writeFileSync(join(dir, 'data/visual-audit.json'), JSON.stringify(Object.fromEntries(
      removed.map((f) => [`${SLUG}\x01${H}${f}`, { slug: SLUG, verdict: 'MISMATCH', reason: REJECT, at }]),
    )));
    writeFileSync(join(dir, `src/content/posts/${SLUG}.md`), [
      '---', `title: 'BWF World Tour Finals: Dates, Tickets & Venue (Hangzhou)'`, 'category: event',
      'region: Hangzhou', 'country: China', 'pubDate: 2026-10-01', '---', 'body', '',
    ].join('\n'));
    const r = spawnSync(process.execPath, ['--import', pathToFileURL(join(dir, 'stub.mjs')).href, SCRIPT], {
      cwd: dir, encoding: 'utf8', timeout: 120000,
      env: { ...process.env, DRY: '1', LIMIT: '10', SLUGS: '', AUDIT_ALL: '', ANTHROPIC_API_KEY: '', FOURSQUARE_API_KEY: '', FLICKR_API_KEY: '' },
    });
    return { out: `${r.stdout}${r.stderr}`, status: r.status };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const TWO_REMOVALS = ['TOTAL_BWF_World_Champs_2015_Day_2_Lu_Kai.jpg', 'Another_BWF_Open_2019.jpg'];
// 파일 글자 검색과 오픈버스. 분류 탐색(srnamespace=14)은 쿨다운에도 열려 있는 게 설계다.
const TEXT_SEARCH = /FETCH \S*(?:gsrnamespace=6|api\.openverse)/;

test('쿨다운 밤: 글자 검색을 쉬고, 그 밤은 포기 시계에 세지 않는다', () => {
  const r = patrol({ removed: TWO_REMOVALS });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /text searches rest/, '쿨다운이 순찰에 연결돼 있어야 한다');
  assert.doesNotMatch(r.out, TEXT_SEARCH, '쉬는 밤에 글자 검색을 하면 안 된다');
  assert.doesNotMatch(r.out, /EXHAUSTED_LIST/, r.out);
  assert.doesNotMatch(r.out, /search paused/);
});

test('대조군: 정말 찾아보고 못 찾은 밤은 계속 센다', () => {
  const r = patrol({ removed: [] });
  assert.equal(r.status, 0, r.out);
  assert.doesNotMatch(r.out, /text searches rest/);
  assert.match(r.out, TEXT_SEARCH, '쿨다운이 아니면 글자 검색을 해야 한다');
  assert.match(r.out, new RegExp(`EXHAUSTED_LIST ${SLUG}`), r.out);
});

test('대조군: 사진을 한 장만 뗀 글은 쿨다운이 아니다', () => {
  const r = patrol({ removed: TWO_REMOVALS.slice(0, 1) });
  assert.equal(r.status, 0, r.out);
  assert.doesNotMatch(r.out, /text searches rest/);
  assert.match(r.out, new RegExp(`EXHAUSTED_LIST ${SLUG}`), r.out);
});
