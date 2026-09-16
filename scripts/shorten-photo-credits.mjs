// Sweep: collapse a photo credit that carries a licence paragraph back to a name.
//
// The generator writes short credits now (lib/commons.mjs → shortArtist), but
// 13 posts were written before that and render a photographer's whole usage
// request under the hero. This is the one-off repair for what is already on
// disk; it is safe to re-run and prints what it changed.
//
//   node scripts/shorten-photo-credits.mjs        (write)
//   DRY=1 node scripts/shorten-photo-credits.mjs  (report only)
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { editFrontmatter, readFrontmatter } from './lib/frontmatter-edit.mjs';
import { shortCredit } from './lib/photo-credit.mjs';

const DIR = 'src/content/posts';
const DRY = process.env.DRY === '1';
let changed = 0;

for (const f of readdirSync(DIR).filter((n) => n.endsWith('.md'))) {
  const raw = readFileSync(join(DIR, f), 'utf8');
  const data = readFrontmatter(raw);
  if (!data) continue;
  const changes = {};
  const hero = data.heroImage;
  if (hero?.credit && shortCredit(hero.credit) !== hero.credit) {
    changes.heroImage = { ...hero, credit: shortCredit(hero.credit) };
  }
  if (Array.isArray(data.gallery) && data.gallery.some((g) => g?.credit && shortCredit(g.credit) !== g.credit)) {
    changes.gallery = data.gallery.map((g) => (g?.credit ? { ...g, credit: shortCredit(g.credit) } : g));
  }
  if (!Object.keys(changes).length) continue;
  const heroNote = changes.heroImage ? `hero ${hero.credit.length} → ${changes.heroImage.credit.length}` : '';
  const galleryNote = changes.gallery ? ' gallery shortened' : '';
  console.log(`${f}: ${heroNote}${galleryNote}`.trim());
  changed++;
  if (!DRY) writeFileSync(join(DIR, f), editFrontmatter(raw, changes));
}

console.log(DRY ? `DRY — ${changed} post(s) would change` : `✓ ${changed} post(s) rewritten`);
