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

// 예약된 날의 첫 슬롯부터 이 시간 안에 실행이 하나라도 있으면 그날 일은 된 것이다.
// 깃허브 스케줄러는 08-26 이후 4~7시간 늦고, 구조 발화도 그 안에 뜬다.
export const DAY_WINDOW_H = 24;

/**
 * 예약된 날(KST) 중, 그날 첫 슬롯부터 24시간 안에 어떤 트리거로도 실행이 없었던 날.
 *
 * 2026-10-11: 슬롯의 KST 날짜와 실행의 KST 날짜를 맞대던 방식은 실제로 돈 실행
 * 3건을 "누락"으로 셌다 — smoke.yml 10-05 17:30 슬롯은 10-06 02:14 에,
 * affiliate-status 16:11 슬롯은 다음 날 00:57 에, marketing-review 일요일 20:25
 * 슬롯은 월요일 00:51 에 돌았다. 자정을 넘긴 지각이라 제 날짜가 비어 보였을 뿐이다.
 * "슬롯과 다음 슬롯 사이"로 재 보니 이번엔 하루 여러 슬롯(live-checks 2회,
 * 감시견 매시)이 다음 슬롯을 넘긴 지각 때문에 매일 울었다 — 그래서 날 단위,
 * 그날 첫 슬롯에서 24시간 창이다. 매일 같은 시각 슬롯이면 다음 날 실행은 그 창
 * 밖이라 남의 날을 대신 채우지 않는다.
 * @param {number[]} slotTimes  모든 슬롯(ms), 순서 무관
 * @param {number[]} runTimes   모든 트리거 실행의 created 시각(ms)
 */
export function slotsNotServed(slotTimes, runTimes, { now = Date.now(), since = 0 } = {}) {
  const firstOfDay = new Map();
  for (const s of slotTimes) {
    if (s < since || s > now) continue;
    const d = kstDay(s);
    if (!firstOfDay.has(d) || s < firstOfDay.get(d)) firstOfDay.set(d, s);
  }
  const win = DAY_WINDOW_H * 3600e3;
  const gone = [];
  for (const [d, first] of firstOfDay) {
    if (runTimes.some((t) => t >= first - 60e3 && t < first + win)) continue;
    if (now - first < win) continue; // 아직 창 안 — 판정 보류
    gone.push(d);
  }
  return gone.sort();
}

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
    if (Array.isArray(r.runTimes)) {
      const gone = slotsNotServed(r.slotTimes, r.runTimes, { now, since });
      if (gone.length) perWorkflow.push({ file: r.file, days: gone });
      continue;
    }
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
