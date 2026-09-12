// ─────────────────────────────────────────────────────────────
//  INVENTED CROWD CLAIMS — 측정하지 않은 혼잡 수치의 발행 차단.
//
//  2026-08-22 전수 감사에서 400편 중 99편이 산문 불량이었고, 대표 유형이
//  근거 없는 "Weekdays around 12pm–1pm are the quietest … according to local
//  foot-traffic patterns"였다. 혼잡 데이터는 이 사이트의 신뢰 자산이라,
//  데이터 없는 글이 그 말투를 흉내 내면 자산 전체가 의심받는다.
//
//  규칙: 프런트매터에 busyness(실측)가 있는 글만 시계창 혼잡 주장을 할 수
//  있다. 없는 글에서는 ①측정을 암시하는 문구(foot-traffic patterns, visitor
//  data …) ②"quietest/busiest … between Xam and Ypm" 형태의 시계창 최상급
//  주장을 잡는다. 구조적 추론("arriving right at opening beats the tour
//  groups", "before 9am is cooler")은 허용 — writer.mjs LIKE-A-LOCAL 절의
//  새 규칙과 짝을 이루는 게이트 쪽 절반이다(양방향 가드).
//
//    node scripts/audit-crowd-claims.mjs            # src/content/posts 전체
//    node scripts/audit-crowd-claims.mjs --dir=<d>  # 테스트용
//
//  출력: `INVENTED-CROWD-CLAIM: <file>.md — <근거 인용>` · 발견 시 exit 1.
// ─────────────────────────────────────────────────────────────
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { requireExamined } from './lib/examined.mjs';

const dirArg = process.argv.find((a) => a.startsWith('--dir='));
const DIR = dirArg ? dirArg.slice(6) : 'src/content/posts';

// 측정을 암시하는 문구 — 데이터가 없으면 이 말들은 전부 지어낸 것이다.
const MEASUREMENT_PHRASES = [
  /foot[\s-]?traffic (?:patterns?|data)/i,
  /visitor (?:data|statistics|counts?)/i,
  /crowd (?:data|statistics|measurements?)/i,
  /according to (?:local )?(?:crowd|traffic|visitor) \w+/i,
  /our (?:measurements?|crowd data)/i,
  /statistics show/i,
];

// 구절이 들어앉은 **문장 하나**를 돌려준다. 문장 경계는 . ! ? 와 줄바꿈.
export function sentenceAround(text, idx) {
  const before = text.slice(0, idx);
  const start = Math.max(
    before.lastIndexOf('.'), before.lastIndexOf('!'),
    before.lastIndexOf('?'), before.lastIndexOf('\n'),
  ) + 1;
  const rest = text.slice(idx);
  const m = rest.match(/[.!?\n]/);
  return text.slice(start, idx + (m ? m.index + 1 : rest.length));
}

// 이 문장이 "우리에겐 그 수치가 없다"고 말하고 있는가.
const DENIES = /\b(?:no|not|without|lacks?|lacking|none|never|isn't|aren't|wasn't|don't|doesn't|didn't|haven't|hasn't|unavailable|unpublished|yet to)\b/i;

/** 측정을 주장하는 구절. 단, 그 문장이 부정문이면 주장이 아니다. */
export function measurementClaim(prose) {
  for (const re of MEASUREMENT_PHRASES) {
    const m = prose.match(re);
    if (!m) continue;
    if (DENIES.test(sentenceAround(prose, m.index))) continue;
    return m[0];
  }
  return null;
}

// "quietest/busiest … between 9am and 11am" — 시계창을 못박은 최상급 주장.
// "before 9am" 같은 한쪽 경계 조언은 구조적 추론일 수 있어 잡지 않는다.
const CLOCK_WINDOW_CLAIM =
  /\b(?:quietest|calmest|busiest|least crowded|most crowded)\b[^.\n]{0,60}\bbetween\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)\s+and\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)/i
;
// 반대 어순: "around 12pm-1pm … the quietest"
const CLOCK_WINDOW_CLAIM_REV =
  /\b(?:around|from)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*[-–~to]{1,3}\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)\b[^.\n]{0,60}\b(?:quietest|calmest|busiest|least crowded|most crowded)/i
