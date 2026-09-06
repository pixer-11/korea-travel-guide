#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  AN ENDED EVENT THAT STILL READS AS UPCOMING — IN THE TRANSLATIONS
//
//  Every ended-event repair so far worked on the English. English lets a date
//  stand without a tense ("The dates are September 3 and 4"), so the English
//  passed every check while Korean, Japanese and Chinese — which must choose a
//  tense — had already chosen the present. On 2026-09-07, 45 of 77 finished
//  events still read as upcoming in Korean, on live pages, with the English
//  validator reporting zero problems.
//
//  This reads the translations, not the source.
//
//    node scripts/audit-ended-event-tense-i18n.mjs
//    node scripts/audit-ended-event-tense-i18n.mjs --list   # every hit, not a sample
// ─────────────────────────────────────────────────────────────
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const POSTS = 'src/content/posts';
const I18N = 'src/content/i18n';
const LANGS = ['ko', 'ja', 'es', 'zh'];
const LIST = process.argv.includes('--list');
const TODAY = new Date().toISOString().slice(0, 10);

// Verbs that put a finished event in the present or the future. Each is the
// ordinary way that language announces a scheduled event, which is exactly why
// they are wrong once it is over.
const UPCOMING = {
  ko: [/열립니다/g, /진행됩니다/g, /개최됩니다/g, /열릴 예정입니다/g],
  ja: [/開催されます/g, /行われます/g, /予定です/g],
  es: [/se celebrará/gi, /tendrá lugar/gi, /se llevará a cabo/gi],
  zh: [/将于/g, /将在/g, /即将/g],
};

// "Where can I eat before the show?" is not a tense error — the answer describes
// what was around the venue, and the question reads the same whether the show is
// tomorrow or last month. Flagging these put 39 of 138 findings on the list and
// sent the repair tool after pages that were not broken. Counted and shown, never
// failed on: an alarm that overstates is one nobody reads.
// No /g here on purpose: a global regex carries lastIndex between .test() calls
// and would start skipping matches after the first hit.
const BEFORE_THE_SHOW = {
  ko: [/공연 전에/, /입장 전에/],
  ja: [/公演前に/],
  es: [/antes del concierto/i],
  zh: [/演出前/],
};

const dayOf = (raw) => {
  if (!raw) return '';
  const s = String(raw);
  const m = /(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : '';
};

let ended = 0;
let soft = 0;
let heldBack = 0;
const hits = [];

for (const file of readdirSync(POSTS).filter((f) => f.endsWith('.md'))) {
  const src = readFileSync(join(POSTS, file), 'utf8');
  const end = dayOf(/^eventEndDate:.*$/m.exec(src)?.[0]);
  const start = dayOf(/^eventStartDate:.*$/m.exec(src)?.[0]);
  const day = end || start;
  if (!day || day >= TODAY) continue;
  // A quarantined post is not a published page. Counting its translations put 30
  // of 44 findings on pages no reader can reach, and sent the repair tool after
  // files translate-posts correctly refuses to touch (it skips drafts too).
  if (/^draft:\s*true\s*$/m.test(src)) { heldBack++; continue; }
  ended++;

  for (const lang of LANGS) {
    const p = join(I18N, lang, file);
    if (!existsSync(p)) continue;
    const whole = readFileSync(p, 'utf8');
    // Only the fields that state THIS event's schedule. Body prose is out of
    // scope on purpose: "the weigh-in is usually held the day before" is a
    // present-tense sentence about how the sport works, not a claim that this
    // card is upcoming, and flagging it sent the repair tool after correct text.
    const fmEnd = whole.indexOf('\n---', 3);
    const text = (fmEnd < 0 ? whole : whole.slice(0, fmEnd))
      // FAQ QUESTIONS stay in the present in all four languages — "どこで開催され
      // ますか?" is simply how you ask about a fact, finished or not. The ANSWER
      // is what has to be in the past, and that is what stays in scope.
      .split('\n').filter((l) => !/^\s*-?\s*q:/i.test(l)).join('\n');
    const found = UPCOMING[lang].flatMap((re) => text.match(re) ?? []);
    if (found.length) {
      hits.push({ lang, slug: file.replace(/\.md$/, ''), day, found: [...new Set(found)] });
    }
    if (BEFORE_THE_SHOW[lang].some((re) => re.test(text))) soft++;
  }
}

console.log(`${ended} finished, published event(s); ${hits.length} translation(s) still read as upcoming`);
if (heldBack) console.log(`(${heldBack} finished event(s) are quarantined drafts — not published, not counted)`);
if (soft) console.log(`(${soft} more say "before the show", which is not a tense error — not counted)`);
for (const h of (LIST ? hits : hits.slice(0, 15))) {
  console.log(`ENDED-EVENT-I18N-TENSE: ${h.lang}/${h.slug} — ended ${h.day}, still says ${h.found.slice(0, 3).map((f) => `"${f}"`).join(', ')}`);
}
if (!LIST && hits.length > 15) console.log(`… and ${hits.length - 15} more (--list for all)`);

if (hits.length) process.exit(1);
console.log('✓ every finished event reads as a record in all four languages.');
