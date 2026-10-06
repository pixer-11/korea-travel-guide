#!/usr/bin/env node
// A post carrying `heldFinal: <why>` is a recorded decision that it stays
// unpublished (a twin of another guide, a venue we will not cover…). Nothing
// may publish it again — but a remote-first rebase can: on 2026-10-06 the
// photo patrol had checked out four posts before they were held as twins, and
// when its push rebased over the hold, its own `draft: false` survived beside
// the new heldFinal line. The 301 to the kept twin hid it from readers; a
// held post without a redirect would have gone live.
//
// So, like requarantine-mismatches does for photo holds, this re-derives the
// draft flag from the decision after every push that can merge bot edits.
//   node scripts/reassert-held-final.mjs          # fix and report
//   node scripts/reassert-held-final.mjs --check  # report only, exit 1 if any
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { editFrontmatter, readFrontmatter } from './lib/frontmatter-edit.mjs';

const DIR = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const CHECK = process.argv.includes('--check');

/** Slugs whose front matter records heldFinal but is not a draft. */
export function heldButPublished(dir = DIR) {
  const out = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const raw = readFileSync(join(dir, f), 'utf8');
    if (!/^heldFinal:/m.test(raw)) continue;
    const fm = readFrontmatter(raw);
    if (fm && String(fm.heldFinal ?? '').trim() && fm.draft !== true) out.push(f.replace(/\.md$/, ''));
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const bad = heldButPublished();
  if (!bad.length) { console.log('영구 보류 글은 전부 비공개 상태입니다.'); process.exit(0); }
  if (CHECK) {
    console.log(`HELD-FINAL-PUBLISHED: 영구 보류인데 공개 상태 ${bad.length}편 — ${bad.join(', ')}`);
    process.exit(1);
  }
  for (const slug of bad) {
    const p = join(DIR, `${slug}.md`);
    writeFileSync(p, editFrontmatter(readFileSync(p, 'utf8'), { draft: true }));
  }
  console.log(`영구 보류인데 공개 상태였던 ${bad.length}편을 다시 비공개로 되돌렸습니다: ${bad.join(', ')}`);
}
