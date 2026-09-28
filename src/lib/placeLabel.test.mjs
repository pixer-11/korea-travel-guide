// 목록은 장소를 보여주는 자리인데 기사 제목이 새어 나왔다 (2026-09-10 실측:
// zh 는 when-to-go 120개 중 80개, 일정표 50개 중 42개). 영어·스페인어는 0건이라
// 아무도 몰랐다 — ASCII 콜론만 나누고 있었고 CJK 는 전각 ：를 쓰거나 구분자 없이
// 접미사를 붙이기 때문이다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shortPlaceLabel } from './placeLabel.mjs';

test('구분자 없이 붙은 접미사를 뗀다', () => {
  assert.equal(shortPlaceLabel('東京タワー旅行ガイド', 'ja'), '東京タワー');
  assert.equal(shortPlaceLabel('东京塔旅行指南', 'zh'), '东京塔');
  assert.equal(shortPlaceLabel('나라 공원(Nara Park) 여행 가이드', 'ko'), '나라 공원(Nara Park)');
});

test('전각 구분자에서 나눈다 — ASCII 콜론만 보면 이걸 놓친다', () => {
  assert.equal(shortPlaceLabel('巴戎寺：暹粒旅行指南（4.8星）', 'zh'), '巴戎寺');
});

test('뒤에 붙은 평점은 폭이 달라도 뗀다', () => {
  assert.equal(shortPlaceLabel('카통 파크 여행 가이드 (4.1★)', 'ko'), '카통 파크');
  assert.equal(shortPlaceLabel('スーパーツリー・グローブ完全ガイド：マリーナベイ観光(評価4.7★)', 'ja'), 'スーパーツリー・グローブ');
});

test('영어와 스페인어는 전과 같이 동작한다 (회귀 방지)', () => {
  assert.equal(shortPlaceLabel('Tokyo Tower: Tokyo Travel Guide (4.5★)', 'en'), 'Tokyo Tower');
  assert.equal(shortPlaceLabel('Torre de Tokio: Guía de viaje', 'es'), 'Torre de Tokio');
});

test('🛑 이름 전체를 지우지 않는다 — 접미사만으로 이루어진 이름', () => {
  assert.equal(shortPlaceLabel('가이드', 'ko'), '가이드');
  assert.equal(shortPlaceLabel('ガイド', 'ja'), 'ガイド');
});

test('🛑 접미사가 없으면 그대로 둔다', () => {
  assert.equal(shortPlaceLabel('東京タワー', 'ja'), '東京タワー');
  assert.equal(shortPlaceLabel('Bayon Temple', 'en'), 'Bayon Temple');
});

test('빈 값에도 죽지 않는다', () => {
  assert.equal(shortPlaceLabel(undefined, 'ko'), '');
  assert.equal(shortPlaceLabel('', 'ja'), '');
});

test('攻略 접미사와 접미사 뒤 (도시) 괄호를 뗀다 — 이름 안의 괄호는 남긴다 (2026-09-24)', () => {
  assert.equal(shortPlaceLabel('契迪龙寺完全攻略', 'zh'), '契迪龙寺');
  assert.equal(shortPlaceLabel('曼谷国际舞蹈与音乐节全攻略(曼谷)', 'zh'), '曼谷国际舞蹈与音乐节');
  assert.equal(shortPlaceLabel('大相撲九月場所(秋場所)完全ガイド(東京)', 'ja'), '大相撲九月場所(秋場所)');
  // 접미사가 앞에 없으면 끝 괄호도 이름이다.
  assert.equal(shortPlaceLabel('清迈夜市（Night Bazaar）', 'zh'), '清迈夜市（Night Bazaar）');
  assert.equal(shortPlaceLabel('나라 공원(Nara Park) 여행 가이드', 'ko'), '나라 공원(Nara Park)');
});

// 2026-09-28: 글 페이지 Klook 상자가 「スルタンアフメット広場：イスタンブール旅行ガイド（4.7★）の
// ツアー・チケット」 로 떴다. 이 헬퍼는 있었는데 PostArticle 이 쓰지 않고 split(/[:—]/) 을 따로 했다.
test('실제 글 제목 4개 언어 — 이스탄불 술탄아흐메트 광장', () => {
  assert.equal(shortPlaceLabel('スルタンアフメット広場：イスタンブール旅行ガイド（4.7★）', 'ja'), 'スルタンアフメット広場');
  assert.equal(shortPlaceLabel('苏丹艾哈迈德广场：伊斯坦布尔旅行指南（4.7★）', 'zh'), '苏丹艾哈迈德广场');
  assert.equal(shortPlaceLabel('술탄아흐메트 광장: 이스탄불 여행 가이드 (4.7★)', 'ko'), '술탄아흐메트 광장');
  assert.equal(shortPlaceLabel('Plaza de Sultanahmet: guía de viaje de Estambul (4.7★)', 'es'), 'Plaza de Sultanahmet');
});

// 부류 가드: 번역 제목을 ASCII 콜론으로만 자르는 코드가 src/ 에 다시 생기면 막는다.
// 전각 콜론을 함께 넣은 split(/[:：]/) 은 통과한다 (WhenToGo 의 번역 문자열 자르기).
test('🛑 src/ 에 전각 콜론을 모르는 제목 자르기가 없다', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { if (name !== 'content') walk(full); continue; }
      if (!/\.(astro|mjs|ts|js)$/.test(name) || name.endsWith('.test.mjs') || name === 'placeLabel.mjs') continue;
      readFileSync(full, 'utf8').split(/\r?\n/).forEach((line, i) => {
        if (/^\s*\/\//.test(line)) return;
        for (const m of line.matchAll(/split\(\/\[([^\]]*)\]/g)) {
          const cls = m[1];
          if (cls.includes(':') && !cls.includes('：') && !cls.includes('\\uff1a')) hits.push(`${full}:${i + 1}`);
        }
      });
    }
  };
  walk(root);
  assert.deepEqual(hits, [], '번역 제목에서 장소 이름을 뽑을 땐 shortPlaceLabel 을 쓴다');
});
