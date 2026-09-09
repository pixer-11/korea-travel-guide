// "예약된 날인데 그 워크플로가 하루 종일 한 번도 안 돌았다" 를 세는 순수 함수.
//
// 2026-09-09에 정시성 감사의 판정 기준을 지연에서 이걸로 바꾸면서 떼어 냈다.
// 이유는 그날 실측 그대로다: 깃허브 스케줄러는 08-26 이후 만성적으로 4~6시간
// 늦고(중앙값 219분), 알람시계와 감시견이 그 지각을 덮으라고 존재한다. 그래서
// 지연으로 판정하면 워크플로를 밀 때마다 사실이지만 아무 조치도 없는 경보가
// 울린다. 픽서님 지시의 문장은 "예약작업들이 **안되면** 안된다" 였다.
//
// 최근 창만 보는 이유: 14일 창에는 08-26 깃허브 장애와 09-08 계정 정지가 들어
// 있어, 이미 끝난 사고 때문에 2주 내내 울린다. 지나간 사고는 배경 통계로 남기고
// 판정은 지금 상태로 한다.
//
// ranDays 는 **모든 트리거**(예약·수동·구조 발화)의 실행 날짜여야 한다. 구조로
// 돌아간 날을 "안 된 날"로 세면 감시견이 일할수록 경보가 커진다.

const kstDay = (t) => new Date(t + 9 * 3600e3).toISOString().slice(0, 10);

/**
 * @param {Array<{file:string, skip?:string, slotTimes?:number[], ranDays?:Set<string>}>} rows
 * @param {{now?:number, recentDays?:number}} opts
 * @returns {{days:number, total:number, perWorkflow:Array<{file:string, days:string[]}>}}
 */
export function missedDays(rows, { now = Date.now(), recentDays = 7 } = {}) {
  const since = now - recentDays * 86400e3;
  const today = kstDay(now);
  const perWorkflow = [];
  for (const r of rows) {
    if (r.skip || !r.slotTimes?.length) continue;
    const scheduled = [...new Set(r.slotTimes.filter((t) => t >= since).map(kstDay))];
    // 오늘은 아직 진행 중이다 — 아직 안 온 슬롯을 누락이라 부르면 매일 아침 운다.
    const gone = scheduled.filter((d) => d !== today && !(r.ranDays ?? new Set()).has(d)).sort();
    if (gone.length) perWorkflow.push({ file: r.file, days: gone });
  }
  return {
    days: recentDays,
    total: perWorkflow.reduce((a, m) => a + m.days.length, 0),
    perWorkflow,
  };
}

// 하루 이틀은 깃허브가 슬롯을 흘린 것일 수 있고 다음 날 스스로 돌아온다.
// 사흘이면 구조망까지 죽었다는 뜻이라 사람이 봐야 한다.
export const MISSED_DAY_LIMIT = 3;
