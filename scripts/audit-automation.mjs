#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  AUTOMATION AUDIT — checks the checkers.
//
//  Written 2026-08-05 after the owner said, with cause, that a new unknown
//  defect kept appearing every day. Every one of them had been found the same
//  way: he noticed something, and only then did anyone look. They were not
//  unrelated — they were the same few shapes repeating across 36 workflows:
//
//    EMPTY-PASS      the link check reported "✅ 0 broken (0 checked)" every
//                    week for as long as it had existed, because its skip
//                    pattern matched every internal link. Zero examined is not
//                    a clean result; it is a broken instrument.
//    HEREDOC-GLUE    the accessibility check only failed on the days it FOUND
//                    something: its findings file ended without a newline, so
//                    the heredoc terminator fused to the last line.
//    SILENT-JOB      a workflow that neither reports to Telegram nor appears in
//                    job-failure-alert.yml can fail forever unnoticed.
//    SWALLOWED       `|| true` keeps a step green after the command died; if
//                    nothing downstream checks the output, the failure is gone.
//
//  This file exists so those shapes are found by a script instead of by the
//  owner. Everything it reports is a real pattern seen in this repo.
//
//   node scripts/audit-automation.mjs
// ─────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { requireExamined } from './lib/examined.mjs';

// Directory is an argument so the tests can point it at fixtures — a checker
// that cannot be tested is the next thing to go quietly wrong.
const WF_DIR = process.argv[2] || '.github/workflows';
const findings = [];
const add = (kind, file, detail) => findings.push({ kind, file, detail });

const contenders = [];   // {file, name, concurrency group, upstream workflows}
const files = existsSync(WF_DIR) ? readdirSync(WF_DIR).filter((f) => /\.ya?ml$/.test(f)) : [];
const sources = new Map(files.map((f) => [f, readFileSync(join(WF_DIR, f), 'utf8')]));

// The single watcher that subscribes to other workflows' completions. A job is
// only "covered" if it either speaks for itself or is named in here.
const alertWatcher = sources.get('job-failure-alert.yml') || '';

