import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptLeakFlags, cleanParagraph, isLinkList } from './translation-leak.mjs';

const types = (lang, body) => scriptLeakFlags(lang, body).map(([t]) => t);

// ── the exemption ───────────────────────────────────────────────────────────
// A Chinese page giving the Korean address first and the Chinese reading in
// parens is the site's own good practice mirrored — the reader shows the native
// line to a taxi driver. Flagged as korean-leak on 2026-08-15 (the one file in
// 4,352) and the fix must hold in both paren widths.
test('native address before a parenthetical gloss is not a leak (zh)', () => {
  const body = `## 交通方式

地址是：강원도 강릉시 주문진읍 옛등대길 24-7（江原道江陵市注文津邑旧灯台街24-7）。从江陵市外巴士客运站或江陵站出发，最稳妥的方式是打车（车程约20-25分钟，车费大约20,000-25,000韩元，视路况而定），或者自驾前往，山脚附近设有停车场。`;
  assert.deepEqual(types('zh', body), []);
});

test('the older gloss order — native name INSIDE the parens — still passes', () => {
  const body = `## 美食推荐

来到江陵一定要试试草堂纯豆腐（초당순두부），这是当地最有名的豆腐料理，用海水点卤制作。市场附近有好几家老店，营业时间通常从早上七点开始，建议趁早前往以免排队。`;
  assert.deepEqual(types('zh', body), []);
});

test('a kana name before a gloss is not a japanese leak (zh)', () => {
  const body = `## 交通方式

从车站出发请搭乘 さっぽろラーメン横丁（札幌拉面横丁）方向的巴士，车程大约十五分钟即可抵达，沿途会经过几个主要的购物街区，下车后步行三分钟就能看到入口的招牌。`;
  assert.deepEqual(types('zh', body), []);
});

// ── what must still be caught ───────────────────────────────────────────────
// Verbatim from bafa9e3f~1 — one of the 106 Chinese pages that shipped serving
// Korean prose. It carries "(Al Heliow)" right after a hangul run, so it also
// proves the new exemption cannot be used to buy amnesty for a real leak.
test('a wholly Korean paragraph on a zh page is still a korean-leak', () => {
  const body = `## 가볼 만한 이유

더 시트 카페는 아즈만의 신생 커피숍들 중에서도 조용히 손꼽히는 평판을 쌓아왔으며, 숫자로도 이를 확인할 수 있습니다. 리뷰 873개에 평점 4.7이라는 수치는 아직 관광 명소로 자리 잡지 않은 카페치고는 이례적으로 높은 편입니다. 이 카페는 방문객들의 여행 코스에 좀처럼 등장하지 않는, 주거지와 상업 지구가 섞인 아즈만의 한 구역인 알헬리오우(Al Heliow)에 자리하고 있습니다.`;
  assert.deepEqual(types('zh', body), ['korean-leak']);
});

test('a Korean paragraph on a ja page is still a korean-leak', () => {
  const body = `## 行き方

주문진등대는 강릉 시내에서 차로 약 25분 거리에 있으며, 버스로도 갈 수 있지만 정류장에서 언덕길을 15분쯤 걸어 올라가야 합니다. 주차장은 항구 근처에 있습니다.`;
  assert.deepEqual(types('ja', body), ['korean-leak']);
});

test('a Japanese paragraph on a ko page is still a japanese-leak', () => {
  const body = `## 가는 방법

駅から歩いて十五分ほどで到着します。バスを使う場合は、港行きの路線に乗ってください。朝は混みますので、早めの時間帯をおすすめします。周辺には駐車場もあります。`;
  assert.deepEqual(types('ko', body), ['japanese-leak']);
});

test('an English paragraph on a ko page is still an english-paragraph', () => {
  const body = `## 가는 방법

The lighthouse sits on a low bluff above the harbour and takes about twenty five minutes by taxi from the city centre, with a paid car park at the bottom of the hill for drivers.`;
  assert.deepEqual(types('ko', body), ['english-paragraph']);
});

// ── the cap ─────────────────────────────────────────────────────────────────
test('the pre-gloss exemption is length-capped', () => {
  const long = '주문진등대는 강릉 시내에서 차로 약 이십오분 거리에 있으며 버스로도 갈 수 있지만 정류장에서 언덕길을 십오분쯤 걸어 올라가야 합니다 주차장은 항구 근처에 있습니다（注）';
  assert.ok(long.length > 70, 'fixture must exceed the 60-char cap');
  assert.ok(/[가-힣]/.test(cleanParagraph(long)), 'a run past the cap keeps its hangul');
});

// ── unrelated exemptions kept working by the extraction ─────────────────────
test('official-source link lists are still exempt', () => {
  const list = `- [Gangneung City Tourism](https://example.com/a)\n- [Korea Tourism Organization](https://example.com/b)\n- [Jumunjin Port Authority](https://example.com/c)`;
  assert.equal(isLinkList(list), true);
  assert.deepEqual(types('zh', `## 参考\n\n${list}`), []);
});
