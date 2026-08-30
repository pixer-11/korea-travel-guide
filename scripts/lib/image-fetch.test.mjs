// 이미지 바이트를 가져올 때 쓰는 UA 사다리 테스트.
//
// 2026-08-30: 푸켓 채식축제 글에 "Phuket Vegetarian Festival 2017"이라는
// 제목까지 정확한 사진 후보가 올라왔는데도 사진이 안 붙었다. 이유는 사진이
// 아니라 자였다 — 폭을 재려고 부른 요청에 Flickr CDN이 502를 줬고, 폭 미상은
// "1200px 미달"로 취급돼 버려졌다.
//
// 재현해 보니 원인은 User-Agent였다. 같은 URL 24개를 두 UA로 각각 불러본 결과:
//   WanderAtlasBot/1.0 …  → 200이 24개 중 4개
//   브라우저 UA           → 200이 24개 중 24개
// 봇 UA는 확률적으로 통과해서(약 17%) "가끔 되는" 것처럼 보이는 게 함정이다.
// politeFetch가 502를 재시도하긴 하지만 **같은 UA로** 재시도하니 소용이 없다.
//
// 그래서 사다리를 하나 더 놓는다: 우리를 밝히는 UA로 먼저 부르고(위키미디어는
// 이걸 요구한다), 막히면 그때만 브라우저 UA로 한 번 더. 아래 테스트는 그
// 순서와, **막히지 않았을 때는 절대 폴백을 쓰지 않는다**는 반대 방향까지 본다.
//   node --test scripts/lib/image-fetch.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { imageFetch, IMAGE_UA, FALLBACK_UA } from './image-fetch.mjs';

/** 호출된 UA를 순서대로 기록하는 가짜 fetch. */
function recorder(statuses) {
  const sent = [];
  const impl = async (url, init) => {
    sent.push({ url, ua: init?.headers?.['User-Agent'], headers: init?.headers, tries: init?.tries });
    const status = statuses[sent.length - 1] ?? 200;
    return { ok: status >= 200 && status < 300, status, headers: new Map() };
  };
  return { impl, sent };
}

const opts = (impl) => ({ fetchImpl: impl, tries: 1, baseMs: 0 });

test('우리를 밝히는 UA를 먼저 보낸다', async () => {
  const { impl, sent } = recorder([200]);
  await imageFetch('https://example.test/a.jpg', opts(impl));

  assert.equal(sent.length, 1);
  assert.equal(sent[0].ua, IMAGE_UA);
});

test('502로 막히면 브라우저 UA로 한 번 더 부른다', async () => {
  const { impl, sent } = recorder([502, 200]);
  const res = await imageFetch('https://live.staticflickr.com/x_b.jpg', opts(impl));

  assert.equal(res.status, 200);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].ua, IMAGE_UA);
  assert.equal(sent[1].ua, FALLBACK_UA);
});

// 반대 방향 — 막히지도 않았는데 정체를 숨기면 위키미디어 예절 위반이다.
test('처음부터 200이면 폴백 UA는 아예 안 쓴다', async () => {
  const { impl, sent } = recorder([200, 200]);
  await imageFetch('https://upload.wikimedia.org/a.jpg', opts(impl));

  assert.equal(sent.length, 1);
  assert.ok(!sent.some((s) => s.ua === FALLBACK_UA));
});

// 404는 차단이 아니라 진짜 없는 것 — UA를 바꿔도 나타나지 않는다.
test('404는 UA를 바꿔 다시 부르지 않는다', async () => {
  const { impl, sent } = recorder([404, 200]);
  const res = await imageFetch('https://example.test/gone.jpg', opts(impl));

  assert.equal(res.status, 404);
  assert.equal(sent.length, 1);
});

// build-wall은 "…; travel guide) build-wall" 처럼 자기를 더 자세히 밝히는 UA를
// 쓰고 있었다. 공용 함수로 옮기면서 그 정체까지 뭉개면 위키미디어 쪽에서
// 누가 부른 요청인지 알 수 없게 된다 — 호출자 UA는 그대로 살린다.
test('호출자가 자기 UA를 주면 그걸 먼저 쓴다', async () => {
  const { impl, sent } = recorder([502, 200]);
  await imageFetch('https://live.staticflickr.com/x_b.jpg', { ...opts(impl), ua: 'MyTool/2.0' });

  assert.equal(sent[0].ua, 'MyTool/2.0');
  assert.equal(sent[1].ua, FALLBACK_UA); // 막히면 폴백은 여전히 공용
});

// 재시도 예산을 어느 쪽에 쓰느냐의 문제. 거절은 UA 때문이라 같은 UA로 세 번
// 더 조르는 건 순전한 낭비다 — 후보 하나마다 7초씩 까먹으면 매일 밤 수백
// 후보를 도는 순찰이 그만큼 느려진다. 1번 칸은 한 번만 두드리고, 예산은
// 실제로 열릴 가능성이 있는 폴백 쪽에 준다.
test('거절당하면 같은 UA로 조르지 않고 폴백에 재시도 예산을 넘긴다', async () => {
  const { impl, sent } = recorder([502, 200]);
  await imageFetch('https://live.staticflickr.com/x_b.jpg', { fetchImpl: impl, tries: 3, baseMs: 0 });

  assert.equal(sent[0].tries, 1);  // 첫 UA는 한 번만
  assert.equal(sent[1].tries, 3);  // 예산은 폴백이 받는다
});

test('호출자가 준 헤더(Range 등)는 두 번째 시도에도 살아 있다', async () => {
  const { impl, sent } = recorder([502, 200]);
  await imageFetch('https://live.staticflickr.com/x_b.jpg', {
    ...opts(impl),
    headers: { Range: 'bytes=0-131071' },
  });

  assert.equal(sent.length, 2);
  assert.equal(sent[0].headers.Range, 'bytes=0-131071');
  assert.equal(sent[1].headers.Range, 'bytes=0-131071');
});
