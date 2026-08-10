// cleanCommonsUrl 회귀 테스트.
//
// 2026-08-10: 전체 860편 중 477편의 대표 사진이 브라우저에서 안 보였다. 서버는
// 200을 주고 자동 검사도 전부 통과했지만, 위키미디어 API가 URL 끝에 붙여 보낸
// `?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=…` 때문에
// 광고·추적 차단기가 요청 자체를 취소했다. 같은 문제를 08-04에 24편 고쳤는데
// 원천을 막지 않아 6일 만에 477편이 됐다 — 그래서 이 테스트는 "지우는가"보다
// **"URL을 망가뜨리지 않는가"** 를 더 많이 본다. 경로까지 잘라먹으면 차단기
// 사용자만이 아니라 모든 방문자가 사진을 잃는다.
//   node scripts/lib/commons-url.test.mjs
import { cleanCommonsUrl } from './commons.mjs';

const BASE = 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/Walk_of_Fame.jpg/1920px-Walk_of_Fame.jpg';

const cases = [
  // 실제로 저장돼 있던 두 변형
  ['thumbnail 변형', `${BASE}?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail`, BASE],
  ['thumbnail_unscaled 변형', `${BASE}?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail_unscaled`, BASE],
  ['utm_source만 있는 경우', `${BASE}?utm_source=commons.wikimedia.org`, BASE],
  // 건드리면 안 되는 것들
  ['꼬리 없는 URL은 그대로', BASE, BASE],
  ['퍼센트 인코딩 보존', 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8c/Ajman_Nov.%2C_2010_-24.jpg/1920px-Ajman_Nov.%2C_2010_-24.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8c/Ajman_Nov.%2C_2010_-24.jpg/1920px-Ajman_Nov.%2C_2010_-24.jpg'],
  ['파일명에 utm 글자가 들어가도 안전', 'https://upload.wikimedia.org/wikipedia/commons/utm_source_building.jpg',
    'https://upload.wikimedia.org/wikipedia/commons/utm_source_building.jpg'],
  ['우리 것이 아닌 쿼리는 보존', `${BASE}?width=800`, `${BASE}?width=800`],
  ['빈 값·null도 안전', null, ''],
];

let fail = 0;
for (const [name, input, want] of cases) {
  const got = cleanCommonsUrl(input);
  const ok = got === want;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      got:  ${got}\n      want: ${want}`}`);
  if (!ok) fail++;
}

// 모든 결과는 여전히 불러올 수 있는 URL이어야 한다 (경로 훼손 방지).
for (const [name, input] of cases) {
  const got = cleanCommonsUrl(input);
  if (!got) continue;
  const ok = /^https:\/\/[^?]+\.(jpe?g|png)(\?|$)/i.test(got);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — 결과가 온전한 이미지 URL`);
  if (!ok) fail++;
}

process.exit(fail ? 1 : 0);
