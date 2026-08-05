// Audit every published hero by its FILE NAME.
//
// The vision gate judges what a photo shows, and it is right about that — but a
// picture of the Chicago skyline taken while standing under Cloud Gate is a real
// photo of a real thing, so it passes. The file name is what gives it away:
// "Chicago from under the Cloud Gate" says outright that the landmark is where
// the camera was, not what it was pointed at. That hero headed the Cloud Gate
// guide, and then led the Instagram carousel, with no sculpture in the frame.
//
// Run: node scripts/audit-hero-titles.mjs [--fix]
//   (no flag)  list what is wrong
//   --fix      queue the failures for re-resolution in data/photo-requeue.json
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { heroTitleProblem } from './lib/commons.mjs';

const POSTS_DIR = 'src/content/posts';
// The same store the vision audit writes and backfill-photos-alt.mjs drains, so
// these land in the existing re-resolution run instead of a queue nothing reads.
const QUEUE = 'data/visual-audit.json';
const fix = process.argv.includes('--fix');
const loose = process.argv.includes('--loose');

const bad = [];
// Count what was EXAMINED, not just what was found. "0 heroes named as
// something else" reads like a clean result whether the audit checked 355
// Commons heroes or none at all — and a checker that reports zero after
// looking at nothing is the failure this whole repo spent 2026-08-05 on.
let examined = 0;
for (const f of readdirSync(POSTS_DIR).filter((x) => x.endsWith('.md'))) {
  const m = readFileSync(join(POSTS_DIR, f), 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) continue;
  let fm;
  try { fm = yaml.load(m[1]); } catch { continue; }
  if (fm?.draft) continue;

  const url = fm.heroImage?.url || '';
  if (!/wikimedia|wikipedia/.test(url)) continue;   // only Commons names are descriptive
  examined++;
  const subject = fm.place?.name || String(fm.title || '').split(/[:—]/)[0].trim();
  const fileName = decodeURIComponent(url.split('/').pop() || '')
    .replace(/^\d+px-/, '').replace(/\.(jpe?g|png)$/i, '').replace(/_/g, ' ');

  const problem = heroTitleProblem(fileName, subject);
  // "off-subject" alone is not evidence of anything: Commons names the Siena
  // cathedral "Duomo di Siena" and Hwaseong Fortress without its city, so 94 of
  // 95 first-run hits were correct photos under a local or shorter name. Only
  // the two conclusive verdicts fail the audit; --loose shows the rest to read.
  if (!problem) continue;
  if (problem === 'off-subject' && !loose) continue;
  bad.push({ f, subject, fileName, problem, url });
}

for (const b of bad) console.log(`${b.problem.padEnd(12)} ${b.f}\n             "${b.fileName}"  (subject: ${b.subject})`);
console.log(`\n${bad.length} of ${examined} Commons hero(es) named as something other than a photo of the place.`);

if (fix && bad.length) {
  const store = existsSync(QUEUE) ? JSON.parse(readFileSync(QUEUE, 'utf8')) : {};
  let added = 0;
  for (const b of bad) {
    const slug = b.f.replace(/\.md$/, '');
    // Same shape visual-audit.mjs writes: key is `slug \x01 heroUrl`, and the
    // verdict must contain MISMATCH for backfill-photos-alt.mjs to pick it up.
    const key = `${slug}\x01${b.url}`;
    if (store[key]) continue;
    store[key] = { slug, verdict: 'MISMATCH', reason: `hero file name reads as ${b.problem}: "${b.fileName}"` };
    added++;
  }
  writeFileSync(QUEUE, JSON.stringify(store, null, 1) + '\n');
  console.log(`queued ${added} for re-resolution → ${QUEUE}`);
}

process.exit(bad.length ? 1 : 0);
