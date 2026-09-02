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
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
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
// A file the site cannot read is not held — it is removed. Inserting
// `draft: true` into malformed YAML leaves the build just as dead (Codex,
// 2026-09-02); the replacement round regenerates the slot. Scope-limited to
// this run's new posts, like every hold here.
const UNPARSEABLE = new Set();
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
    // Everything the week of 08-11…16 caught AFTER publish, moved in front of
    // it: a photo whose Commons record or Foursquare credit names another
    // place, a venue post with no venue behind it, an archive-dated event
    // hero, an event hero with no focal point (never went through the gate
    // that would have given it one). Owner: "처음 발행될 때 한번에 제대로."
    name: 'identity',
    why: '사진이 다른 장소이거나 글이 특정 장소를 가리키지 않음',
    cmd: 'node scripts/audit-new-post-identity.mjs --since=HEAD',
    pick: (l) => l.match(/^(?:NO-VENUE-IDENTITY|GENERIC-TITLE|PHOTO-OTHER-VENUE|PHOTO-WRONG-PLACE|ARCHIVE-PHOTO|NO-FOCUS)\s+(\S+\.md)/)?.[1],
  },
  {
    // 08-22 전수 감사의 최다 불량 유형(99편 중 다수)을 발행 전으로 옮긴 것:
    // busyness 실측이 없는 글이 "foot-traffic patterns"류 측정 화법이나
    // 시계창 최상급 주장을 하면 지어낸 것이다. writer.mjs 프롬프트 수리와
    // 같은 커밋 — 프롬프트가 안 만들게, 게이트가 새면 잡게(양방향).
    name: 'crowd-claims',
    why: '실측 없는 혼잡 수치 주장 (지어낸 통계 화법)',
    cmd: 'node scripts/audit-crowd-claims.mjs',
    pick: (l) => l.match(/^INVENTED-CROWD-CLAIM:\s*(\S+\.md)/)?.[1],
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
    pick: (l) => {
      // Pair codes name two files ("…: a.md, b.md") and either one can be the
      // new arrival — return BOTH and let the scope filter decide.
      const pair = l.match(/(?:DUPLICATE event coverage|CONTRADICTORY event dates)[^:]*:\s*(\S+\.md)\s*,\s*(\S+\.md)/);
      if (pair) return [pair[1], pair[2]];
      // Six codes joined 2026-09-02, each written after a page reached readers
      // and each emitted by the validator for weeks without ever holding a
      // post, because this list did not name them: STUB-BODY (a 50-char
      // article), PROMPT-LEAK (the model's scaffolding as the opening line),
      // EDITOR-NOTE (a repair's own note left in an FAQ answer),
      // EVENT-VENUE-GUESSED (directions to a station for a venue the text
      // admits is unconfirmed), SAME-PHOTO-TWICE, and UNPARSEABLE FRONTMATTER.
      const broken = l.match(/UNPARSEABLE FRONTMATTER:\s*(\S+\.md)/)?.[1];
      if (broken) UNPARSEABLE.add(broken);
      return l.match(/(?:MISSING-COUNTRY|PHOTO-WRONG-VENUE|TOOL-SPILL|PLACEHOLDER\/no image|NON-LATIN script in title|BROKEN TITLE|GARBLED place\.name|EVENT missing eventStartDate|DUPLICATE event coverage|CONTRADICTORY event dates|STUB-BODY|PROMPT-LEAK|EDITOR-NOTE in \w+|EVENT-VENUE-GUESSED|SAME-PHOTO-TWICE|UNPARSEABLE FRONTMATTER)[^:]*:\s*(\S+\.md)/)?.[1]
        ?? l.match(/^\s*•\s*(?:MISSING-COUNTRY|PHOTO-WRONG-VENUE|TOOL-SPILL):\s*(\S+\.md)/)?.[1];
    },
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
    // A pick may name more than one file. The duplicate-event line names BOTH
    // members of the pair and the newly discovered one is always second, so
    // taking only the first matched the older, already-live twin — which sits
    // outside `scope`, so the gate held nothing back. A Weeknd show shipped
    // twice in Jakarta that way on 2026-08-05, five days after this code was
    // supposed to have sealed the class.
    for (const f of [c.pick(line.trim())].flat().filter(Boolean)) {
      if (scope && !scope.has(f)) continue;
      (reasons.get(f) ?? reasons.set(f, new Set()).get(f)).add(c.why);
    }
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
  // Before the "already held" test: a broken file often contains `draft: true`
  // (a duplicated key was the 08-31 incident), and that line must not read as
  // "someone already dealt with this".
  if (UNPARSEABLE.has(f)) {
    console.log(`  🗑️  ${f}: the site cannot read this file — ${dry ? 'would remove' : 'removed'} rather than held (a draft flag inside broken YAML still breaks the build)`);
    if (!dry) unlinkSync(path);
    held.push({ f, why: [...why, 'frontmatter unreadable — file removed; the top-up regenerates the slot'] });
    continue;
  }
  if (/^draft:\s*true\s*$/m.test(raw)) continue;          // already held back

  if (!dry) {
    // Written as a plain line rather than through a YAML round-trip: re-dumping
    // the frontmatter would reformat place/heroImage/gallery on every post it
    // touches, and this runs on live content.
    // `heldReason: hours` records WHY inside the file. The repair patrol keys
    // on it: a held post whose contradiction later vanishes by another route
    // (data refresh, direct fix) passes the audit and used to become invisible
    // to the patrol — held forever with nothing wrong (nice-parc-ph-nix,
    // 2026-08-08). Photo quarantines carry no marker and stay untouched.
    let next = /^draft:\s*false\s*$/m.test(raw)
      ? raw.replace(/^draft:\s*false\s*$/m, 'draft: true')
      : raw.replace(/^---\r?\n/, `---\ndraft: true\n`);
    // Reason follows the actual finding: the repair patrol only handles the
    // hours class, and a photo/content hold mislabelled as "hours" sent it
    // re-auditing the wrong thing (full-audit 2026-08-10).
    const reason = [...why].some((w) => /영업시간|hours/i.test(String(w))) ? 'hours' : 'content';
    if (!/^heldReason:/m.test(next)) next = next.replace(/^draft:\s*true\s*$/m, `draft: true\nheldReason: ${reason}`);
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
