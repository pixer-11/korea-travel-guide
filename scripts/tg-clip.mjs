#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  Clip a Telegram message body — and SAY that it was clipped.
//
//    some-report | node scripts/tg-clip.mjs [maxLines] [maxChars]
//
//  Eighteen notification steps capped their body with `| head -N`. A cap is
//  right — nobody reads 300 warnings on a phone — but `head` drops the rest
//  without a word, and the rest is where the summary lives. On 2026-09-24 the
//  publish run's held-post message said "평점 미달로 내려둔 3편" and listed one:
//  the gate had run twice, the repair patrol's report followed, the body passed
//  30 lines, and the last two names plus the closing "REPAIRED x of y" line
//  were cut. The reader saw a count that its own list contradicted.
//
//  Two limits, both enforced: a line budget (what the step asked for) and a
//  character budget (Telegram rejects a message over 4,096 characters outright,
//  so raising a line cap alone can turn a clipped message into NO message).
//  Cuts land on line boundaries only — never mid-word, never mid-character.
//  Whatever is dropped is counted in a final line pointing at the full log.
// ─────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function clipForTelegram(text, maxLines = 30, maxChars = 3500) {
  const lines = String(text ?? '').replace(/\s+$/, '').split('\n');
  if (lines.length === 1 && lines[0] === '') return '';
  const kept = [];
  let chars = 0;
  for (const line of lines) {
    // Reserve room for the "…more" note so adding it can never breach the cap.
    if (kept.length >= maxLines || chars + line.length + 1 > maxChars - 60) break;
    kept.push(line);
    chars += line.length + 1;
  }
  const dropped = lines.length - kept.length;
  if (dropped > 0) kept.push(`…(외 ${dropped}줄 생략 — 전체는 GitHub Actions 로그)`);
  return kept.join('\n');
}

// CLI only when run directly — importing this for the test must not read stdin.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const maxLines = Number(process.argv[2]) || 30;
  const maxChars = Number(process.argv[3]) || 3500;
  let input = '';
  try { input = readFileSync(0, 'utf8'); } catch { input = ''; }
  const out = clipForTelegram(input, maxLines, maxChars);
  if (out) process.stdout.write(out + '\n');
}
