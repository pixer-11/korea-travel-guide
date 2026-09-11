// 차단기는 "막히는가" 와 "정상까지 막진 않는가" 둘 다 재야 한다.
//
// 특히 이 검사기는 전 사이트의 렌더 결과를 훑으므로, 오탐 하나가
// 6,600페이지에 걸쳐 터지면 아무도 안 보게 된다. 정상 통과 쪽 테스트가
// 차단 쪽만큼 중요하다.
//   node --test scripts/audit-rendered-pages.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(process.cwd(), 'scripts', 'audit-rendered-pages.mjs');

function dist(pages) {
  const root = mkdtempSync(join(tmpdir(), 'rendered-'));
  mkdirSync(join(root, 'dist'), { recursive: true });
  for (const [name, html] of Object.entries(pages)) {
    const p = join(root, 'dist', name);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, html, 'utf8');
  }
  return root;
}

const run = (cwd, ...args) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' }) };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout ?? '') };
  }
};

const ok = (body) => `<!DOCTYPE html><html><head><title>t</title></head><body><h1>Seoul</h1>${body}</body></html>`;

test('정상 페이지는 통과한다', () => {
  const root = dist({
    'index.html': ok('<p>Seoul in spring.</p><img src="/wall/a.webp" alt="Seoul">'),
    'a/index.html': ok('<p>Another page.</p>'),
  });
  const r = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /이상 없음/);
});

test('미치환 템플릿 변수를 잡는다 — /ko/tools/when-to-go 건', () => {
  const root = dist({ 'index.html': ok('<p>기온은 {city} 기준 최근 {years}년 평균값입니다.</p>') });
  const r = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /RENDERED-PAGE-PLACEHOLDER/);
});

test('JSON-LD 와 인라인 CSS 의 중괄호로는 터지지 않는다', () => {
  const root = dist({
    'index.html': ok(
      '<script type="application/ld+json">{"@type":"WebPage","name":"x"}</script>' +
      '<style>.a{color:red}.b{margin:0}</style>' +
      '<p>Real prose with no placeholder.</p>',
    ),
  });
  const r = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(r.code, 0, r.out);
});

test('빈 src 와 alt 없는 img 를 잡는다', () => {
  const root = dist({
    'a/index.html': ok('<img src="" alt="x">'),
    'b/index.html': ok('<img src="/wall/b.webp">'),
  });
  const r = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /IMG-NO-SRC/);
  assert.match(r.out, /IMG-NO-ALT/);
});

test('빈 alt 는 장식용 이미지의 정당한 표기이므로 통과한다', () => {
  const root = dist({ 'index.html': ok('<img src="/wall/a.webp" alt="">') });
  const r = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(r.code, 0, r.out);
});

// 이 검사기가 실제 dist 에서 처음 낸 세 건이 전부 이 모양이었다 (2026-09-11).
// 따옴표 안의 꺾쇠는 유효한 HTML이고, 태그의 끝이 아니다.
test('속성값 안의 꺾쇠로 태그를 자르지 않는다 — ITZY <TUNNEL VISION> 건', () => {
  const root = dist({
    'index.html': ok('<img src="/wall/a.webp" alt="Gira mundial de ITZY <TUNNEL VISION>">'),
  });
  const r = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(r.code, 0, r.out);
});

test('제목의 꺾쇠가 본문 텍스트로 새어 오탐을 만들지도 않는다', () => {
  const root = dist({
    'index.html': ok('<a href="/x" title="ITZY <TUNNEL VISION>">tour</a><p>plain prose</p>'),
  });
  const r = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(r.code, 0, r.out);
});

test('지난 날짜가 박힌 제휴 링크를 잡고, 미래 날짜는 통과시킨다', () => {
  const past = '2020-01-01';
  const future = new Date(Date.now() + 30 * 86400e3).toISOString().slice(0, 10);
  const bad = dist({ 'index.html': ok(`<a href="https://x.com/?checkIn=${past}&checkOut=${past}">stay</a>`) });
  const rb = run(bad);
  rmSync(bad, { recursive: true, force: true });
  assert.equal(rb.code, 1, rb.out);
  assert.match(rb.out, /STALE-DATE/);

  const good = dist({ 'index.html': ok(`<a href="https://x.com/?checkIn=${future}">stay</a>`) });
  const rg = run(good);
  rmSync(good, { recursive: true, force: true });
  assert.equal(rg.code, 0, rg.out);
});

test('h1 이 0개거나 2개면 잡는다', () => {
  const root = dist({
    'none/index.html': '<!DOCTYPE html><html><body><p>no heading</p></body></html>',
    'two/index.html': '<!DOCTYPE html><html><body><h1>a</h1><h1>b</h1></body></html>',
  });
  const r = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /H1-COUNT/);
});

test('embed·wall 같은 조각은 문서가 아니므로 보지 않는다', () => {
  const root = dist({ 'embed/crowd/x/index.html': '<html><body><p>fragment {n}</p></body></html>' });
  const r = run(root);
  rmSync(root, { recursive: true, force: true });
  // 볼 것이 하나도 없으므로 통과가 아니라 NOTHING-EXAMINED 여야 한다.
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /NOTHING-EXAMINED/);
});

test('dist 가 없으면 통과하지 않는다', () => {
  const root = mkdtempSync(join(tmpdir(), 'rendered-'));
  const r = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /RENDER-UNCHECKED/);
});

test('한 템플릿의 결함이 수백 페이지에 퍼져도 보고는 표본 3건 + 총계다', () => {
  const pages = {};
  for (let i = 0; i < 40; i++) pages[`p${i}/index.html`] = ok('<p>{city}</p>');
  const root = dist(pages);
  const r = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /40건/);
  // 40줄이 아니라 표본 3줄만 나온다.
  assert.ok(r.out.split('\n').filter((l) => l.includes('/index.html')).length <= 3, r.out);
});
