// Hold back a defective post BEFORE it is committed, instead of reporting it
// afterwards.
//
// Until now every validator in publish.yml ran AFTER the commit-and-push step.
// That ordering means a post with a wrong photo, or advice to visit a venue on
// the day it is shut, went live first and produced a Telegram warning second —
// so the same classes of defect kept reaching readers no matter how many checks
// were added. The owner's summary of it: "새로 발행되는 글들에서는 동일한
// 문제들이 안생기게 해야 할 것 아냐".
//
// The gate does NOT fail the run. Failing it would throw away a whole day of
// generation — sixteen good posts held back because one is wrong, and the same
// sixteen regenerated tomorrow at full API cost. Instead each offending post is
// flipped to `draft: true`, which takes it off the site (the route 301s to its
// region) and leaves it in the repo for the repair patrol, which already knows
// how to fix and republish drafts. Everything clean ships on schedule.
//
//   node scripts/gate-new-posts.mjs            # quarantine offenders
//   node scripts/gate-new-posts.mjs --dry      # list them, change nothing
//   node scripts/gate-new-posts.mjs --since=HEAD~1   # only posts added since a ref
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const DIR = 'src/content/posts';
const dry = process.argv.includes('--dry');
const since = (process.argv.find((a) => a.startsWith('--since=')) || '').slice(8);

// Run a checker and take its stdout whether it exits 0 or 1 — a non-zero exit
// is the normal case here and execSync turns that into a throw.
const run = (cmd) => {
  try { return execSync(cmd, { encoding: 'utf8', maxBuffer: 1e8 }); }
  catch (e) { return String(e.stdout ?? ''); }
};

// The same, but able to tell "exited 1 WITH findings" from "died". Swallowing
// both was this gate's worst property: if a checker crashed — malformed data in
// data/, a bad import, OOM at scale — the catch returned '', that check
// contributed zero reasons, and the gate printed "✓ every post added this run
// passed the publish gate" and exited 0. The site's last line of defence could
// be entirely dead while reporting a clean pass, and both callers are
// continue-on-error, so nothing downstream would notice either (2026-08-05).
//
// A checker that finds something always PRINTS it. So a non-zero exit with no
// stdout at all is a crash, not a clean bill of health.
const CRASHED = [];
const runChecked = (name, cmd) => {
  try {
    return execSync(cmd, { encoding: 'utf8', maxBuffer: 1e8 });
  } catch (e) {
    const out = String(e.stdout ?? '');
    if (!out.trim()) {
      const detail = String(e.stderr || e.message || '').trim().split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 240);
      CRASHED.push({ name, detail });
      return '';
    }
    return out;
  }
};

// Each entry: how to run the check, and how to read a post file name out of a
// line of its output. Only defects that make the PAGE ITSELF wrong belong here.
// Sitewide or cosmetic findings stay as warnings — quarantining a post over a
// short meta description would be worse than the description.
const CHECKS = [
  {
    name: 'hours',
    why: '본문이 실제 영업시간과 어긋남 (문 닫은 시간에 오라고 안내)',
    cmd: 'node scripts/audit-hours-claims.mjs',
    pick: (l) => l.match(/^HOURS-CONTRADICTION:\s*(\S+\.md)/)?.[1],
  },
  {
    name: 'hero',
    why: '대표사진이 그 장소를 보여주지 않음',
    cmd: 'node scripts/audit-hero-titles.mjs',
    pick: (l) => l.match(/^(?:vantage|unusable)\s+(\S+\.md)/)?.[1],
  },
  {
    name: 'content',
    why: '콘텐츠 검증 실패',
    cmd: 'node scripts/validate-content.mjs',
    // Only the post-level codes. A duplicate-image line names two files and is
    // about the pair, not about one bad post, so it is deliberately not here.
    // TOOL-SPILL joined 2026-08-02: a writer response leaked raw tool syntax
    // into quickAnswer with the ENTIRE article body inside — the page rendered
    // a giant malformed answer box over an empty article, and as warning-only
    // it still published. A broken page is exactly what this gate holds back.
    // (TRUNCATED-DESCRIPTION stays a warning: cosmetic, and the generator now
    // ends descriptions on full sentences.)
    pick: (l) =>
      l.match(/(?:MISSING-COUNTRY|PHOTO-WRONG-VENUE|TOOL-SPILL|PLACEHOLDER\/no image|NON-LATIN script in title|BROKEN TITLE|GARBLED place\.name|EVENT missing eventStartDate|DUPLICATE event coverage|CONTRADICTORY event dates)[^:]*:\s*(\S+\.md)/)?.[1]
      ?? l.match(/^\s*•\s*(?:MISSING-COUNTRY|PHOTO-WRONG-VENUE|TOOL-SPILL):\s*(\S+\.md)/)?.[1],
  },
];

