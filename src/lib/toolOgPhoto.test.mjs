// 도구 허브 여섯 곳의 공유 사진.
//
// 🛑 이 파일의 앞 판은 통과하면서 사이트는 브랜드 카드를 내보냈다. 그때
// 구현이 `readFileSync(new URL('../content/posts/…', import.meta.url))` 였고
// 그건 `node --test` 와 `astro dev` 에서만 동작한다 — 둘 다 이 파일을
// 소스에서 돌리니까. 번들된 프로덕션 빌드에서는 undefined 를 내고, 사진이
// 없으면 기본값으로 되돌아가는 설계라 아무 소리 없이 여섯 장이 사라졌다.
//
// 교훈 두 가지가 이 파일에 박혀 있다:
//   1. 구현이 파일시스템을 안 만진다 — 페이지가 이미 가진 컬렉션을 받는다.
//      그래서 여기서 테스트하는 것이 빌드에서 도는 것과 같은 코드다.
//   2. **이 테스트만으로는 부족하다.** 화면에 실제로 나갔는지는
//      scripts/audit-rendered-pages.mjs 가 빌드된 HTML 에서 본다.
//   node --test src/lib/toolOgPhoto.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import matter from 'gray-matter';
import { heroOf, TOOL_OG } from './toolOgPhoto.mjs';

const SEP = String.fromCharCode(1);
const probes = (() => {
  try { return JSON.parse(readFileSync('data/hero-width-queue.json', 'utf8')).probes ?? {}; }
  catch { return {}; }
})();
const widthOf = (url) => {
  for (const [k, v] of Object.entries(probes)) {
    if (k.split(SEP)[1] !== url) continue;
    return typeof v === 'number' ? v : (v?.width ?? null);
  }
  return null;
};
// 컬렉션 대신 디스크에서 같은 모양을 만들어 준다 — 구현은 이 객체만 본다.
const postOf = (slug) => {
  const p = `src/content/posts/${slug}.md`;
  if (!existsSync(p)) return null;
  return { id: slug, data: matter(readFileSync(p, 'utf8')).data };
};
const ALL = Object.values(TOOL_OG).map(postOf).filter(Boolean);

test('여섯 도구 허브가 전부 진짜 사진을 가리킨다', () => {
  assert.equal(Object.keys(TOOL_OG).length, 6);
  for (const [tool, slug] of Object.entries(TOOL_OG)) {
    assert.ok(postOf(slug), `${tool}: ${slug}.md 가 없다 — 글이 사라졌거나 이름이 바뀌었다`);
    const url = heroOf(ALL, slug);
    assert.ok(url, `${tool}: ${slug} 의 히어로를 못 읽었다`);
    assert.match(url, /^https?:\/\//, `${tool}: 절대 URL 이어야 한다 (${url})`);
  }
});

test('여섯 장 모두 디스커버 큰 카드 기준(1200px)을 넘는다', () => {
  for (const [tool, slug] of Object.entries(TOOL_OG)) {
    const w = widthOf(heroOf(ALL, slug));
    if (w === null) continue; // 못 잰 것은 판정이 아니다
    assert.ok(w >= 1200, `${tool}: ${slug} 가 ${w}px — 1200px 미만이면 큰 카드에서 빠진다`);
  }
});

test('여섯 도구가 서로 다른 사진을 쓴다', () => {
  const urls = Object.values(TOOL_OG).map((s) => heroOf(ALL, s));
  assert.equal(new Set(urls).size, urls.length, '같은 사진을 두 곳이 쓰고 있다');
});

test('id 에 .md 가 붙어 있든 없든 찾는다', () => {
  const hero = { url: 'https://example.com/a.jpg' };
  assert.equal(heroOf([{ id: 'x.md', data: { heroImage: hero } }], 'x'), hero.url);
  assert.equal(heroOf([{ id: 'x', data: { heroImage: hero } }], 'x'), hero.url);
  assert.equal(heroOf([{ slug: 'x', data: { heroImage: hero } }], 'x'), hero.url);
});

test('없는 글·초안·빈 컬렉션은 기본값으로 되돌아간다 (빌드를 깨지 않는다)', () => {
  assert.equal(heroOf(ALL, 'this-post-does-not-exist-xyz'), undefined);
  assert.equal(heroOf([], 'anything'), undefined);
  assert.equal(heroOf(undefined, 'anything'), undefined);
  assert.equal(
    heroOf([{ id: 'd', data: { draft: true, heroImage: { url: 'https://x/y.jpg' } } }], 'd'),
    undefined,
  );
});
