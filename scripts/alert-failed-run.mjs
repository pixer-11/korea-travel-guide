#!/usr/bin/env node
// Telegram the owner about a failed run — with the reason, read from the run's
// own log. Called by job-failure-alert.yml, which watches ~34 workflows.
//
//   RUN_ID=123 WF_NAME='Weekly marketing review' RUN_URL=https://…  \
//   node scripts/alert-failed-run.mjs
//   node scripts/alert-failed-run.mjs --dry   # print, don't send
//
// The log fetch is best-effort: no token, a 404, an unreadable zip — the alert
// still goes out, just without a named cause. An alert that fails to send
// because diagnosis failed would be strictly worse than the old one-liner.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { alertText } from './lib/diagnose-failure.mjs';
import { sendTelegram } from './lib/telegram.mjs';

const DRY = process.argv.includes('--dry');
const { GITHUB_TOKEN, GITHUB_REPOSITORY, RUN_ID, WF_NAME, RUN_URL } = process.env;
const repo = GITHUB_REPOSITORY || 'pixer-11/korea-travel-guide';
const name = WF_NAME || '(이름 없음)';
const url = RUN_URL || `https://github.com/${repo}/actions/runs/${RUN_ID ?? ''}`;

// Only the tail of each step file matters and logs can be tens of MB, so read
// at most this much per file and keep the end of it.
const MAX_PER_FILE = 256 * 1024;

async function fetchLog() {
  if (!GITHUB_TOKEN || !RUN_ID) return '';
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/runs/${RUN_ID}/logs`, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
      redirect: 'follow',
    });
    if (!res.ok) return '';
    const dir = mkdtempSync(join(tmpdir(), 'runlog-'));
    const zip = join(dir, 'logs.zip');
    writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
    try {
      execFileSync('unzip', ['-o', '-q', zip, '-d', dir], { stdio: 'ignore' });
    } catch { return ''; }
    const parts = [];
    const walk = (d) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        const st = statSync(p);
        if (st.isDirectory()) { walk(p); continue; }
        if (!f.endsWith('.txt')) continue;
        const buf = readFileSync(p);
        parts.push(buf.length > MAX_PER_FILE ? buf.subarray(buf.length - MAX_PER_FILE).toString('utf8') : buf.toString('utf8'));
      }
    };
    walk(dir);
    return parts.join('\n');
  } catch {
    return '';
  }
}

const text = alertText(name, url, await fetchLog());

if (DRY) {
  console.log(text);
} else {
  // This script IS the failure notice, so a refused send must not bury what it
  // was about: the whole alert goes to the run log, the refusal is reported
  // beside it, and the throw is caught rather than replacing either.
  try {
    if (await sendTelegram(text, { disable_web_page_preview: true })) console.log('sent:', text.split('\n')[0]);
    else console.log(text);   // no secrets yet (bootstrap window) — not a failure
  } catch (e) {
    console.error(text);
    console.error(e.message);
    process.exitCode = 1;
  }
}
