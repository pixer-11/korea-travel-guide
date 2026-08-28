// ─────────────────────────────────────────────────────────────
//  CRON WINDOW — "이 크론이 마지막으로 울렸어야 할 시각" 계산.
//
//  총괄 스케줄 감시견(schedule-watchdog.mjs)의 부품. 이 저장소의 크론은
//  전부 `분 시 * * (요일)` 꼴이라(시각은 목록 허용, 요일은 단일/범위/`*`)
//  그 부분집합만 지원하고, 벗어나는 표현은 throw 한다 — 감시견이 조용히
//  틀린 계산으로 중복 발화하거나 누락을 놓치는 것이 최악이기 때문이다.
//  모든 시각은 UTC(깃허브 크론의 시간대).
// ─────────────────────────────────────────────────────────────

const DAY = 86400e3;

function parse(expr) {
  const parts = String(expr).trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`cron not 5 fields: "${expr}"`);
  const [m, h, dom, mon, dow] = parts;
  if (dom !== '*' || mon !== '*') throw new Error(`unsupported day-of-month/month in "${expr}"`);
  if (!/^\d{1,2}$/.test(m)) throw new Error(`unsupported minute field in "${expr}"`);
  const hours = h.split(',').map((x) => {
    if (!/^\d{1,2}$/.test(x)) throw new Error(`unsupported hour field in "${expr}"`);
    return Number(x);
  });
  let days = null; // null = every day
  if (dow !== '*') {
    if (/^\d$/.test(dow)) days = new Set([Number(dow)]);
    else if (/^\d-\d$/.test(dow)) {
      const [a, b] = dow.split('-').map(Number);
      days = new Set();
      for (let d = a; d <= b; d++) days.add(d);
    } else throw new Error(`unsupported day-of-week field in "${expr}"`);
  }
  return { minute: Number(m), hours, days };
}

/**
 * 크론이 `now` 이전에 마지막으로 울렸어야 할 UTC 시각(ms).
 * 정확히 `now`와 같은 시각은 "아직"으로 본다(발화 직후 오탐 방지).
 */
export function lastFireBefore(expr, now) {
  const { minute, hours, days } = parse(expr);
  for (let back = 0; back < 8; back++) {
    const day = new Date(now - back * DAY);
    if (days && !days.has(day.getUTCDay())) continue;
    const candidates = hours
      .map((h) => Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, minute))
      .filter((t) => t < now)
      .sort((a, b) => b - a);
    if (candidates.length) return candidates[0];
  }
  throw new Error(`no fire time found in the last week for "${expr}"`);
}