for (const [f, src] of sources) {
  const name = (src.match(/^name:\s*(.+)$/m) || [])[1]?.trim().replace(/^['"]|['"]$/g, '') || f;

  // ── EMPTY-PASS ────────────────────────────────────────────
  // A branch that announces success based on a count, where the count being
  // zero because NOTHING WAS EXAMINED is indistinguishable from zero because
  // everything was fine. The tell: a success branch keyed on a "0" comparison,
  // in a step that never checks how much was actually looked at.
  const declaresCleanOnZero = /(?:elif|if)\s+\[\s*"\$\{?[A-Z_]+(?::-0)?\}?"\s*=\s*"?0"?\s*\]/.test(src)
    || /\[\s*"\$\{[A-Z_]+:-0\}"\s*=\s*"0"\s*\]/.test(src);
  const hasVolumeGuard = /-lt\s+\d|-eq\s+0\s*\]\s*(?:&&|;)?\s*\{?\s*(?:echo\s+"::error|exit 1)/.test(src)
    || /examined only|검사한 링크|scanned=0|is not reading|돌지 않았습니다|검사한 \$\{POSTS/.test(src);
  // A report gated on work having actually happened cannot be an empty pass:
  // quality-audit only speaks when a commit was produced, so its zero counters
  // mean "nothing needed changing", not "nothing was examined". Excluding this
  // matters more than catching one extra case — a checker that cries wolf is a
  // checker people stop reading, which is how the site got here.
  const gatedOnRealWork = /if:\s*steps\.[\w-]+\.outputs\.(committed|changed|fixed|published)\s*==/.test(src);
  // A zero that says WHY it is zero is not an empty pass. 2026-08-27: the
  // publish throttle (data/publish-throttle.json) turns the bulk fill off on
  // purpose while Google drains 5,036 queued URLs, and its exit-0 branch
  // tells the reader so ("잠시 꺼져 있습니다") — indistinguishable-from-clean
  // is the defect, and an announced off-switch is distinguishable.
  const announcedOff = /잠시 꺼져 있(?:습니다|어)|publish-throttle\.json|deliberately (?:off|disabled)/.test(src);
  if (declaresCleanOnZero && !hasVolumeGuard && !gatedOnRealWork && !announcedOff) {
    add('EMPTY-PASS', f,
      `"${name}" reports success when its counter is 0, with nothing verifying that anything was examined. A crawl/scan that reads nothing looks identical to a clean result.`);
  }

  // ── HEREDOC-GLUE ──────────────────────────────────────────
  // `{ echo "k<<D"; cat FILE; echo "D"; } >> $GITHUB_OUTPUT` only works when
  // FILE ends in a newline. awk/grep/sed always add one; a JS join() does not.
  const heredocs = [...src.matchAll(/echo\s+"[a-z_]+<<([A-Z_]+)"\s*;\s*cat\s+(\S+)/g)];
  for (const [, , file] of heredocs) {
    const writer = new RegExp(`writeFileSync\\(\\s*["']${file.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}["']\\s*,\\s*([^;]*)`, 's');
    const m = src.match(writer);
    if (m && /\.join\(/.test(m[1]) && !/\+\s*["'`]\\n|body \? body \+/.test(m[1])) {
      add('HEREDOC-GLUE', f,
        `${file} is written with join() and no trailing newline, then closed by a heredoc delimiter — the terminator fuses to the last line and the whole step fails, but ONLY on runs that actually find something.`);
    }
  }

  // ── SILENT-JOB ────────────────────────────────────────────
  const talks = /api\.telegram\.org/.test(src);
  const watched = alertWatcher.includes(`- ${name}`) || alertWatcher.includes(`'${name}'`) || alertWatcher.includes(`"${name}"`);
  const isWatcher = f === 'job-failure-alert.yml';
  const reusable = /^on:\s*\n\s*workflow_call:/m.test(src) || /workflow_call:/.test(src.slice(0, 400));
  if (!talks && !watched && !isWatcher && !reusable) {
    add('SILENT-JOB', f,
      `"${name}" sends no Telegram message and is not listed in job-failure-alert.yml — if it fails, or quietly stops doing its job, nothing says so.`);
  }

  // ── CANCELLED-RUN ─────────────────────────────────────────
  // cancel-in-progress looks like tidiness and behaves like sabotage on a repo
  // where bots commit all day. GitHub scores a superseded run as a FAILED run
  // and emails the owner about it, so on 2026-08-06 three consecutive commits
  // produced "Run failed: Tests" and "Run failed: Build check" for a test suite
  // that passes 289/289 locally. Two costs, both paid at once: the owner learns
  // to ignore the alert, and the cancelled run never executed the check at all
  // — the deploy guard reported nothing about whether the site could still
  // build. This repo is public, so Actions minutes are free and cancelling buys
  // nothing to offset either cost. Queue the runs instead.
  if (/cancel-in-progress:\s*true/.test(src)) {
    add('CANCELLED-RUN', f,
      `"${name}" sets cancel-in-progress: true. A superseded run is reported as a FAILURE and emailed to the owner, and it never runs the check it exists to run — so this both trains the owner to ignore alerts and leaves commits unverified. Actions minutes are free on a public repo; set it to false.`);
  }

  // ── CONCURRENCY-CANCEL ────────────────────────────────────
  // Collected below and reported after the loop: two or more workflows that
  // share a concurrency group AND fire on the same upstream event will contend,
  // and GitHub does not queue them politely. When a request is already waiting
  // in a group and a newer one arrives, the WAITING one is cancelled — so with
  // three subscribers to one event, one dies every single day. That is what
  // happened here: publish completion fanned out to backfill-details, backfill
  // and quality-audit, all in `places-bulk`, and on 2026-08-04 the phone/hours
  // backfill was killed with "Canceling since a higher priority waiting request
  // for places-bulk exists". It also took fill-phase's bookkeeping with it, so
  // the handover to country-fill could never have fired. Chain them instead.
  const group = (src.match(/concurrency:\s*(?:\n\s*group:\s*)?([\w-]+)/) || [])[1];
  const upstream = [...src.matchAll(/workflows:\s*\[?'([^']+)'/g)].map((m) => m[1]);
  if (group && upstream.length) contenders.push({ f, name, group, upstream });

  // ── PUSH-NO-WRITE ─────────────────────────────────────────
  // The job pushes to the repo but never declares `permissions: contents:
  // write`. GitHub's default token is read-only for new workflows, so the
  // job does its whole run and then dies at `git push` with a 403 — the
  // index-coverage audit's first Tuesday (2026-08-18): sampled, alarmed,
  // committed locally, and lost the log. Every job that pushes must say so.
  if (/git push\b/.test(src) && !/permissions:\s*[\s\S]{0,120}?contents:\s*write/.test(src)) {
    add('PUSH-NO-WRITE', f,
      'this workflow runs `git push` but declares no `permissions: contents: write` — the default token is read-only and the push 403s after the whole job has run');
  }

  // ── MUTED-CHECK ───────────────────────────────────────────
  // A checker wired with `continue-on-error: true` and nothing that reads its
  // outcome. It runs, it fails, the job stays green, and the failure exists
  // only in a log nobody opens. SILENT-JOB catches a whole workflow that
  // reports to nobody; SWALLOWED catches `|| true`; this is the third shape,
  // and it is the one that hides a check we deliberately made non-blocking.
  //
  // Found 2026-09-08 across 11 steps, including check-whats-closed-rendered —
  // wired the day before precisely because that page had once shipped empty in
  // five languages, and wired without a voice.
  //
  // The repo's own pattern is the fix: give the step an `id`, then a following
  // step `if: steps.<id>.outcome == 'failure'` that sends Telegram. A step is
  // counted as heard if anything later reads its outcome, if it tees to a file
  // a later step reads, or if it messages Telegram itself.
  {
    let doc;
    try { doc = yaml.load(src); } catch { doc = null; }
    for (const [, job] of Object.entries(doc?.jobs ?? {})) {
      const steps = Array.isArray(job?.steps) ? job.steps : [];
      // 뒤 단계 전체를 문자열로 본다. `if:`/`run:` 만 보다가 refresh.yml 을 오탐했다 —
      // 거기서는 후속 알림 단계가 `env:` 로 `steps.fsq.outcome` 을 읽는다.
      const laterText = (i) => JSON.stringify(steps.slice(i + 1));
      steps.forEach((s, i) => {
        if (s?.['continue-on-error'] !== true) return;
        const run = String(s?.run ?? '');
        // A checker run inside `$( … )` has its output consumed by the very line
        // that calls it — it is a list-maker feeding a repair there, not a verdict
        // nobody reads (publish.yml hands the tense audit's list to the
        // re-translator that way, 2026-09-09). Only bare calls count.
        const bare = run.split('\n').filter((l) => !/\$\([^)]*scripts\/(?:audit|check|lint|validate)-[\w-]+\.mjs/.test(l)).join('\n');
        const calls = [...new Set(bare.match(/scripts\/((?:audit|check|lint|validate)-[\w-]+)\.mjs/g) ?? [])];
        if (!calls.length) return;
        if (/telegram/i.test(run)) return;                       // shouts for itself
        const after = laterText(i);
        // `conclusion` is NOT hearing it: continue-on-error rewrites a failed step's
        // conclusion to success, so a later `if: steps.x.conclusion == 'failure'` can
        // never fire. Only `outcome` (or outputs) sees the real result.
        if (s.id && new RegExp(`steps\\.${s.id}\\.(outcome|outputs)`).test(after)) return;
        const logs = [...new Set(run.match(/\/tmp\/[\w.-]+/g) ?? [])];
        if (logs.some((l) => after.includes(l))) return;         // a later step reads its log
        add('MUTED-CHECK', f,
          `"${s.name ?? calls.join(', ')}" runs ${calls.join(', ')} with continue-on-error and nothing reads its result — when it fails, the job stays green and only the log knows. Give the step an id and a following step with \`if: steps.<id>.outcome == 'failure'\` that reports it.`);
      });
    }
  }

  // ── UNGATED-COMMIT ────────────────────────────────────────
  // The publish gate marks a defective post `draft: true` and exits 0, so it is
  // run under continue-on-error. That means a NON-success outcome carries one
  // meaning only: the gate crashed and nothing was checked. Committing anyway
  // ships an unchecked batch.
  //
  // publish.yml learned this on 2026-09-02 and grew `if: steps.gate.outcome ==
  // 'success'`. discover-events.yml ran the same gate, under the same
  // continue-on-error, with an unconditional commit right after it — for eight
  // more days, on the site's highest-yield page type, under a comment that said
  // "every path that commits posts needs the gate". The comment was right and
  // nothing enforced it. This does.
  try {
    const doc = yaml.load(src);
    for (const job of Object.values(doc?.jobs ?? {})) {
      const steps = Array.isArray(job?.steps) ? job.steps : [];
      const gate = steps.find((st) => /gate-new-posts\.mjs/.test(String(st?.run ?? '')));
      if (!gate) continue;
      // Only the step that commits POSTS. publish.yml also commits a photo
      // strip and the issue ledger, and gating those on the gate would be
      // backwards — the ledger is most worth keeping on the run that crashed.
      const commits = steps.filter((st) => {
        const run = String(st?.run ?? '');
        // The run's NEW posts, not a repair to existing ones. The batch commit
        // stages data/published.json (the ledger of what shipped this run);
        // the photo-strip repair commit stages posts alone and is deliberately
        // if: always(), because removing a wrong photo is safe whatever the
        // gate did. Requiring the ledger separates the two.
        return run.includes('git commit')
          && run.includes('src/content/posts')
          && run.includes('data/published.json');
      });
      if (!commits.length) continue;
      if (!gate.id) {
        add('UNGATED-COMMIT', f,
          `the publish gate step has no \`id\`, so no later step can ask whether it ran — the commit below it cannot be conditioned on the gate at all.`);
        continue;
      }
      const guard = new RegExp(`steps\.${gate.id}\.outcome`);
      for (const c of commits) {
        if (!guard.test(String(c.if ?? ''))) {
          add('UNGATED-COMMIT', f,
            `"${c.name ?? 'a commit step'}" commits without checking \`steps.${gate.id}.outcome\`. The gate runs under continue-on-error because a HELD post exits 0, so a non-success outcome means the gate CRASHED and nothing was checked — and this commits that batch anyway.`);
        }
      }
    }
  } catch { /* a workflow that does not parse is CANCELLED-RUN's problem, not this rule's */ }

  // ── SWALLOWED ─────────────────────────────────────────────
  // `|| true` on a line that writes a file, where nothing afterwards checks
  // that the file has content. This is how a dead crawler stays invisible.
  for (const line of src.split('\n')) {
    const m = line.match(/>\s*(\/tmp\/[\w.-]+)[^|]*\|\|\s*true|tee\s+(\/tmp\/[\w.-]+)[^|]*\|\|\s*true/);
    if (!m) continue;
    const out = m[1] || m[2];
    const checked = new RegExp(`(?:-s\\s+${out}|wc -[lc]\\s*<?\\s*${out}|\\[\\s*-s\\s+"?${out})`).test(src);
    if (!checked) {
      add('SWALLOWED', f,
        `${out} is written under \`|| true\` and never checked for content — if the command died, the next step reads an empty file and reports whatever emptiness means.`);
    }
  }
}

// Same concurrency group + same upstream trigger = a daily cancellation.
{
  const seen = new Map();   // "group|upstream" → [workflow names]
  for (const c of contenders) {
    for (const up of c.upstream) {
      const k = `${c.group}|${up}`;
      (seen.get(k) || seen.set(k, []).get(k)).push(c.name);
    }
  }
  for (const [k, names] of seen) {
    if (names.length < 2) continue;
    const [grp, up] = k.split('|');
    add('CONCURRENCY-CANCEL', names.join(' + '),
      `${names.length} workflows share concurrency group "${grp}" AND all fire on "${up}" completing. GitHub cancels the request that is WAITING when a newer one arrives, so one of them is destroyed on every run. Chain them by trigger instead of firing them in parallel.`);
  }
}

// ── report ──────────────────────────────────────────────────
const order = ['UNGATED-COMMIT', 'EMPTY-PASS', 'CANCELLED-RUN', 'CONCURRENCY-CANCEL', 'HEREDOC-GLUE', 'MUTED-CHECK', 'SILENT-JOB', 'SWALLOWED', 'PUSH-NO-WRITE'];
findings.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.file.localeCompare(b.file));
for (const x of findings) console.log(`${x.kind.padEnd(13)} ${x.file}\n              ${x.detail}\n`);

requireExamined(files.length, '워크플로 파일', `${WF_DIR} 가 비어 있거나 없다`);

const counts = order.map((k) => `${k}=${findings.filter((x) => x.kind === k).length}`).join(' ');
console.log(`📋 ${files.length} workflow(s) audited — ${findings.length} finding(s): ${counts}`);
console.log(`AUTOMATION_AUDIT_SUMMARY workflows=${files.length} findings=${findings.length} ${counts}`);
process.exit(findings.length ? 1 : 0);
