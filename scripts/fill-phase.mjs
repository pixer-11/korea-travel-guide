#!/usr/bin/env node
// Which bulk job owns the daily Google Places budget right now.
//
// The budget is ~100-120 Details calls a day and the daily publish takes roughly
// a third, so exactly one bulk job can run behind it. Until now the handover was
// a person remembering: the country-fill cron was commented out in July "until
// photos are done", the phone/hours backfill had no way to say it was finished,
// and nothing would ever have turned the next job on. A backfill with an empty
// backlog just burns quota re-checking venues that have no phone listed.
//
// So the phase lives in a file both workflows read. The backfill reports what it
// did; after three consecutive days of finding nothing new it hands over, and
// country-fill starts on the next publish. Three days rather than one because a
// single empty day is also what an exhausted quota or a transient API failure
// looks like, and handing over on that would strand a real backlog.
//
//   node scripts/fill-phase.mjs get                 → prints "details" or "country"
//   node scripts/fill-phase.mjs record --updated 18 → records a run, may hand over
//   node scripts/fill-phase.mjs set country         → force (manual override)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const FILE = path.join(ROOT, 'data', 'fill-phase.json');

const IDLE_DAYS_TO_HAND_OVER = 3;
const PHASES = ['details', 'country'];

const DEFAULT = { phase: 'details', idleStreak: 0, history: [] };

async function load() {
  try {
    const j = JSON.parse(await readFile(FILE, 'utf8'));
    return { ...DEFAULT, ...j };
  } catch {
    return { ...DEFAULT };
  }
}

async function save(state) {
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

const argOf = (k) => {
  const i = process.argv.indexOf(`--${k}`);
  return i === -1 ? null : process.argv[i + 1];
};

const cmd = process.argv[2];
const state = await load();

if (cmd === 'get' || !cmd) {
  console.log(state.phase);
  process.exit(0);
}

if (cmd === 'set') {
  const next = process.argv[3];
  if (!PHASES.includes(next)) {
    console.error(`단계는 ${PHASES.join(' 또는 ')} 중 하나여야 합니다.`);
    process.exit(1);
  }
  await save({ ...state, phase: next, idleStreak: 0 });
  console.log(`단계를 ${next}(으)로 변경했습니다.`);
  process.exit(0);
}

if (cmd === 'record') {
  // An empty string must NOT become 0 here: the workflow passes whatever it
  // parsed out of the log, and an empty value means the parse failed, not that
  // the run found nothing. Number('') is 0, which would count a broken run as an
  // idle day and creep toward a handover on no evidence at all.
  const rawUpdated = (argOf('updated') ?? '').trim();
  const updated = rawUpdated === '' ? NaN : Number(rawUpdated);
  // An unreadable count is NOT an idle day. Treating "we could not tell" as
  // "nothing left to do" would hand over on three broken runs and abandon a real
  // backlog silently, which is the failure this whole file exists to avoid.
  if (!Number.isFinite(updated)) {
    console.log('처리 건수를 읽지 못해 이번 실행은 집계에서 제외합니다.');
    process.exit(0);
  }

  // Only the details phase is counted toward a handover. After the switch the
  // workflow is gated off anyway, but a stray manual run should not print
  // "3 days and we switch" about a switch that already happened.
  if (state.phase !== 'details') {
    console.log(`현재 단계는 '${state.phase}' 입니다 — 집계 대상이 아닙니다.`);
    process.exit(0);
  }

  const idleStreak = updated > 0 ? 0 : state.idleStreak + 1;
  const history = [...(state.history ?? []), { at: new Date().toISOString(), updated }].slice(-10);
  let phase = state.phase;
  let handover = false;

  if (phase === 'details' && idleStreak >= IDLE_DAYS_TO_HAND_OVER) {
    phase = 'country';
    handover = true;
  }

  await save({ phase, idleStreak: handover ? 0 : idleStreak, history });

  if (handover) {
    console.log('HANDOVER');
    console.log(
      `전화·영업시간 채우기가 ${IDLE_DAYS_TO_HAND_OVER}일 연속 새로 채울 것을 찾지 못했습니다. ` +
        '이제 나라별 글 수 채우기(대량발행)로 넘어갑니다.'
    );
  } else if (updated > 0) {
    console.log(`${updated}건 채움 — 계속 진행합니다.`);
  } else {
    console.log(
      `새로 채울 것 없음 ${idleStreak}일째 (${IDLE_DAYS_TO_HAND_OVER}일 연속이면 대량발행으로 전환).`
    );
  }
  process.exit(0);
}

console.error('사용법: fill-phase.mjs get | record --updated N | set <details|country>');
process.exit(1);
