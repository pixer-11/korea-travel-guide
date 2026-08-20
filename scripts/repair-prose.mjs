#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  PROSE REPAIR — acts on what the weekly content audit finds.
//
//  full-content-audit.mjs has been reading every post with a vision-and-prose
//  model since July and writing its findings to data/full-audit.json. Nothing
//  read the prose half. On 2026-08-05 that file held 99 posts with 122 findings,
//  88 of them `invented-specifics` — menu items, prices and street scenes the
//  writer had no source for — and every one was live. The audit workflow's own
//  header says "READ-ONLY (no fixes)", and the Telegram message sent a count.
//
//  So the count is now a work queue. Each finding quotes the exact span it
//  objects to; this asks the model to repair THAT span and nothing else, under
//  closed-world rules: it may delete an unverifiable claim, it may generalise it,
//  it may never invent a replacement fact. Facts that come from Google Places
//  (hours, rating, address, phone) live in the frontmatter and are not touched.
//
//   DRY=1 node scripts/repair-prose.mjs           # show the rewrites
//   node scripts/repair-prose.mjs --limit 5       # repair a few
//   node scripts/repair-prose.mjs                 # repair everything queued
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import yaml from 'js-yaml';

const POSTS = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const AUDIT = fileURLToPath(new URL('../data/full-audit.json', import.meta.url));
const DRY = process.env.DRY === '1';
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i > -1 ? Number(process.argv[i + 1]) : Infinity;
})();
const MODEL = 'claude-sonnet-5';

if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY missing'); process.exit(1); }
const client = new Anthropic();

// What each finding type means, in the model's terms. Kept explicit so a repair
// cannot drift into "rewrite the article".
const RULES = {
  'invented-specifics':
    'This span states something the writer could not have verified — a menu item, a price, a named dish, a street scene, a claim about what vendors sell. Remove the unverifiable detail. You may keep a general, honestly-hedged version ("regional Aragonese cooking") if the sentence needs one, but you may NOT substitute a different specific.',
  'symbol-in-prose':
    'This span leaks an internal data value into reader-facing text (a "$$" price level, "price level 2"). Rewrite it as plain language a reader would use, or drop it.',
  'broken-markdown':
    'This span has markdown that will not render where it sits (bold inside a link, stray asterisks, nesting the file cannot express). Fix the markup so it renders, changing no words.',
  'foreign-fragment':
    'This span leaves an untranslated fragment (a floor number, a local-script street address) inside English prose. Either render it in English or remove it — the full address already lives in the fact box.',
  'other-glaring':
    'This span contains an obvious writing error — broken grammar, a contradiction, a nonsense claim. Fix it minimally.',
};

async function repair(body, findings, title) {
  const list = findings.map((f, i) =>
    `${i + 1}. [${f.type}] quoted span: "${f.quote}"\n   ${RULES[f.type] || 'Fix this span.'}`).join('\n');
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    messages: [{
      role: 'user',
      content: `Below is the markdown body of a published travel guide, "${title}". An editorial audit flagged the spans listed underneath.

Repair ONLY those spans. Rules:
- Change nothing else. Every other sentence must come back byte-identical.
- Never invent a replacement fact. If a detail cannot be verified, remove it or generalise it honestly.
- Do not add hedging boilerplate ("it is said that", "reportedly") — just don't make the claim.
- Keep the voice and length; do not summarise the article.
- Keep all markdown structure (headings, lists, links) intact.

Findings:
${list}

Reply with ONLY the full repaired markdown body. No preamble, no code fence.

---
${body}`,
    }],
  });
  return (msg.content.find((c) => c.type === 'text')?.text || '').trim();
}

const audit = JSON.parse(await readFile(AUDIT, 'utf8'));
const rows = (Array.isArray(audit) ? audit : audit.results || Object.values(audit))
  .filter((r) => Array.isArray(r.prose) && r.prose.length && r.slug);

let done = 0, skipped = 0, failed = 0;
for (const row of rows) {
  if (done >= LIMIT) break;
  const path = join(POSTS, `${row.slug}.md`);
  if (!existsSync(path)) { skipped++; continue; }
  const raw = await readFile(path, 'utf8');
  const cut = raw.indexOf('\n---', 3);
  let fm; try { fm = yaml.load(raw.slice(4, cut)); } catch { skipped++; continue; }
  const body = raw.slice(cut + 4);

  // Only act on findings whose quoted span is still present — the post may have
  // been rewritten since the audit ran.
  let live = row.prose.filter((f) => f.quote && body.includes(f.quote));
  // An "invented" hours/price finding whose numbers all appear in the venue's
  // own record is the auditor disagreeing with live data, not a defect — the
  // writer was instructed to state those (writer.mjs). Repairing them hedges
  // facts and re-queues four translations per post (222 of 241 on 08-15).
  // Deterministic: every clock token in the quote must appear in openingHours.
  const hoursStr = Array.isArray(fm.place?.openingHours) ? fm.place.openingHours.join(' ').toLowerCase() : '';
  if (hoursStr) {
    live = live.filter((f) => {
      if (f.type !== 'invented-specifics') return true;
      const clocks = String(f.quote).toLowerCase().match(/\d{1,2}(?::\d{2})?\s*(?:am|pm)/g) || [];
      if (!clocks.length) return true;
      const verified = clocks.every((c) => hoursStr.includes(c.replace(/\s+/g, ' ').trim()) || hoursStr.includes(c.replace(/\s*(am|pm)/, ' $1')));
      if (verified) console.log(`   ✓ verified-hours, not repaired: « ${String(f.quote).slice(0, 70)} »`);
      return !verified;
    });
  }
  if (!live.length) { skipped++; continue; }

  console.log(`\n📝 ${row.slug} — ${live.map((f) => f.type).join(', ')}`);
  for (const f of live) console.log(`   « ${String(f.quote).slice(0, 90)} »`);

  let out;
  try { out = await repair(body.trim(), live, fm.title); }
  catch (e) { console.log(`   ⚠️  model error — left alone (${String(e.message).slice(0, 60)})`); failed++; continue; }

  // Guards: a repair that deletes the article, or that still contains the exact
  // span it was asked to fix, is not a repair.
  if (!out || out.length < body.trim().length * 0.6) {
    console.log('   ⚠️  rewrite came back too short — left alone'); failed++; continue;
  }
  const stillThere = live.filter((f) => out.includes(f.quote));
  if (stillThere.length === live.length) {
    console.log('   ⚠️  every flagged span survived unchanged — left alone'); failed++; continue;
  }
  if (stillThere.length) console.log(`   ⚠️  ${stillThere.length} of ${live.length} span(s) unchanged`);

  if (DRY) { done++; continue; }
  // Keep the frontmatter BYTE-IDENTICAL. Re-dumping it through js-yaml rewrites
  // the whole block — it stripped the quotes off every hero URL on the first run
  // here — and this script has no business touching structured data it did not
  // change. Only the body was repaired, so only the body is replaced.
  const head = raw.slice(0, cut + 4);
  await writeFile(path, `${head}\n${out}\n`, 'utf8');
  console.log('   ✓ repaired');
  done++;
}

console.log(`\n📦 prose repair — repaired ${done} · skipped ${skipped} · failed ${failed}${DRY ? ' (DRY)' : ''}`);
console.log(`PROSE_REPAIR_SUMMARY repaired=${done} skipped=${skipped} failed=${failed}`);
