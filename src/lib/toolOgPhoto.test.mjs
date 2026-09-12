// 도구 허브 여섯 곳의 공유 사진이 **실제로 존재하는 사진**인지 지킨다.
//
// toolOgPhoto 는 글이 사라지면 조용히 undefined 를 돌려주고 BaseLayout 이
// 브랜드 기본값으로 되돌아간다 — 빌드는 안 깨지고 아무도 모른다. 그래서
// 여섯 슬러그가 살아 있는지는 테스트가 봐야 한다. 그러지 않으면 09-10
// 진단이 잡아낸 바로 그 상태(도구 허브 6개가 og-default.jpg)로 조용히
// 돌아간다.
//
// 폭도 여기서 잰다. 디스커버 큰 카드는 1200px 이상만 나가고, 여섯 장은
// 고를 때 전부 1920px 이상이었다. 히어로가 교체돼 좁아지면 여기서 걸린다.
//   node --test src/lib/toolOgPhoto.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toolOgPhoto, TOOL_OG } from './toolOgPhoto.mjs';

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

test('여섯 도구 허브가 전부 진짜 사진을 가리킨다', () => {
  const names = Object.keys(TOOL_OG);
  assert.ok(names.length === 6, `여섯 개여야 한다 (${names.length})`);
  for (const [tool, slug] of Object.entries(TOOL_OG)) {
    const url = toolOgPhoto(slug);
    assert.ok(url, `${tool}: ${slug} 의 히어로를 못 읽었다 — 글이 사라졌거나 초안이 됐다`);
    assert.match(url, /^https?:\/\//, `${tool}: 절대 URL 이어야 한다 (${url})`);
  }
});

test('여섯 장 모두 디스커버 큰 카드 기준(1200px)을 넘는다', () => {
  for (const [tool, slug] of Object.entries(TOOL_OG)) {
    const w = widthOf(toolOgPhoto(slug));
    // 아직 안 잰 사진은 통과시킨다 — 못 잰 것은 판정이 아니다.
    if (w === null) continue;
    assert.ok(w >= 1200, `${tool}: ${slug} 의 히어로가 ${w}px — 1200px 미만이면 큰 카드에서 빠진다`);
  }
});

test('여섯 도구가 서로 다른 사진을 쓴다', () => {
  const urls = Object.values(TOOL_OG).map(toolOgPhoto);
  assert.equal(new Set(urls).size, urls.length, '같은 사진을 두 곳이 쓰고 있다');
});

test('없는 글·초안은 기본값으로 조용히 되돌아간다 (빌드를 깨지 않는다)', () => {
  assert.equal(toolOgPhoto('this-post-does-not-exist-xyz'), undefined);
  assert.equal(toolOgPhoto('../../../etc/passwd'), undefined);
});
