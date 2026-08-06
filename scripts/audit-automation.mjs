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
  if (declaresCleanOnZero && !hasVolumeGuard && !gatedOnRealWork) {
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
const order = ['EMPTY-PASS', 'CANCELLED-RUN', 'CONCURRENCY-CANCEL', 'HEREDOC-GLUE', 'SILENT-JOB', 'SWALLOWED'];
findings.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.file.localeCompare(b.file));
for (const x of findings) console.log(`${x.kind.padEnd(13)} ${x.file}\n              ${x.detail}\n`);

const counts = order.map((k) => `${k}=${findings.filter((x) => x.kind === k).length}`).join(' ');
console.log(`📋 ${files.length} workflow(s) audited — ${findings.length} finding(s): ${counts}`);
console.log(`AUTOMATION_AUDIT_SUMMARY workflows=${files.length} findings=${findings.length} ${counts}`);
process.exit(findings.length ? 1 : 0);
