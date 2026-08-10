// wikimediaThumb 회귀 테스트.
//
// 2026-08-10: LCP를 줄이려고 히어로를 1920px → 손으로 만든 1200px 주소로 바꿨다.
// 1200은 위키미디어가 **서비스하지 않는 폭**이라 전 사이트의 대표 사진이 동시에
// 400을 받고 빈 네모가 됐다(본문 사진은 저장된 주소를 그대로 써서 멀쩡 —
// 픽서님이 "상단에 있는 사진만 깨진다"고 지목한 그 차이).
// 그래서 이 테스트의 핵심은 "폭을 바꾸는가"가 아니라 **"사다리에 없는 폭을
// 절대 만들지 않는가"** 다.
//   node scripts/../src/lib/wikimediaThumb.test.mjs
import { wikimediaThumb, legalWidth, WIKIMEDIA_WIDTHS } from './wikimediaThumb.mjs';

const W = (n) => `https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/Foo.jpg/${n}px-Foo.jpg`;

const cases = [
  ['1920 저장본을 1280으로', wikimediaThumb(W(1920), 1280), W(1280)],
  ['1920 저장본을 500으로', wikimediaThumb(W(1920), 500), W(500)],
  // 요청 폭이 사다리에 없으면 위로 올림 — 1200 요청은 1280이 되어야 한다(그대로 두면 400).
  ['사다리에 없는 1200 요청 → 1280', wikimediaThumb(W(1920), 1200), W(1280)],
  ['사다리에 없는 480 요청 → 500', wikimediaThumb(W(1920), 480), W(500)],
  // 업스케일 금지: 저장본보다 큰 폭을 달라고 하면 원본 주소 그대로(요청하면 400).
  ['저장본보다 큰 요청은 그대로', wikimediaThumb(W(960), 1920), W(960)],
  ['같은 폭 요청은 그대로', wikimediaThumb(W(1280), 1280), W(1280)],
  // 위키미디어가 아닌 주소는 손대지 않는다.
  ['4sqi 주소는 무변경', wikimediaThumb('https://fastly.4sqi.net/img/general/original/abc.jpg', 500),
    'https://fastly.4sqi.net/img/general/original/abc.jpg'],
  ['R2 미러 주소는 무변경', wikimediaThumb('https://wanderatlasguides.com/og/abc.jpg', 500),
    'https://wanderatlasguides.com/og/abc.jpg'],
  ['thumb 구간 없는 원본은 무변경', wikimediaThumb('https://upload.wikimedia.org/wikipedia/commons/4/4a/Foo.jpg', 500),
    'https://upload.wikimedia.org/wikipedia/commons/4/4a/Foo.jpg'],
  ['빈 값도 안전', wikimediaThumb(null, 500), ''],
];

let fail = 0;
for (const [name, got, want] of cases) {
  const ok = got === want;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      got:  ${got}\n      want: ${want}`}`);
  if (!ok) fail++;
}

// 진짜 불변식: 어떤 요청 폭을 넣어도 결과 URL의 px 값은 반드시 사다리 위에 있어야 한다.
for (let want = 10; want <= 4000; want += 7) {
  const out = wikimediaThumb(W(3840), want);
  const w = Number(out.match(/\/(\d{2,4})px-/)[1]);
  if (!WIKIMEDIA_WIDTHS.includes(w)) {
    console.log(`FAIL  요청 ${want}px → 사다리에 없는 ${w}px 생성`);
    fail++;
    break;
  }
}
console.log(`PASS  0~4000px 어떤 요청도 사다리 밖 폭을 만들지 않음`);

// legalWidth 자체
const lw = [[1, 20], [1200, 1280], [1920, 1920], [2000, 3840], [99999, 3840]];
for (const [want, expect] of lw) {
  const ok = legalWidth(want) === expect;
  console.log(`${ok ? 'PASS' : 'FAIL'}  legalWidth(${want}) = ${expect}`);
  if (!ok) fail++;
}

process.exit(fail ? 1 : 0);
