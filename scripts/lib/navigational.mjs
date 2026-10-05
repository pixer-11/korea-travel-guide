// Is a search query just the name of a place we wrote about?
//
// The weekly report lists queries that sit on Google's first page with no
// click and says "the title or snippet does not answer the query". On
// 2026-10-04 its top example was "vandal restaurant | elevated global street
// food" — the restaurant's Google Maps name, letter for letter, already the
// first words of our title. Someone typing a business's exact name wants its
// map pin, its Instagram or its booking page; a guide at #5 not being clicked
// is normal, and retitling it would only reopen the retitle experiment closed
// on 09-21. This marks those queries so the report stops prescribing it.
//
// The rule: the query contains the business's own name word — the first word
// of the place name that is neither an ordinary English word
// (data/common-words.json) nor a place name (any guide's region or country) —
// and every other word of the query is in that place name, its region, or
// ALSO_NAVIGATIONAL below ("reviews"...). So "vandal lombok" is the Vandal
// restaurant; "street food kata" (Hug Street Food, Kata) and "phuket" (Cafe
// Phuket Viewpoint) are topics — Codex caught both on 2026-10-05 under an
// earlier "any uncommon word" rule. Scripts without spaces (Chinese,
// Japanese) are not judged: never marked.

import { readdirSync, readFileSync } from 'node:fs';

// Words that still mean "take me to the business itself" after its name.
// Not "menu", "reservation", "price": a guide can answer those, and the closed
// retitle experiment found exactly such queries unanswered by our titles.
const ALSO_NAVIGATIONAL = new Set(['review', 'reviews', 'location', 'address', 'map', 'maps', 'instagram', 'website', 'contact']);

const words = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * Only businesses count (restaurant, trendy): a landmark's name typed into
 * Google ("wolmi theme park") is a question a guide answers, so those stay in
 * the actionable list. An entry without a category is treated as a business.
 * @param {{ place: string, region?: string, country?: string, category?: string }[]} places  one per guide
 * @param {Iterable<string>} common  ordinary words, lower case
 */
export function makeNavigationalTest(places, common) {
  const commonSet = new Set(common);
  const geo = new Set(places.flatMap((p) => [...words(p.region), ...words(p.country)]));
  const BUSINESS = new Set(['restaurant', 'trendy']);
  const entries = places
    .filter((p) => !p.category || BUSINESS.has(p.category))
    .map((p) => {
      const placeWords = words(p.place);
      return {
        all: new Set([...placeWords, ...words(p.region)]),
        brand: placeWords.find((w) => w.length >= 3 && !commonSet.has(w) && !geo.has(w)),
      };
    })
    .filter((e) => e.brand);
  return (query) => {
    const q = words(query);
    if (q.length === 0 || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(query)) return false;
    return entries.some((e) => q.includes(e.brand) && q.every((w) => e.all.has(w) || ALSO_NAVIGATIONAL.has(w)));
  };
}

/**
 * One entry per published guide in `dir`: the place its title leads with, and
 * its region. No YAML library — gsc-report.yml runs without `npm ci`.
 */
export function guidePlaces(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    try {
      const raw = readFileSync(`${dir}/${f}`, 'utf8').replace(/\r\n/g, '\n');
      const fm = raw.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
      if (/^draft:\s*true\s*$/m.test(fm)) continue;
      out.push({ place: placeOfTitle(frontmatterScalar(fm, 'title')), region: frontmatterScalar(fm, 'region'), country: frontmatterScalar(fm, 'country'), category: frontmatterScalar(fm, 'category') });
    } catch { /* one unreadable file must not cost the report */ }
  }
  return out;
}

/** The place name a guide's title leads with ("<Place>: Travel Guide"). */
export const placeOfTitle = (title) => String(title ?? '').split(/:\s/)[0].trim();

/**
 * One top-level string from a frontmatter block, without a YAML library (the
 * report's workflow installs nothing): plain, 'single' (with '' escapes),
 * "double", or a folded/literal block (>- , |) joined with spaces.
 */
export function frontmatterScalar(fm, key) {
  const lines = String(fm ?? '').split('\n');
  const i = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (i < 0) return '';
  const v = lines[i].slice(key.length + 1).trim();
  if (/^[>|][-+]?$/.test(v)) {
    const body = [];
    for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]); j++) body.push(lines[j].trim());
    return body.join(' ');
  }
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/\\"/g, '"');
  return v;
}
