#!/usr/bin/env node
// One-off content-audit fixes on existing posts (line-level edits only — leaves
// the rest of each file's frontmatter untouched, CRLF-safe):
//   1) Title: "…: A Visitor's Where to Eat in {city}" → "…: Where to Eat in {city}"
//   2) Title: strip marketing suffixes ("- Michelin Selected 2025-2026")
//   3) description: regenerate from quickAnswer (unique, real meta description)
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'content', 'posts');
const yq = (s) => JSON.stringify(s); // valid YAML double-quoted scalar

const getScalar = (src, key) => {
  const m = src.match(new RegExp(`^${key}:[ \\t]*([^\\r\\n]*)`, 'm'));
  if (!m) return null;
  let v = m[1].trim();
  if (v === '' || v === '>' || v === '|' || v.startsWith('>') || v.startsWith('|')) return null; // block/empty
  if ((v.startsWith('"') && v.endsWith('"'))) v = JSON.parse(v);
  else if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1).replace(/''/g, "'");
  return v;
};
const setScalar = (src, key, value) =>
  src.replace(new RegExp(`^(${key}:)[^\\r\\n]*`, 'm'), `$1 ${yq(value)}`);

const clip = (s, n = 158) => { s = s.replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };

let titleFix = 0, descFix = 0;
for (const f of (await readdir(DIR)).filter((x) => x.endsWith('.md'))) {
  const path = join(DIR, f);
  let src = await readFile(path, 'utf8');
  const before = src;

  // 1+2) Title cleanups
  let title = getScalar(src, 'title');
  if (title) {
    let t = title
      .replace(/A Visitor's Where to Eat in /, 'Where to Eat in ')
      .replace(/\s*[-–—]\s*Michelin[^"']*$/i, '')
      .trim();
    if (t !== title) { src = setScalar(src, 'title', t); titleFix++; }
  }

  // 3) description from quickAnswer
  const qa = getScalar(src, 'quickAnswer');
  if (qa) {
    const desc = clip(qa);
    const curDesc = getScalar(src, 'description');
    if (curDesc !== desc) { src = setScalar(src, 'description', desc); descFix++; }
  }

  if (src !== before) await writeFile(path, src, 'utf8');
}
console.log(`Titles fixed: ${titleFix}, descriptions regenerated: ${descFix}`);
