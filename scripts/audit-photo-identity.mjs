#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  PHOTO IDENTITY AUDIT — does this photo's own metadata place it somewhere
//  other than the post claims?
//
//  Written because the AI vision gate answers a different question than the one
//  that matters. It judges whether an image LOOKS like the right kind of place,
//  and then records a verdict as if it had judged WHICH place. Its own stored
//  results: los-angeles-eggslut MATCH "Eggslut storefront, branding visible"
//  (the Singapore branch); palawan-secret-lagoon MATCH "Palawan setting"
//  (Batanes, 1,000km away); daegu-trendy-cafe MATCH "Modern café interior"
//  (Mumbai). No model looking at a photograph of a café can tell you which café
//  it is. The uploader can, and did — it is in the Commons record.
//
//  Deterministic and therefore able to REJECT. Reports three verdicts and never
//  invents a fourth: contradicts / supports / unknown. "unknown" is the correct
//  answer for a photo Commons says nothing useful about, and the failure being
//  corrected here is precisely a checker that turned "cannot tell" into "fine".
//
//  Usage:
//    node scripts/audit-photo-identity.mjs            # report
//    node scripts/audit-photo-identity.mjs --strip    # remove contradicted heroes
//    node scripts/audit-photo-identity.mjs --json     # machine-readable
// ─────────────────────────────────────────────────────────────
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';
import { commonsTitle, fetchCommonsMeta, judgeIdentity, judgeFoursquareCredit } from './lib/commons-identity.mjs';

const POSTS = 'src/content/posts';
const STRIP = process.argv.includes('--strip');
const JSON_OUT = process.argv.includes('--json');
const ONLY = (process.env.SLUGS || '').split(',').map((s) => s.trim()).filter(Boolean);

const countriesData = JSON.parse(await readFile('data/countries.json', 'utf8'));
// regionCountry: which country each region belongs to — null when the same
// name appears in more than one country, which makes it useless as evidence.
const regionCountry = new Map();
for (const c of countriesData.countries) {
  for (const r of c.regions ?? []) {
    regionCountry.set(r, regionCountry.has(r) && regionCountry.get(r) !== c.name ? null : c.name);
  }
}
const world = {
  countries: countriesData.countries.map((c) => c.name),
  regions: [...regionCountry.keys()],
  regionCountry,
};

// Every live post's hero and gallery images, keyed by the Commons file they use.
const files = (await readdir(POSTS)).filter((f) => f.endsWith('.md'));
const targets = [];    // Commons images, judged against the post's place
const foursquare = []; // Foursquare images, judged against the credit line
const stock = [];      // Unsplash — a rule violation whatever it shows
for (const f of files) {
  const slug = f.replace(/\.md$/, '');
  if (ONLY.length && !ONLY.includes(slug)) continue;
  let d;
  try { d = matter(await readFile(join(POSTS, f), 'utf8')).data; } catch { continue; }
  if (d.draft === true) continue; // quarantined posts show nobody anything
  // EVENTS are judged on a different question and are excluded from the place
  // test. A photograph of BTS taken in Los Angeles is a legitimate hero for a
  // BTS concert in Foxborough — the subject is the act, not the venue. Judging
  // those by location produces confident nonsense, which is the exact failure
  // this file exists to stop. What events actually need is a performer-name
  // check (jakarta-lalala-festival wears a photo of the French band "Lalala
  // Napoli"; hanoi Miss World wears Miss World IRELAND), and that is a separate
  // audit rather than a wrong answer from this one.
  const isEvent = d.category === 'event';
  const claim = { country: d.country ?? 'South Korea', region: d.region ?? '' };
  const venueName = d.place?.name || String(d.title ?? '').split(/[:—]/)[0].trim();
  const add = (kind, url, credit) => {
    if (!url) return;
    // Stock is a rule violation regardless of what it depicts, and these do not
    // stay on the post: they are self-hosted into /wall/ and promoted to city
    // tiles and og:images, which is how the Wuhan tile became a photograph of a
    // billiards table.
    if (/images\.unsplash\.com/.test(url)) { stock.push({ slug, kind, url }); return; }
    if (/4sqi\.net/.test(url)) { foursquare.push({ slug, kind, url, credit, venueName }); return; }
    const title = commonsTitle(url);
    if (title) targets.push({ slug, kind, url, title, claim, isEvent });
  };
  add('hero', d.heroImage?.url, d.heroImage?.credit);
  for (const g of d.gallery ?? []) add('gallery', g?.url, g?.credit);
}

