#!/usr/bin/env node
/**
 * Puts the shared %TEMP% checkout back together after Windows Disk Cleanup
 * eats it (see scripts/lib/worktree-heal.mjs for what happened on 08-13).
 *
 * Restores every tracked file that vanished from the working tree — straight
 * out of the index via `git checkout-index`, so line endings come back exactly
 * as a normal checkout would write them — and reinstalls node_modules when the
 * lockfile's packages are no longer on disk. Deliberate deletions somebody
 * staged are never touched.
 *
 *   node scripts/heal-worktree.mjs            repair, print what was repaired
 *   node scripts/heal-worktree.mjs --check    report only, exit 1 if damaged
 *
 * Every local cron runner calls this before it does anything, because a purge
 * is silent: the cron's own log goes to a file nobody reads, and the next thing
 * it does is stage a directory.
 */
import './lib/env.mjs';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendTelegram, telegramCreds } from './lib/telegram.mjs';
import {
  parseStatusZ, purgedPaths, missingPackages, lockTopLevelPackages,
} from './lib/worktree-heal.mjs';

// Deliberately not process.cwd(): in this project the working directory drifts
// (background jobs, PowerShell hops), and a healer pointed at the wrong repo is
// worse than none. It heals the checkout it was installed in, unless a test
// says otherwise.
const ROOT = process.env.HEAL_WORKTREE_ROOT || fileURLToPath(new URL('..', import.meta.url));
const CHECK_ONLY = process.argv.includes('--check');
const git = (args) =>
  execFileSync('git', ['-C', ROOT, ...args], { maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'pipe'] });

function installedPackages() {
  const dir = join(ROOT, 'node_modules');
  if (!existsSync(dir)) return [];
  const names = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === '.bin') continue;
    if (e.name.startsWith('@')) {
      for (const s of readdirSync(`${dir}/${e.name}`, { withFileTypes: true })) {
        if (s.isDirectory()) names.push(`${e.name}/${s.name}`);
      }
    } else names.push(e.name);
  }
  return names;
}

const missingFiles = purgedPaths(parseStatusZ(git(['status', '--porcelain=v1', '-z']).toString('utf8')));

let missingDeps = [];
try {
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  missingDeps = missingPackages(lockTopLevelPackages(lock), installedPackages());
} catch { /* no lockfile readable — leave dependencies alone rather than guess */ }

if (!missingFiles.length && !missingDeps.length) {
  console.log('✓ worktree intact — no purged files, dependencies present.');
  process.exit(0);
}

console.log(
  `⚠️  worktree damage: ${missingFiles.length} tracked file(s) missing, ` +
  `${missingDeps.length} package(s) missing from node_modules.`
);

/**
 * A repair nobody hears about becomes a mystery next time. The log lives
 * outside the repo (it is machine-local noise, not site content); Telegram is
 * only reached when the local .env carries the bot credentials, which today it
 * does not — the log is what the evening sweep reads.
 */
async function report(line) {
  const stamp = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  try { appendFileSync(join(tmpdir(), 'wa-worktree-heal.log'), `${stamp} ${line}\n`, 'utf8'); } catch { /* log is best effort */ }
  if (!telegramCreds()) return;
  const text = [
    '🗺️ Wander Atlas — 공유 작업트리 자동 복구',
    `🕒 ${stamp} KST`,
    line,
    '',
    'ℹ️ 윈도우 디스크 정리(SilentCleanup)가 %TEMP% 안의 체크아웃을 지운 것으로 보입니다.',
    '이력은 안전하며(깃 폴더는 바탕화면에 있음) 파일은 자동 복구됐습니다.',
  ].join('\n');
  try {
    await sendTelegram(text, { disable_web_page_preview: true });
  } catch (e) {
    // The repair already happened and is in the log above; a failed notice must
    // not fail it. It should not vanish without a trace either.
    console.error(`heal notice not delivered: ${e.message}`);
  }
}
for (const f of missingFiles.slice(0, 10)) console.log(`   - ${f}`);
if (missingFiles.length > 10) console.log(`   … and ${missingFiles.length - 10} more`);

if (CHECK_ONLY) process.exit(1);

if (missingFiles.length) {
  // checkout-index applies the same filters a checkout does; without -f it
  // refuses to overwrite anything still on disk, so a session's edits are safe.
  execFileSync('git', ['-C', ROOT, 'checkout-index', '-z', '--stdin'], {
    input: `${missingFiles.join('\0')}\0`,
    maxBuffer: 1 << 28,
  });
  // A restored file is byte-identical to the index but its cached stat is not,
  // so `git status` calls it modified — and the cron runners decide whether to
  // commit by asking exactly that question. Re-stat the restored paths (this
  // stages nothing: entries whose *content* differs are refused, which is why
  // it cannot swallow another session's edit).
  try {
    execFileSync('git', ['-C', ROOT, 'update-index', '--really-refresh', '-z', '--stdin'], {
      input: `${missingFiles.join('\0')}\0`, maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch { /* non-zero just means some entry still needs updating — not fatal */ }

  const left = purgedPaths(parseStatusZ(git(['status', '--porcelain=v1', '-z']).toString('utf8')));
  if (left.length) {
    console.error(`❌ ${left.length} file(s) could not be restored: ${left.slice(0, 5).join(', ')}`);
    process.exit(2);
  }
  console.log(`✅ restored ${missingFiles.length} tracked file(s) from the index.`);
}

if (missingDeps.length) {
  console.log(`↻ reinstalling dependencies (${missingDeps.slice(0, 5).join(', ')}…)`);
  // shell: true is required on Windows — Node 24 refuses to spawn npm.cmd
  // directly (EINVAL). The arguments are fixed literals, nothing interpolated.
  execFileSync('npm', ['ci', '--no-audit', '--no-fund'], {
    cwd: ROOT, stdio: 'inherit', shell: true,
  });
  console.log('✅ node_modules reinstalled.');
}

await report(
  `복구: 파일 ${missingFiles.length}개${missingDeps.length ? `, 의존성 재설치(${missingDeps.length}개 누락)` : ''}`
);

// Non-zero on purpose: the callers treat "I had to repair something" as an
// event worth reporting, not as business as usual.
process.exit(1);
