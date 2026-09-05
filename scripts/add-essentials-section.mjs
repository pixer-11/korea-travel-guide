#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  ADD ONE SECTION TO EVERY COUNTRY ESSENTIALS GUIDE
//
//  build-essentials.mjs researches a whole guide and rewrites the file. That is
//  the wrong tool for adding a topic to guides whose other sections have been
//  reviewed, so this script researches ONE section and swaps only that.
//
//  Every section ends with official links, and a section whose links do not
//  answer is discarded rather than published — an unverifiable left-luggage
//  price is exactly the class of invented detail the 2026-09 repairs removed.
//
//    node scripts/add-essentials-section.mjs                    # all active countries
//    COUNTRY=Japan node scripts/add-essentials-section.mjs      # one
//    DRY=1 COUNTRY=Japan node scripts/add-essentials-section.mjs
//    SECTION=luggage-storage FORCE=1 node scripts/add-essentials-section.mjs
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { HOUSE_STYLE } from './lib/prose-style.mjs';
import { upsertSection, findSection, stampSectionReviewed } from './lib/essentials-section.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIR = join(ROOT, 'src', 'content', 'essentials');
const COUNTRIES_FILE = join(ROOT, 'data', 'countries.json');
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.WRITER_MODEL || 'claude-sonnet-5';
const DRY = process.env.DRY === '1';
const FORCE = process.env.FORCE === '1';
const SECTION = process.env.SECTION || 'luggage-storage';
const UA = 'Mozilla/5.0 (compatible; WanderAtlasBot/1.0; +https://wanderatlasguides.com)';

// One entry per topic. The next topics (dietary needs, travelling with kids)
// are added here, not by copying this script.
const SECTIONS = {
  'luggage-storage': {
    heading: 'Luggage storage',
    brief: (country) =>
      `Where a traveller in ${country} can leave bags for a few hours or a few days. Cover only what applies there: ` +
      `station coin lockers (which stations, what sizes, how you pay), staffed left-luggage offices, app-based bag drops ` +
      `in shops (name the network only if it operates in ${country}), airport baggage counters, and whether hotels hold bags.`,
  },
};

async function research(country, spec) {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
    messages: [{
      role: 'user',
      content:
        `Write ONE section of a travel guide for international visitors to ${country}, current as of ${new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })}. ` +
        `Use web search to confirm what is actually available there.\n\n` +
        `Subject: ${spec.brief(country)}\n\n` +
        `Rules:\n` +
        `- 120–200 words of GitHub-flavored Markdown. NO heading line — the section heading is added for you.\n` +
        `- Prices as a RANGE with the currency ("about ¥400–800 a day"), never a single exact figure, and only when a source states it.\n` +
        `- Name an operator or network ONLY if your source shows it serves ${country}.\n` +
        `- End with a line "Sources:" followed by 1–3 markdown links to official operator, airport or government pages. ` +
        `Not blogs, not aggregators, not affiliate sites.\n` +
        `- If you cannot verify how this works in ${country}, reply with exactly: INSUFFICIENT\n` +
        `- No preamble. Output only the section text.\n` +
        HOUSE_STYLE,
    }],
  });
  if (msg.stop_reason === 'max_tokens') throw new Error('cut off mid-sentence');
  let text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  text = text.replace(/^```(markdown)?\n/i, '').replace(/\n```\s*$/i, '').trim();
  // A web-search run interleaves the model's working notes between tool calls
  // ("Let me search for..."). The section proper starts at the first line that
  // is not one of those; drop anything before a line ending in a full stop that
  // reads as prose is unreliable, so instead cut at the first paragraph that
  // survives the checks below — simplest reliable rule: drop leading lines that
  // start with "Let me", "I'll", "Now ", "Based on".
  text = text.replace(/^(?:(?:Let me|I'll|I will|Now|Based on|Searching)[^\n]*\n+)+/i, '').trim();
  return text;
}

function linksIn(md) {
  return [...md.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]);
}

async function linkAlive(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    return res.ok;
  } catch { return false; }
}

async function main() {
  const spec = SECTIONS[SECTION];
  if (!spec) throw new Error(`unknown SECTION "${SECTION}" — known: ${Object.keys(SECTIONS).join(', ')}`);
  const { countries } = JSON.parse(await readFile(COUNTRIES_FILE, 'utf8'));
  const only = process.env.COUNTRY;
  const active = countries.filter((c) => c.active && (!only || c.name === only));
  const today = new Date().toISOString().slice(0, 10);

  console.log(`\n🧳  ${spec.heading} — ${active.length} countr${active.length === 1 ? 'y' : 'ies'}${DRY ? ' (DRY)' : ''}\n`);
  let written = 0, skipped = 0, refused = 0;

  for (const c of active) {
    const file = join(DIR, `${c.slug}.md`);
    if (!existsSync(file)) { console.log(`  ⏭️   ${c.name} — no guide yet`); skipped++; continue; }
    const md = await readFile(file, 'utf8');
    if (!FORCE && findSection(md, spec.heading)) { console.log(`  ⏭️   ${c.name} — already has the section`); skipped++; continue; }

    let text;
    try { text = await research(c.name, spec); }
    catch (e) { console.log(`  ❌  ${c.name} — ${e.message}`); refused++; continue; }

    if (/^INSUFFICIENT$/im.test(text)) { console.log(`  ✋  ${c.name} — nothing verifiable, skipped`); refused++; continue; }

    const urls = linksIn(text);
    if (!urls.length) { console.log(`  ✋  ${c.name} — no sources, skipped`); refused++; continue; }
    const alive = [];
    for (const u of urls) if (await linkAlive(u)) alive.push(u);
    if (!alive.length) { console.log(`  ✋  ${c.name} — every source link failed, skipped`); refused++; continue; }
    if (alive.length < urls.length) {
      for (const dead of urls.filter((u) => !alive.includes(u))) {
        text = text.split('\n').filter((line) => !line.includes(dead)).join('\n');
      }
    }

    if (DRY) { console.log(`  📄  ${c.name}\n${text.replace(/^/gm, '      ')}\n`); written++; continue; }
    const next = stampSectionReviewed(upsertSection(md, { heading: spec.heading, body: text }), SECTION, today);
    await writeFile(file, next, 'utf8');
    console.log(`  ✓   ${c.name} — ${text.split(/\s+/).length} words, ${alive.length} source${alive.length === 1 ? '' : 's'}`);
    written++;
  }
  console.log(`\nSECTION_SUMMARY section=${SECTION} written=${written} skipped=${skipped} refused=${refused}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
