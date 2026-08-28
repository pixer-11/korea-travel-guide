// ─────────────────────────────────────────────────────────────
//  ROUND ROBIN — "차례대로"를 끝까지 구현한 판.
//
//  레딧 스카우트가 서브레딧당 하나씩 뽑는 것까진 했지만 시작점이 항상
//  같아서, 상한(카드 3장)이 걸리는 날엔 항상 같은 앞 그룹들만 뽑혔다
//  (2026-08-27 코덱스 감사 — "일본 독점"이 "앞 3서브 독점"으로 좁혀졌을
//  뿐이었다). 시작점을 날짜로 돌리면 상한이 있어도 모든 그룹에 차례가 온다.
// ─────────────────────────────────────────────────────────────

/**
 * groups(Map<key, item[]>)에서 한 그룹당 하나씩, 바퀴 단위로 섞어 내놓는다.
 * offset 이 시작 그룹을 정한다 — 날짜를 넣으면 매일 첫 자리가 돈다.
 */
export function interleaveRotated(groups, offset = 0) {
  const keys = [...groups.keys()];
  if (!keys.length) return [];
  const at = ((offset % keys.length) + keys.length) % keys.length;
  const rotated = keys.slice(at).concat(keys.slice(0, at));
  const lists = rotated.map((k) => [...groups.get(k)]);
  const out = [];
  let remaining = lists.reduce((n, l) => n + l.length, 0);
  while (remaining > 0) {
    for (const l of lists) {
      if (l.length) { out.push(l.shift()); remaining--; }
    }
  }
  return out;
}

/** KST 기준 날짜 일련번호 — 자정(KST)에 1씩 는다. offset 용. */
export const kstDayIndex = (now = Date.now()) => Math.floor((now + 9 * 3600e3) / 86400e3);