;
// 두 패턴 다 "between … and" 또는 "around/from" 으로 시작하는 창만 잡았다.
// 실측 없는 글 12편이 "roughly 9–11am are the quietest", "(12–4pm) are
// quietest", "9am to 11am is calmest" 로 통과했다(2026-09-02). 이 스크립트는
// 실측이 있는 글을 위에서 이미 건너뛰므로, 여기 남은 글의 시계창 최상급은
// 문형이 무엇이든 지어낸 것이다 — 시계 범위와 최상급이 한 문장 안에 있으면 잡는다.
const CLOCK_RANGE = String.raw`\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:[-–~]|to|and)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)`;
const SUPERLATIVE = String.raw`(?:quietest|calmest|busiest|least crowded|most crowded|least busy|most busy)`;
const CLOCK_WINDOW_ANY = new RegExp(
  String.raw`\b${SUPERLATIVE}\b[^.\n]{0,80}\b${CLOCK_RANGE}|\b${CLOCK_RANGE}\b[^.\n]{0,80}\b${SUPERLATIVE}\b`, 'i',
);
// An OPENING-HOURS range with a superlative about something else in the same
// sentence ("open 9am-5pm; the busiest gate is the east one") is not a crowd
// window. If the words just before the clock range say the range is when the
// place is open, the sentence is about hours (Codex, 2026-09-02).
const HOURS_CONTEXT = /\b(?:open|opens|opening|hours?|daily|closes?|closed|until|till)\b[^.\n]{0,25}$/i;
// All three window shapes go through the same hours-context test; the two
// older patterns used to run first and unfiltered, so "open daily from 6am to
// 7pm … with the calmest visits early" still read as a crowd window (Codex,
// 2026-09-02, nagoya-osu-kannon).
const clockWindowClaim = (text) => {
  for (const pat of [CLOCK_WINDOW_CLAIM, CLOCK_WINDOW_CLAIM_REV, CLOCK_WINDOW_ANY]) {
    const re = new RegExp(pat.source, 'gi');
    let m;
    while ((m = re.exec(text))) {
      const rangeAt = m[0].search(new RegExp(CLOCK_RANGE, 'i'));
      const at = m.index + Math.max(0, rangeAt);
      const before = text.slice(Math.max(0, at - 40), at);
      if (HOURS_CONTEXT.test(before)) continue;
      // 괄호 안에 시계 범위가 있고 그 괄호가 영업시간을 말하면 혼잡 창이 아니다.
      // kas-kas: "the harbor is calmest and the municipal office listed here
      // (9am–12:30pm, 1–5pm, closed weekends) is actually open" — 최상급은 항구,
      // 시각은 관공서. 앞 40자만 보던 검사는 두 절을 한 주장으로 읽었다(2026-09-08).
      const open = text.lastIndexOf('(', at);
      const close = text.indexOf(')', at);
      if (open !== -1 && close !== -1 && close > at
        // Only words that STATE hours count. "weekdays" alone is when the crowd
        // comes, not when the doors open — with it in the list, "(9am-11am on
        // weekdays)" beside "quietest" slipped through (2026-09-09 review).
        && /\b(?:closed|open|opens|opening|hours?|daily)\b/i.test(text.slice(open, close + 1))
        && !/\b(?:quiet|calm|busy|crowded|packed)\w*/i.test(text.slice(open, close + 1))) continue;
      return m[0];
    }
  }
  return null;
};

let findings = 0;
let postsRead = 0;
for (const f of readdirSync(DIR)) {
  if (!f.endsWith('.md')) continue;
  const raw = readFileSync(join(DIR, f), 'utf8');
  postsRead++;
  const fmEnd = raw.indexOf('---', 3);
  const fm = fmEnd > 0 ? raw.slice(0, fmEnd) : '';
  const body = fmEnd > 0 ? raw.slice(fmEnd + 3) : raw;
  if (/^draft:\s*true\s*$/m.test(fm)) continue;             // 초안은 게이트 대상 아님
  // 실측 보유 — 주장 자격 있음. 실제 스키마에서 busyness는 place: 아래
  // 들여쓰여 있다(최상위 busyness:는 옛 테스트 픽스처에만 있던 형태).
  // 08-28 첫 실전이 ^busyness:로 그 차이를 놓쳐 데이터 보유 글 전체를
  // 오탐했고 가나자와성이 억울하게 격리됐다. 블록 존재만으로도 부족하다 —
  // 시간값이 하나라도 있어야 시계창 주장 자격이 된다(방콕 왕궁처럼 측정은
  // 했으나 창이 빈 글이 시계창을 말하면 그것도 지어낸 것이다).
  const hasBusynessBlock = /^\s*busyness:/m.test(fm);
  const hasHourValues =
    /(?:weekday|weekend)(?:Quiet|Busy):\s*\[\s*\d/.test(fm) ||
    /(?:weekday|weekend)(?:Quiet|Busy):\s*\r?\n\s+-\s*\d/.test(fm);
  if (hasBusynessBlock && hasHourValues) continue;

  // Body AND the frontmatter prose: 9 of the 12 invented windows found on
  // 2026-09-02 sat in quickAnswer or an FAQ answer, which render on the page
  // and in the FAQ rich result. audit-hours-claims already reads all of it.
  const prose = `${body}\n${fm}`;
  // A sentence that SAYS WE DO NOT HAVE the measurement is the opposite of an
  // invented claim, and this blocked one for it on 2026-09-12:
  //   "With no published crowd data yet for a bar this new, go by structure
  //    instead: small Tokyo bars near stations tend to fill up after work."
  // That is exactly the honest shape we want writers reaching for. Matching the
  // phrase alone pushed them toward saying nothing about crowds at all, so the
  // whole sentence around the phrase is read before it counts as a claim.
  const hit = measurementClaim(prose) || clockWindowClaim(prose);
  if (hit) {
    console.log(`INVENTED-CROWD-CLAIM: ${f} — "${hit.slice(0, 90)}"`);
    findings++;
  }
}

requireExamined(postsRead, '글', `${DIR} 가 비어 있나?`);

if (findings) {
  console.log(`\n${findings} post(s) make crowd claims with no busyness data behind them.`);
  process.exit(1);
}
console.log('no invented crowd claims found.');
