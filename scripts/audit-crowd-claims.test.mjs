// audit-crowd-claims 회귀 테스트 — "지어낸 혼잡 수치"의 발행 차단.
//
// 2026-08-22 전수 감사: 400편 중 99편 산문 불량, 상당수가 근거 없는
// "현지 인파 패턴에 따르면 평일 12pm–1pm이 가장 한산" 류였다. 프롬프트를
// 고쳤지만(writer.mjs LIKE-A-LOCAL), 게이트에도 같은 부류 차단기를 단다 —
// 양방향: 데이터 없는 글의 측정 주장은 막히고, 데이터 있는 글은 안 막힌다.
//
//   node --test scripts/audit-crowd-claims.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const SCRIPT = join(process.cwd(), 'scripts', 'audit-crowd-claims.mjs');

const post = (fm, body) => `---\ntitle: "T"\n${fm}---\n\n${body}\n`;

function runOn(files) {
  const dir = mkdtempSync(join(tmpdir(), 'crowd-'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  try {
    try {
      const out = execFileSync('node', [SCRIPT, `--dir=${dir}`], { encoding: 'utf8' });
      return { code: 0, out };
    } catch (e) {
      return { code: e.status, out: String(e.stdout ?? '') };
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('데이터 없는 글의 측정형 문구는 잡힌다', () => {
  const r = runOn({
    'a.md': post('draft: false\n', 'Weekdays around 12pm-1pm are the quietest stretch to visit, according to local foot-traffic patterns.'),
  });
  assert.equal(r.code, 1);
  assert.match(r.out, /INVENTED-CROWD-CLAIM:\s*a\.md/);
});

test('데이터 없는 글의 시계창 최상급 주장도 잡힌다', () => {
  const r = runOn({
    'b.md': post('draft: false\n', 'It is calmest between 9am and 11am on weekdays, so plan around that.'),
  });
  assert.equal(r.code, 1);
  assert.match(r.out, /INVENTED-CROWD-CLAIM:\s*b\.md/);
});

test('busyness 데이터가 있는 글의 같은 문장은 통과한다 (역방향, 실제 스키마: place 아래 들여쓰기)', () => {
  const r = runOn({
    'c.md': post('draft: false\nplace:\n  name: "T"\n  busyness:\n    updated: "2026-07-23"\n    weekdayQuiet:\n      - 9\n      - 10\n', 'It is calmest between 9am and 11am on weekdays.'),
  });
  assert.equal(r.code, 0, r.out);
});

test('옛 최상위 busyness 형태도 통과한다', () => {
  const r = runOn({
    'c2.md': post('draft: false\nbusyness:\n  weekdayQuiet: [9, 10]\n', 'It is calmest between 9am and 11am on weekdays.'),
  });
  assert.equal(r.code, 0, r.out);
});

test('busyness 블록이 있어도 시간값이 전부 비면 시계창 주장은 잡힌다 (왕궁 사례)', () => {
  const r = runOn({
    'c3.md': post('draft: false\nplace:\n  name: "T"\n  busyness:\n    updated: "2026-07-23"\n    weekdayQuiet: []\n    weekdayBusy: []\n', 'It is calmest between 9am and 11am on weekdays.'),
  });
  assert.equal(r.code, 1);
  assert.match(r.out, /INVENTED-CROWD-CLAIM:\s*c3\.md/);
});

test('구조적 추론("open 직후가 낫다")과 일반 조언은 통과한다', () => {
  const r = runOn({
    'd.md': post('draft: false\n', 'Arriving right at opening usually beats the tour groups. Early morning before 9am is cooler too.'),
  });
  assert.equal(r.code, 0, r.out);
});

test('초안(draft: true)은 검사하지 않는다', () => {
  const r = runOn({
    'e.md': post('draft: true\n', 'According to visitor data, it is quietest between 2pm and 3pm.'),
  });
  assert.equal(r.code, 0, r.out);
});

// 2026-09-08: 한 문장에 "항구가 가장 잔잔하다"(혼잡 아님)와 관공서 영업시간이
// 나란히 있었다. 앞 40자만 보던 hours 예외는 두 절을 한 주장으로 읽었고,
// 실측이 필요 없는 정상 글이 지적됐다(kas-kas).
test('괄호 안이 영업시간이면 옆 절의 최상급과 묶어 잡지 않는다', () => {
  const r = runOn({
    'f.md': post('draft: false\n',
      'Visit on weekday mornings when the harbor is calmest and the municipal office listed here (9am–12:30pm, 1–5pm, closed weekends) is actually open.'),
  });
  assert.equal(r.code, 0, r.out);
});

test('괄호 안에 "weekdays"만 있고 영업시간 말이 없으면 여전히 잡는다 (2026-09-09 리뷰)', () => {
  const r = runOn({
    'h.md': post('draft: false\n', 'The square is quietest (9am-11am on weekdays), so come then.'),
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /INVENTED-CROWD-CLAIM:\s*h\.md/);
});

test('괄호 안이 혼잡 이야기면 예외로 봐주지 않는다', () => {
  const r = runOn({
    'g.md': post('draft: false\n',
      'The courtyard is calmest in the window listed here (9am–11am, the quietest stretch of the day).'),
  });
  assert.equal(r.code, 1, r.out);
});

// 2026-09-12: 게이트가 정직한 문장을 막았다. 실제로 막힌 글의 문장 그대로.
// "혼잡 데이터가 없다"고 쓰는 것은 지어낸 주장의 반대편이고, 이걸 막으면
// 글쓴이는 혼잡 얘기를 아예 안 하는 쪽으로 도망간다.
test('데이터가 없다고 말하는 문장은 주장이 아니다', () => {
  const r = runOn({
    'a.md': post('', 'With no published crowd data yet for a bar this new, go by structure instead: small Tokyo bars near stations like Ebisu tend to fill up fast right after typical after-work hours.'),
    'b.md': post('', 'We do not have foot-traffic data for this venue, so treat the timing below as a rule of thumb.'),
    'c.md': post('', 'Visitor counts are unavailable here; the hours come from the listing itself.'),
  });
  assert.equal(r.code, 0, r.out);
});

test('같은 구절이라도 부정이 없으면 여전히 막힌다', () => {
  const r = runOn({
    'a.md': post('', 'According to crowd data, the queue peaks right after lunch.'),
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /INVENTED-CROWD-CLAIM/);
});

test('한 문장의 부정이 다음 문장의 주장을 덮어주지는 않는다', () => {
  const r = runOn({
    'a.md': post('', 'There is no queue at opening. Our crowd data shows the room fills by 7pm.'),
  });
  assert.equal(r.code, 1, r.out);
});