if (!JSON_OUT) console.log(`${targets.length} Commons image(s) on live posts — asking Commons what they are…`);
const meta = await fetchCommonsMeta(targets.map((t) => t.title));

const contradicts = [];
const nearby = [];
const supports = [];
const unknown = [];
const events = [];
for (const t of targets) {
  if (t.isEvent) { events.push(t); continue; }
  const verdict = judgeIdentity(meta.get(t.title), t.claim, world);
  const row = { ...t, ...verdict };
  const bucket = { contradicts, nearby, supports }[verdict.verdict] ?? unknown;
  bucket.push(row);
}

// Foursquare stores the venue the photographer was standing in, right there in
// the credit. Judged for events too — unlike a place photo, a credit naming a
// different business is wrong no matter what the post is about.
const fsqBad = [];
for (const p of foursquare) {
  const v = judgeFoursquareCredit(p.credit, p.venueName);
  if (v.verdict === 'contradicts') fsqBad.push({ ...p, ...v });
}

// Only what can be removed WITHOUT a judgement call. Commons contradictions are
// decided by a named country, and stock is a rule violation whatever it depicts
// — neither needs a person. Foursquare credit mismatches are reported and never
// stripped: venues are credited by nickname, translation and misspelling
// ("flower city square" for Huacheng Square, "Australian Cafe & Bar Manly" for
// Manly), and the cost of getting one wrong is deleting a correct photo.
const removable = [
  ...contradicts,
  ...stock.map((s) => ({ ...s, why: 'stock photography — the project forbids it on venue and event posts' })),
];

if (JSON_OUT) {
  console.log(JSON.stringify({ contradicts, fsqBad, stock, nearby, unknownCount: unknown.length, supportsCount: supports.length, eventsSkipped: events.length }, null, 2));
} else {
  console.log(`\n🔴 wrong place: ${contradicts.length}   🏷️  wrong venue credited: ${fsqBad.length}   📷 stock: ${stock.length}`);
  console.log(`🟡 needs a human: ${nearby.length}   ✅ confirmed: ${supports.length}   ❔ unknown: ${unknown.length}   ⏭️  events skipped: ${events.length}\n`);
  for (const c of contradicts) {
    console.log(`  🔴 ${c.slug}  [${c.kind}]`);
    console.log(`     ${c.why}`);
    console.log(`     ${c.title}`);
  }
  for (const c of fsqBad) console.log(`  🏷️  ${c.slug}  [${c.kind}]  ${c.why}`);
  for (const s of stock) console.log(`  📷 ${s.slug}  [${s.kind}]  stock`);
  if (nearby.length) {
    console.log('\n  — same country, cannot decide from a flat region list (review by hand) —');
    for (const n of nearby) console.log(`  🟡 ${n.slug}: ${n.why}`);
  }
}

if (STRIP && removable.length) {
  // Strips the WRONG photo and leaves the post published. Deleting the post was
  // the old answer and it cost 40% of the site's traffic on 2026-07-26; a guide
  // with no photo still answers its question. The patrol keeps looking and
  // attaches a real one when it finds it.
  const byslug = new Map();
  for (const c of removable) (byslug.get(c.slug) ?? byslug.set(c.slug, []).get(c.slug)).push(c);
  for (const [slug, rows] of byslug) {
    const p = join(POSTS, `${slug}.md`);
    const parsed = matter(await readFile(p, 'utf8'));
    const heroBad = rows.some((r) => r.kind === 'hero');
    const badUrls = new Set(rows.filter((r) => r.kind === 'gallery').map((r) => r.url));
    if (heroBad) { delete parsed.data.heroImage; parsed.data.photoless = true; }
    if (badUrls.size) parsed.data.gallery = (parsed.data.gallery ?? []).filter((g) => !badUrls.has(g?.url));
    await writeFile(p, matter.stringify(parsed.content, parsed.data), 'utf8');
    console.log(`  ✂️  ${slug}: removed ${heroBad ? 'hero' : ''}${heroBad && badUrls.size ? ' + ' : ''}${badUrls.size ? `${badUrls.size} gallery` : ''}`);
  }
}

console.log(`\nIDENTITY_SUMMARY commons=${targets.length} foursquare=${foursquare.length} wrongplace=${contradicts.length} wrongvenue=${fsqBad.length} stock=${stock.length} confirmed=${supports.length} unknown=${unknown.length} review=${nearby.length}`);
