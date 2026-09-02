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
// re-audit → republish only what now passes → refresh its four translations.
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
    return /^draft:\s*true/m.test(raw) && /^heldReason:\s*hours/m.test(raw);
  });

const before = [...flagged, ...healed];
if (!before.length) { console.log('수리할 격리 글 없음'); process.exit(0); }
console.log(`격리 글 ${before.length}편 수리 시도: ${before.join(', ')}` +
  (healed.length ? ` (이미 치유되어 해제만 필요: ${healed.join(', ')})` : ''));

if (flagged.length) run(`node scripts/fix-hours-claims.mjs --drafts --only=${flagged.join(',')}`);

// Republish only what the audit now clears — a failed rewrite stays held.
const still = new Set(
  run('node scripts/audit-hours-claims.mjs --drafts')
    .split('\n')
    .map((l) => l.match(/^HOURS-CONTRADICTION:\s*(\S+)\.md/)?.[1])
    .filter(Boolean)
);

// A release must clear EVERY hold, not just the one this script repairs. The
// gate records `heldReason: hours+wrong-region` when both fire, and before this
// check an hours fix released the post with its wrong region intact (Codex
// review, 2026-09-02). The region audit tests drafts by itself, so no flag.
const wrongRegion = new Set(
  run('node scripts/audit-region-outliers.mjs')
    .split('\n')
    .map((l) => l.match(/^REGION-OUTLIER:\s*(\S+)\.md/)?.[1])
    .filter(Boolean)
);

const repaired = [];
for (const slug of before) {
  if (still.has(slug)) { console.log(`  ✗ ${slug} — 수리 후에도 모순 남음, 격리 유지`); continue; }
  if (wrongRegion.has(slug)) { console.log(`  ✗ ${slug} — 영업시간은 풀렸지만 구역(region)이 여전히 어긋남, 격리 유지`); continue; }
  const p = join(DIR, `${slug}.md`);
  const raw = readFileSync(p, 'utf8');
  writeFileSync(p, raw
    .replace(/^draft:\s*true\s*$/m, 'draft: false')
    .replace(/^heldReason:.*\r?\n/m, ''));
  repaired.push(slug);
  console.log(`  ✓ ${slug} — 수리 완료, 재발행`);
}

if (repaired.length) {
  // The English prose changed; the four translations must follow or the fixed
  // sentence ships in one language and the wrong one in four.
  const targets = repaired.flatMap((s) => ['ko', 'ja', 'es', 'zh'].map((l) => `${l}/${s}`)).join(',');
  run(`node scripts/translate-posts.mjs --force --only=${targets}`);
  console.log(`번역 4개 언어 갱신: ${repaired.length}편`);
}

console.log(`\nREPAIRED ${repaired.length} of ${before.length} held post(s).`);
