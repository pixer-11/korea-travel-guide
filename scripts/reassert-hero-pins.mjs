#!/usr/bin/env node
// Put back every pinned hero a run changed or removed (see lib/hero-pins.mjs).
// Wired beside reassert-held-final in the workflows that write posts, for the
// same reason: a decision has to survive bot edits and remote-first rebases.
//   node scripts/reassert-hero-pins.mjs          # restore and report
//   node scripts/reassert-hero-pins.mjs --check  # report only, exit 1 if any drifted
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { editFrontmatter, readFrontmatter } from './lib/frontmatter-edit.mjs';
import { loadHeroPins, pinDrift } from './lib/hero-pins.mjs';

const DIR = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const CHECK = process.argv.includes('--check');

export function driftedPins(pins = loadHeroPins(), dir = DIR) {
  const out = [];
  for (const slug of Object.keys(pins)) {
    const path = join(dir, `${slug}.md`);
    if (!existsSync(path)) continue; // a retired guide takes its pin with it
    const fm = readFrontmatter(readFileSync(path, 'utf8'));
    if (pinDrift(pins, slug, fm?.heroImage?.url)) out.push({ slug, path, was: fm?.heroImage?.url || '(none)' });
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const pins = loadHeroPins();
  const drifted = driftedPins(pins);
  for (const d of drifted) {
    const p = pins[d.slug];
    console.log(`${CHECK ? '✗' : '↺'} ${d.slug}: pinned hero ${CHECK ? 'changed' : 'restored'} (was ${String(d.was).split('/').pop()})`);
    if (CHECK) continue;
    const hero = { url: p.url, credit: p.credit, license: p.license, source: p.source, ...(p.focus ? { focus: p.focus } : {}) };
    writeFileSync(d.path, editFrontmatter(readFileSync(d.path, 'utf8'), { heroImage: hero }));
  }
  console.log(`hero pins: ${Object.keys(pins).length} pinned, ${drifted.length} ${CHECK ? 'drifted' : 'restored'}`);
  if (CHECK && drifted.length) process.exit(1);
}
