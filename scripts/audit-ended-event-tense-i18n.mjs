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
import { UPCOMING } from './lib/ended-event-tense.mjs';

const POSTS = 'src/content/posts';
const I18N = 'src/content/i18n';
const LANGS = ['ko', 'ja', 'es', 'zh'];
const LIST = process.argv.includes('--list');
const TODAY = new Date().toISOString().slice(0, 10);

// The verb lists live in lib so the test can reach them without re-running
// this script (importing a scripts/*.mjs executes it).


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

// A date written out, in each language. This is the gate on reading body prose
// at all: only a sentence that names a date is making a claim about this
// occasion rather than about how the event usually works.
const DATED = {
  ko: /\d+월\s*\d+일/,
  ja: /\d+月\d+日/,
  zh: /\d+月\d+日|\d{4}年/,
  es: /\d+\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/i,
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
let absent = 0;
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
    // A language with no file has no tense to be wrong, so this is not a tense
    // failure — translate-posts fills gaps on every run and there are none today
    // (measured 2026-09-07: 0 across 1,408 published posts × 4 languages). But
    // "skipped it" and "checked it" must not look the same in the output, or a
    // day when the translator stops would read as a clean bill of health.
    if (!existsSync(p)) { absent++; continue; }
    const whole = readFileSync(p, 'utf8');
    // `text` is the frontmatter — the fields that state THIS event's schedule.
    // The body is read separately and under a stricter rule; see below.
    const fmEnd = whole.indexOf('\n---', 3);
    const body = fmEnd < 0 ? '' : whole.slice(fmEnd + 4);
    const text = (fmEnd < 0 ? whole : whole.slice(0, fmEnd))
      // FAQ QUESTIONS stay in the present in all four languages — "どこで開催され
      // ますか?" is simply how you ask about a fact, finished or not. The ANSWER
      // is what has to be in the past, and that is what stays in scope.
      //
      // A question can also be a YAML block scalar:
      //     - q: >-
      //         どこで開催されますか
      // Dropping only the line that carries `q:` left the text behind and
      // reported it as a tense error, sending the repair tool after content
      // that was correct. Drop the whole block: the q: line and everything
      // indented under it.
      // Only the block scalar's own CONTINUATION lines are dropped. Skipping
      // everything indented under the q: took the ANSWER with it — `a: Se
      // celebrará en Madrid.` sits deeper than its `- q:` and vanished, and since
      // nothing reset the state, every answer in the file went with it. The
      // answer is the half that must be in the past tense, so that turned this
      // audit into one that reads questions and ignores answers.
      //
      // A continuation line is plain text; a sibling key is `a:`, `title:` and
      // the like. Our keys are ASCII, and translated prose is not, so the key
      // pattern cannot match the Korean, Japanese or Chinese text it carries.
      .split('\n').reduce((keep, line) => {
        const indent = /^(\s*)/.exec(line)[1].length;
        const isKey = /^\s*-?\s*[A-Za-z_][\w-]*:(\s|$)/.test(line);
        if (/^\s*-?\s*q:/i.test(line)) { keep.skipUnder = indent; return keep; }
        if (keep.skipUnder !== null) {
          if (line.trim() === '') return keep;
          if (indent > keep.skipUnder && !isKey) return keep;
          keep.skipUnder = null;
        }
        keep.out.push(line);
        return keep;
      }, { out: [], skipUnder: null }).out.join('\n');
    const found = UPCOMING[lang].flatMap((re) => text.match(re) ?? []);

    // The body was excluded wholesale, and that hid a real one: the Chinese
    // Foxborough page said the band 将于8月15日至16日 play Arlington — a date three
    // weeks past — while the English source had already been put in the past
    // tense ("was booked into"). Reading only the frontmatter called it clean.
    //
    // Excluding the body was not wrong, it was too blunt. What produced the 39
    // false alarms was undated generality: "the weigh-in is usually held the day
    // before" is present tense about how the sport works, not about this card. A
    // future-tense verb in a sentence that NAMES A DATE is a claim about a
    // specific occasion, and on a finished event that claim is stale. Measured
    // across all 64 finished events: one hit, zero false alarms.
    const bodyFound = [];
    for (const sentence of body.split(/(?<=[。．.!?！？\n])/)) {
      if (!DATED[lang].test(sentence)) continue;
      bodyFound.push(...UPCOMING[lang].flatMap((re) => sentence.match(re) ?? []));
    }

    const all = [...found, ...bodyFound];
    if (all.length) {
      hits.push({ lang, slug: file.replace(/\.md$/, ''), day, found: [...new Set(all)] });
    }
    if (BEFORE_THE_SHOW[lang].some((re) => re.test(text))) soft++;
  }
}

console.log(`${ended} finished, published event(s); ${hits.length} translation(s) still read as upcoming`);
if (heldBack) console.log(`(${heldBack} finished event(s) are quarantined drafts — not published, not counted)`);
if (soft) console.log(`(${soft} more say "before the show", which is not a tense error — not counted)`);
if (absent) console.log(`(${absent} language file(s) do not exist yet — nothing to read, so nothing was checked there)`);
for (const h of (LIST ? hits : hits.slice(0, 15))) {
  console.log(`ENDED-EVENT-I18N-TENSE: ${h.lang}/${h.slug} — ended ${h.day}, still says ${h.found.slice(0, 3).map((f) => `"${f}"`).join(', ')}`);
}
if (!LIST && hits.length > 15) console.log(`… and ${hits.length - 15} more (--list for all)`);

// Recognising zero finished events means the date fields or the content path
// changed, not that the site has no history. An audit that examined nothing
// must never report calm.
if (!ended) {
  console.log('ENDED-EVENT-I18N-TENSE: no finished published event was recognised at all — the date fields or the content path must have changed. Nothing was audited.');
  process.exit(1);
}
if (hits.length) process.exit(1);
console.log('✓ every finished event reads as a record in all four languages.');
