// Close the loop the gate opened.
//
// The gate quarantines a post whose prose contradicts its opening hours, and
// its Telegram message promises "자동 수리 순찰이 고친 뒤 다시 발행합니다" — but
// no machinery did that: the hours fixer finds its targets through the audit,
// and the audit skips drafts, so a held post was invisible to its own repair.
// The first real night the gate ran, five posts went into quarantine with no
// way back out.
//
// This runs the loop end to end: find quarantined posts whose problem is an
// hours contradiction → rewrite the offending prose against the real hours →
// re-check EVERY recorded reason → republish only what clears all of them →
// refresh its four translations.
//
// Release fails CLOSED (Codex second pass, 2026-09-02): the gate records every
// reason (`heldReason: hours+wrong-region`), each reason maps to a checker that
// can see drafts, a reason with no such checker keeps the post held and says
// so, and a checker that crashes (non-zero exit with no findings on stdout)
// clears nothing. Before this, an hours fix released a post with its wrong
// region — or any other defect — intact, and a dead checker read as "clean".
//
//   node scripts/repair-held-posts.mjs           (used by publish.yml, after the gate)
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const DIR = 'src/content/posts';
const run = (cmd) => {
  try { return execSync(cmd, { encoding: 'utf8', maxBuffer: 1e8, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { return String(e.stdout ?? ''); }
};

// A checker that finds something PRINTS it and exits 1; one that exits non-zero
// with nothing on stdout has died. Only the first is a verdict.
const runChecked = (cmd) => {
  try { return { out: execSync(cmd, { encoding: 'utf8', maxBuffer: 1e8, stdio: ['ignore', 'pipe', 'pipe'] }), crashed: false }; }
  catch (e) {
    const out = String(e.stdout ?? '');
    return { out, crashed: !out.trim() };
  }
};

// Every reason the gate can write → the checker that re-tests DRAFTS for it.
// `content` (validate-content) and the photo reasons deliberately have none:
// validate-content skips drafts and the photo patrol holds the API keys, so a
// post carrying them stays held until that tool releases it.
const CHECKERS = {
  hours: { cmd: 'node scripts/audit-hours-claims.mjs --drafts', pick: /^HOURS-CONTRADICTION:\s*(\S+)\.md/ },
  'wrong-region': { cmd: 'node scripts/audit-region-outliers.mjs', pick: /^REGION-OUTLIER:\s*(\S+)\.md/ },
};
const reasonsOf = (raw) => (raw.match(/^heldReason:\s*(.+)$/m)?.[1] ?? '').split('+').map((s) => s.trim()).filter(Boolean);

// Quarantined posts the hours audit flags. Photo quarantines are NOT touched —
// they belong to the photo patrol, which has the API keys this script does not.
const flagged = run('node scripts/audit-hours-claims.mjs --drafts')
  .split('\n')
  .map((l) => l.match(/^HOURS-CONTRADICTION:\s*(\S+)\.md/)?.[1])
  .filter(Boolean)
  .filter((slug) => /^draft:\s*true/m.test(readFileSync(join(DIR, `${slug}.md`), 'utf8')));

// Held for hours (gate marker) but passing the audit today — the contradiction
// vanished by another route (data refresh, direct fix). These need no rewrite,
// only release; without this branch they stayed held forever with nothing
// wrong (nice-parc-ph-nix, 2026-08-08). Photo quarantines never carry the
// marker, so they never enter this list.
const healed = readdirSync(DIR)
  .filter((f) => f.endsWith('.md'))
  .map((f) => f.replace(/\.md$/, ''))
  .filter((slug) => !flagged.includes(slug))
  .filter((slug) => {
    const raw = readFileSync(join(DIR, `${slug}.md`), 'utf8');
    return /^draft:\s*true/m.test(raw) && reasonsOf(raw).includes('hours');
  });

const before = [...flagged, ...healed];
if (!before.length) { console.log('수리할 격리 글 없음'); process.exit(0); }
console.log(`격리 글 ${before.length}편 수리 시도: ${before.join(', ')}` +
  (healed.length ? ` (이미 치유되어 해제만 필요: ${healed.join(', ')})` : ''));

if (flagged.length) run(`node scripts/fix-hours-claims.mjs --drafts --only=${flagged.join(',')}`);

// Re-check each recorded reason once, lazily. A result is {still: Set} or
// {crashed: true}; a crash clears nobody.
const verdicts = new Map();
const recheck = (reason) => {
  if (verdicts.has(reason)) return verdicts.get(reason);
  const c = CHECKERS[reason];
  let v;
  if (!c) v = { noChecker: true };
  else {
    const r = runChecked(c.cmd);
    v = r.crashed
      ? { crashed: true }
      : { still: new Set(r.out.split('\n').map((l) => l.match(c.pick)?.[1]).filter(Boolean)) };
  }
  verdicts.set(reason, v);
  return v;
};

const repaired = [];
for (const slug of before) {
  const p = join(DIR, `${slug}.md`);
  const raw = readFileSync(p, 'utf8');
  // A post the hours audit flagged but that carries no marker (legacy hold)
  // is judged on hours alone, as before.
  const reasons = reasonsOf(raw);
  const toClear = reasons.length ? reasons : ['hours'];
  let blocked = null;
  for (const reason of toClear) {
    const v = recheck(reason);
    if (v.noChecker) { blocked = `${reason} 사유는 초안을 재검사할 도구가 없음`; break; }
    if (v.crashed) { blocked = `${reason} 검사기가 결과 없이 죽음 — 통과로 치지 않음`; break; }
    if (v.still.has(slug)) { blocked = reason === 'hours' ? '수리 후에도 영업시간 모순 남음' : `${reason} 결함이 여전함`; break; }
  }
  if (blocked) { console.log(`  ✗ ${slug} — ${blocked}, 격리 유지`); continue; }
  writeFileSync(p, raw
    .replace(/^draft:\s*true\s*$/m, 'draft: false')
    .replace(/^heldReason:.*\r?\n/m, ''));
  repaired.push(slug);
  console.log(`  ✓ ${slug} — 수리 완료(${toClear.join('+')} 전부 통과), 재발행`);
}

if (repaired.length) {
  // The English prose changed; the four translations must follow or the fixed
  // sentence ships in one language and the wrong one in four.
  const targets = repaired.flatMap((s) => ['ko', 'ja', 'es', 'zh'].map((l) => `${l}/${s}`)).join(',');
  run(`node scripts/translate-posts.mjs --force --only=${targets}`);
  console.log(`번역 4개 언어 갱신: ${repaired.length}편`);
}

console.log(`\nREPAIRED ${repaired.length} of ${before.length} held post(s).`);
