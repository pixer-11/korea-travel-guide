// Reads newly-added post file paths from stdin (one per line) and prints a
// Telegram-friendly list — "• <title>\n  <url>" per post — so the daily report
// lists exactly which posts went live, with clickable links to check them.
import { readFileSync } from 'node:fs';

const paths = readFileSync(0, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
const out = [];
for (const p of paths) {
  let title = '';
  try {
    title = (readFileSync(p, 'utf8').match(/^title:\s*(.+)$/m)?.[1] || '').trim().replace(/^["']|["']$/g, '');
  } catch { continue; }
  const slug = p.split('/').pop().replace(/\.md$/, '');
  out.push(`• ${title || slug}`);
  out.push(`  https://wanderatlasguides.com/posts/${slug}`);
}
// Cap so a huge backfill can't blow past Telegram's 4096-char message limit.
process.stdout.write(out.slice(0, 60).join('\n'));
