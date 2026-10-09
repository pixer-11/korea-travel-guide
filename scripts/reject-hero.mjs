// Take a hero OFF a guide by hand, and make the refusal stick.
//
// 2026-10-09: three event heroes a person stripped at 02:05 (Jay Park's London
// date wearing ENHYPEN's Jay, the F-Forever tour wearing an Oasis concert, a
// tribute show wearing TAEMIN) were back by 09:00. The strip edited the
// frontmatter only; the verdict store still said MATCH for those photos, so the
// photo patrol saw three photoless guides, found the same files, and vision
// passed them again — it cannot tell one act from another. A refusal has to be
// written where the patrol looks before it spends a vision call
// (judgedWrong → data/visual-audit.json), not only in the post.
//
//   node scripts/reject-hero.mjs <slug>[,<slug>…] --reason="ENHYPEN's Jay, not Jay Park"
//
// The guide stays published (events publish photoless by policy; the card
// shows the brand plate). The patrol may fill it again — with another photo.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { readFrontmatter, editFrontmatter, DELETE } from './lib/frontmatter-edit.mjs';
import { recordHeroVerdict } from './lib/vision-check.mjs';

const slugs = (process.argv[2] || '').split(',').map((s) => s.trim()).filter(Boolean);
const reason = (process.argv.find((a) => a.startsWith('--reason=')) || '').slice(9) || 'rejected by hand';
if (!slugs.length) { console.log('usage: node scripts/reject-hero.mjs <slug>[,<slug>…] --reason="…"'); process.exit(1); }

const PROOF = 'data/performer-category-heroes.json';
const REVIEWED = 'data/event-hero-identity-reviewed.json';
const proof = existsSync(PROOF) ? JSON.parse(readFileSync(PROOF, 'utf8')) : {};
const reviewed = existsSync(REVIEWED) ? JSON.parse(readFileSync(REVIEWED, 'utf8')) : {};
let bad = 0;
for (const slug of slugs) {
  const path = `src/content/posts/${slug}.md`;
  if (!existsSync(path)) { console.log(`✗ ${slug}: no such guide`); bad++; continue; }
  const raw = readFileSync(path, 'utf8');
  const url = readFrontmatter(raw)?.heroImage?.url;
  if (!url) { console.log(`· ${slug}: no hero to reject`); continue; }
  await recordHeroVerdict(slug, url, 'MISMATCH', `hand-reviewed: ${reason}`.slice(0, 200));
  writeFileSync(path, editFrontmatter(raw, { heroImage: DELETE }));
  if (proof[slug]?.url === url) delete proof[slug];
  if (reviewed[slug] === url) delete reviewed[slug];
  console.log(`✓ ${slug}: hero removed and recorded as rejected — ${decodeURIComponent(url.split('/').pop())}`);
}
writeFileSync(PROOF, JSON.stringify(proof, null, 1) + '\n');
writeFileSync(REVIEWED, JSON.stringify(reviewed, null, 1) + '\n');
process.exit(bad ? 1 : 0);
