// Every content file must parse with the SAME YAML parser the pipeline uses.
//
// 2026-09-17: a hand edit added `website:` to one post's place block and left a
// stray blank line behind it. Nothing local complained — validate-content reads
// frontmatter with its own tolerant splitter and passed 1,645 posts clean — so
// the file was committed, and four hours later the fill/generate job died on
// `YAMLException: duplicated mapping key` while writing that night's batch.
// The posts it had already generated died with the runner: the alert the owner
// got was "글을 만들었지만 저장에 실패했습니다", and the API spend was real.
//
// gray-matter is what generate.mjs, the patrols and Astro's content layer all
// use. Running it over every file costs about a second and turns that class of
// accident into a failed `npm run ci` instead of a lost publish run.
//
//   node scripts/audit-frontmatter-parse.mjs
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

const DIRS = [
  'src/content/posts',
  'src/content/i18n/ko', 'src/content/i18n/ja', 'src/content/i18n/es', 'src/content/i18n/zh',
  'src/content/itineraries', 'src/content/essentials', 'src/content/essentials-topics',
  'src/content/static-pages',
];

let parsed = 0;
const broken = [];
for (const dir of DIRS) {
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    parsed++;
    try {
      matter(readFileSync(join(dir, f), 'utf8'));
    } catch (e) {
      broken.push(`${dir}/${f} — ${String(e.message).split('\n')[0]}`);
    }
  }
}

// An empty run is a broken run, not a clean one (checker-must-not-pass-blind).
if (parsed === 0) {
  console.log('❌ no content files found — is src/content empty?');
  process.exit(1);
}
for (const b of broken) console.log(`FRONTMATTER UNPARSEABLE: ${b}`);
console.log(broken.length
  ? `\n❌ ${broken.length} file(s) whose frontmatter the pipeline cannot read.`
  : `\n✓ ${parsed} content file(s) — frontmatter parses with the pipeline's own parser.`);
process.exit(broken.length ? 1 : 0);