// Restrict to posts this run actually added, when asked. A pre-existing defect
// is the repair patrol's job; quarantining it here would silently unpublish
// pages that have been live for weeks.
let scope = null;
if (since) {
  // The posts this run generated are UNTRACKED at this point — the commit step
  // comes later, which is the whole reason this gate exists. `git diff` does not
  // list untracked files, so `--since=HEAD` alone found nothing and the gate
  // passed everything. Ask git status for both new and modified.
  const lines = run(`git status --porcelain -- ${DIR}`).split('\n');
  const names = lines
    .map((l) => l.slice(3).trim().replace(/^"|"$/g, ''))
    .filter((p) => p.endsWith('.md'))
    .map((p) => p.split('/').pop());
  const tracked = since === 'HEAD' ? [] :
    run(`git diff --name-only --diff-filter=A ${since} -- ${DIR}`)
      .split('\n').map((l) => l.trim().split('/').pop()).filter((f) => f?.endsWith('.md'));
  scope = new Set([...names, ...tracked]);
  if (!scope.size) { console.log(`no new or changed posts — nothing to gate`); process.exit(0); }
  console.log(`gating ${scope.size} new/changed post(s)`);
}

const reasons = new Map();
for (const c of CHECKS) {
  for (const line of runChecked(c.name, c.cmd).split('\n')) {
    const f = c.pick(line.trim());
    if (!f) continue;
    if (scope && !scope.has(f)) continue;
    (reasons.get(f) ?? reasons.set(f, new Set()).get(f)).add(c.why);
  }
}

// A dead checker is not a pass. Say so LOUDLY and exit non-zero, before any
// "everything passed" line can be printed — the whole point is that this state
// used to be indistinguishable from a clean run.
if (CRASHED.length) {
  console.log(`\n🚨 GATE-CHECKER-CRASHED: ${CRASHED.length} of ${CHECKS.length} checker(s) produced no output at all.`);
  for (const c of CRASHED) console.log(`  ✗ ${c.name} — ${c.detail || 'no error text'}`);
  console.log('  These posts were NOT fully checked. Treat this run as ungated.');
}

if (!reasons.size) {
  if (CRASHED.length) process.exit(1);
  console.log(`✓ every post${scope ? ' added this run' : ''} passed the publish gate.`);
  process.exit(0);
}

const held = [];
for (const [f, why] of reasons) {
  const path = join(DIR, f);
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch { continue; }
  if (/^draft:\s*true\s*$/m.test(raw)) continue;          // already held back

  if (!dry) {
    // Written as a plain line rather than through a YAML round-trip: re-dumping
    // the frontmatter would reformat place/heroImage/gallery on every post it
    // touches, and this runs on live content.
    const next = /^draft:\s*false\s*$/m.test(raw)
      ? raw.replace(/^draft:\s*false\s*$/m, 'draft: true')
      : raw.replace(/^---\r?\n/, `---\ndraft: true\n`);
    writeFileSync(path, next);
  }
  held.push({ f, why: [...why] });
}

console.log(`${dry ? 'WOULD HOLD' : 'HELD BACK'} ${held.length} post(s) from this publish:\n`);
for (const h of held) console.log(`  ${h.f}\n      ${h.why.join(' / ')}`);
console.log(
  `\n이 글들은 사이트에 올라가지 않았습니다. 저장소에는 남아 있어 자동 수리 순찰이 고친 뒤 다시 발행합니다.`
);

// The day's quota must not shrink because a post was caught. The workflow reads
// this and generates exactly as many replacements as were held, so the gate
// costs quality problems rather than published guides.
if (process.env.GITHUB_OUTPUT && !dry) {
  const { appendFileSync } = await import('fs');
  appendFileSync(process.env.GITHUB_OUTPUT, `held=${held.length}\n`);
}
// Exit 0 on purpose: the publish must continue with the posts that passed.
//
// EXCEPT when a checker died. The crash branch above exits 1 only on the path
// where nothing was flagged; if some other checker DID flag something, execution
// reached here and returned 0 — so a run that both held posts and lost a checker
// reported success. The workflow greps the log either way, but the exit code is
// what tests and any future caller read.
if (CRASHED.length) process.exit(1);
