// 폭 판정이 "영구 오답"인지 "다음에 다시"인지 가르는 테스트.
//
// 2026-08-30에 드러난 부류: backfill-photos-alt의 remember()는 기각 사유를
// 가리지 않고 전부 verdict:'MISMATCH'로 적었다. 그런데 읽는 쪽은
// /MISMATCH/ 하나로 "이 사진은 이 글에 안 맞는다고 이미 판정났다"고 읽고
// 영원히 건너뛴다. 그래서 CDN이 502를 준 한순간이 사진의 신원 판정으로
// 굳어버렸다 — 실제로 24건이 그렇게 박혔고, 그 중 20건은 UA만 바꾸면
// 멀쩡히 열리는 사진이었다(6건은 푸켓 채식축제, 제목까지 정확한 것들).
//
// 규칙: **재 본 것만 판정한다.** 폭을 재서 기준 미달이면 그 사진은 앞으로도
// 작을 테니 영구 기각이 맞다. 폭을 못 잰 것은 사진에 대한 정보가 0이므로
// 판정이 아니라 보류다.
//   node --test scripts/lib/image-width.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { widthVerdict, parseImageWidth, UNUSABLE_WIDTH } from './image-width.mjs';

test('기준 이상으로 재졌으면 통과', () => {
  const v = widthVerdict(2048, 1200);
  assert.equal(v.ok, true);
});

test('재서 기준 미달이면 영구 기각 — 이 사진은 내일도 작다', () => {
  const v = widthVerdict(553, 1200);
  assert.equal(v.ok, false);
  assert.equal(v.permanent, true);
  assert.match(v.reason, /553px/);
});

test('폭을 못 쟀으면 보류지 판정이 아니다', () => {
  const v = widthVerdict(null, 1200);
  assert.equal(v.ok, false);
  assert.equal(v.permanent, false);
  assert.match(v.reason, /unknown/);
});

test('0px도 못 잰 것으로 본다 — 파싱 실패의 다른 얼굴', () => {
  const v = widthVerdict(0, 1200);
  assert.equal(v.ok, false);
  assert.equal(v.permanent, false);
});

test('경계값: 기준과 정확히 같으면 통과', () => {
  assert.equal(widthVerdict(1200, 1200).ok, true);
  assert.equal(widthVerdict(UNUSABLE_WIDTH, UNUSABLE_WIDTH).ok, true);
});

// 기존 헤더 파서가 그대로인지 — 위의 변경이 자를 건드리지 않았다는 확인.
test('JPEG SOF 헤더에서 폭을 읽는다', () => {
  const buf = Buffer.from([
    0xff, 0xd8, // SOI
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x00, 0x03, 0x20, // SOF0: height 512, width 800
    0x03, 0x01, 0x22, 0x00, // 스캐너가 i+9 < length를 요구해서 뒤가 있어야 읽는다
  ]);
  assert.equal(parseImageWidth(buf), 800);
});

test('이미지가 아니면 null', () => {
  assert.equal(parseImageWidth(Buffer.from('<html>not an image</html>')), null);
});
