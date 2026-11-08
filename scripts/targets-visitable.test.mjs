// 지정 명소(data/targets.json)는 그대로 "가 볼 곳"을 안내하는 글이 된다. 발행 관문은
// 구글의 영업 상태만 보므로, 일반 관광객이 들어갈 수 없는 곳은 여기서 빠져 있어야 한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { targets } = JSON.parse(readFileSync('data/targets.json', 'utf8'));

// 아가 칸 영묘: 내부가 1997년부터 일반에 닫혔고 허가가 있어야 접근한다. 구글에는
// 평점 4.5·리뷰 302건의 영업 중 장소로 나와 관문을 그대로 통과한다(11-09).
const NOT_OPEN_TO_VISITORS = ['Mausoleum of Aga Khan'];

test('일반 관광객이 못 들어가는 곳은 지정 명소에 없다', () => {
  const topics = new Set(targets.map((t) => t.topic));
  for (const closed of NOT_OPEN_TO_VISITORS) assert.equal(topics.has(closed), false, `${closed} 이(가) 다시 들어왔다`);
});

test('역방향: 아스완의 다른 명소는 그대로 있다', () => {
  const aswan = targets.filter((t) => t.country === 'Egypt' && t.region === 'Aswan').map((t) => t.topic);
  for (const open of ['Philae Temple', 'Unfinished Obelisk', 'Nubian Museum', 'Elephantine Island', 'Aswan High Dam']) {
    assert.ok(aswan.includes(open), `${open} 이(가) 사라졌다`);
  }
});
