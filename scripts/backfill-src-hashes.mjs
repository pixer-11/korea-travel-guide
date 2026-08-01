// One-off backfill for srcHash tracking (2026-08-01): stamp every EXISTING
// translation in src/content/i18n with the fingerprint of its English source's
// translatable fields, so translate-posts.mjs's staleness check has a baseline.
// Files stamped here are declared "current" — the truncated descriptions that
// motivated the whole mechanism were repaired deterministically the same day
// (rebuilt from each translation's own quickAnswer), so the declaration holds.
// Safe to re-run: files that already carry a srcHash are left untouched.
//
//   node scripts/backfill-src-hashes.mjs
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { srcHashOf, storedHashIn } from './lib/src-hash.mjs';

const POSTS = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const OUT = fileURLToPath(new URL('../src/content/i18n/', import.meta.url));
const LANGS = ['ko', 'ja', 'es', 'zh'];

// Same construction as translate-posts.mjs, or the hashes won't line up.
const hashes = new Map();
for (const f of (await readdir(POSTS)).filter((f) => f.endsWith('.md'))) {
  const raw = (await readFile(join(POSTS, f), 'utf8')).replace(/\r\n/g, '\n');
  const end = raw.indexOf('\n---', 3);
  let fm;
  try { fm = yaml.load(raw.slice(4, end)); } catch { continue; }
  if (!fm) continue;
  const body = raw.slice(end + 4).trim();
  hashes.set(f.replace(/\.md$/, ''), srcHashOf({
    title: fm.title, description: fm.description, quickAnswer: fm.quickAnswer, faq: fm.faq, body,
  }));
}

let stamped = 0, had = 0, orphan = 0;
for (const lang of LANGS) {
  for (const f of (await readdir(join(OUT, lang))).filter((f) => f.endsWith('.md'))) {
    const id = f.replace(/\.md$/, '');
    const path = join(OUT, lang, f);
    const raw = await readFile(path, 'utf8');
    if (storedHashIn(raw)) { had++; continue; }
    const hash = hashes.get(id);
    if (!hash) { orphan++; console.log(`  ⚠️ no English source for ${lang}/${f} — skipped`); continue; }
    // Always quoted: a hash like "818631094e44" is valid scientific notation,
    // so unquoted it YAML-parses as a NUMBER and fails the z.string() schema
    // (broke the build for 12 of 2,457 files on the first run of this script).
    const out = raw.replace(/^(slug:[^\r\n]*\r?\n)/m, `$1srcHash: '${hash}'\n`);
    if (!storedHashIn(out)) { console.log(`  ⚠️ could not stamp ${lang}/${f} (no slug: line?)`); continue; }
    await writeFile(path, out, 'utf8');
    stamped++;
  }
}
console.log(`srcHash backfill: ${stamped} stamped, ${had} already had one, ${orphan} orphan(s).`);
