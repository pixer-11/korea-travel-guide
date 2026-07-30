// Reads newly-added post file paths from stdin (one per line) and prints a
// Telegram-friendly list — "• <title>\n  <url>" per post — so the daily report
// lists exactly which posts went live, with clickable links to check them.
// Telegram reports go to the Korean-speaking owner, so the KOREAN translated
// title (generated in the same publish run, src/content/i18n/ko/<slug>.md) is
// used; the English source title is only a fallback for a missing translation.
import { readFileSync } from 'node:fs';

const readTitle = (path) =>
  (readFileSync(path, 'utf8').match(/^title:\s*(.+)$/m)?.[1] || '').trim().replace(/^["']|["']$/g, '');

const paths = readFileSync(0, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
const out = [];
for (const p of paths) {
  let title = '';
  try {
    // The gate flips a defective new post to draft BEFORE the commit, but this
    // list is built from "files added this run" — so the first gated publish
    // proudly reported all 19 posts, live links included, while five of those
    // links led to region-hub redirects. A held post is not news to announce.
    if (/^draft:\s*true\s*$/m.test(readFileSync(p, 'utf8'))) continue;
    title = readTitle(p);
  } catch { continue; }
  const slug = p.split('/').pop().replace(/\.md$/, '');
  try {
    title = readTitle(`src/content/i18n/ko/${slug}.md`) || title;
  } catch { /* no ko translation yet — keep English title */ }
  out.push(`• ${title || slug}`);
  out.push(`  https://wanderatlasguides.com/posts/${slug}`);
}
// Cap so a huge backfill can't blow past Telegram's 4096-char message limit.
process.stdout.write(out.slice(0, 60).join('\n'));
