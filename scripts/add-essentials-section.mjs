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
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { HOUSE_STYLE } from './lib/prose-style.mjs';
import { upsertSection, findSection, stampSectionReviewed } from './lib/essentials-section.mjs';
import { metaTextIn, unsupportedNumbers, numbersIn } from './lib/section-guards.mjs';

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
const FETCH_TIMEOUT_MS = 15_000;
const LOG_FILE = join(ROOT, 'data', 'logs', `essentials-section-${SECTION}.jsonl`);

async function logRun(entry) {
  await mkdir(dirname(LOG_FILE), { recursive: true });
  await appendFile(LOG_FILE, `${JSON.stringify({ ts: new Date().toISOString(), section: SECTION, ...entry })}\n`, 'utf8');
}

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
  return text;
}

function linksIn(md) {
  return [...md.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]);
}

// A web-search run interleaves the model's working notes between tool calls
// ("Let me search for...", "I have enough verified information now..."). One
// such line leaked straight into a published file (commit f48b2afd) because
// the old strip regex only matched a fixed prefix of sentence-starters
// anchored to the top of the text. A draft that talks to itself mid-paragraph
// is a draft that was not finished, so it is refused rather than patched —
// see scripts/lib/section-guards.mjs.
function refusedForMetaText(text) {
  return metaTextIn(text);
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** GET the URL once, timing out at 15s (one slow host must not stall the whole run).
 *  Returns { ok, text } — text is '' on any failure, including a timeout. */
async function fetchSource(url) {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return { ok: false, text: '' };
    return { ok: true, text: await res.text() };
  } catch {
    return { ok: false, text: '' };
  }
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
    if (!existsSync(file)) {
      console.log(`  ⏭️   ${c.name} — no guide yet`); skipped++;
      await logRun({ slug: c.slug, status: 'skipped', reason: 'no guide yet' });
      continue;
    }
    const md = await readFile(file, 'utf8');
    if (!FORCE && findSection(md, spec.heading)) {
      console.log(`  ⏭️   ${c.name} — already has the section`); skipped++;
      await logRun({ slug: c.slug, status: 'skipped', reason: 'already has the section' });
      continue;
    }

    let text;
    try { text = await research(c.name, spec); }
    catch (e) {
      console.log(`  ❌  ${c.name} — ${e.message}`); refused++;
      await logRun({ slug: c.slug, status: 'refused', reason: `research error: ${e.message}` });
      continue;
    }

    if (/^INSUFFICIENT$/im.test(text)) {
      console.log(`  ✋  ${c.name} — nothing verifiable, skipped`); refused++;
      await logRun({ slug: c.slug, status: 'refused', reason: 'model reported INSUFFICIENT' });
      continue;
    }

    const leak = refusedForMetaText(text);
    if (leak) {
      console.log(`  ✋  ${c.name} — meta-text leak ("${leak}"), refused`); refused++;
      await logRun({ slug: c.slug, status: 'refused', reason: `meta-text leak: "${leak}"` });
      continue;
    }

    const urls = linksIn(text);
    if (!urls.length) {
      console.log(`  ✋  ${c.name} — no sources, skipped`); refused++;
      await logRun({ slug: c.slug, status: 'refused', reason: 'no source links' });
      continue;
    }
    const fetched = [];
    for (const u of urls) {
      const { ok, text: pageText } = await fetchSource(u);
      if (ok) fetched.push({ url: u, text: pageText });
    }
    const alive = fetched.map((f) => f.url);
    if (!alive.length) {
      console.log(`  ✋  ${c.name} — every source link failed, skipped`); refused++;
      await logRun({ slug: c.slug, status: 'refused', reason: 'every source link failed or timed out', sourcesChecked: urls });
      continue;
    }
    if (alive.length < urls.length) {
      for (const dead of urls.filter((u) => !alive.includes(u))) {
        text = text.split('\n').filter((line) => !line.includes(dead)).join('\n');
      }
    }

    // Every numeral in the drafted section must appear in the text of at least
    // one of its own cited (and now fetched) source pages. This is the check
    // that would have caught the ¥300–400 nationwide claim in commit f48b2afd:
    // its two Narita pages state different, airport-only figures, and no
    // source stated 300–400 for anything.
    const numbersChecked = numbersIn(text);
    const bad = unsupportedNumbers(text, fetched.map((f) => f.text));
    if (bad.length) {
      console.log(`  ✋  ${c.name} — unsupported number(s) ${bad.join(', ')} (checked ${alive.length} source page${alive.length === 1 ? '' : 's'}), refused`);
      refused++;
      await logRun({ slug: c.slug, status: 'refused', reason: `unsupported number(s): ${bad.join(', ')}`, sourcesKept: alive, sourcesChecked: urls, numbersChecked });
      continue;
    }

    if (DRY) {
      console.log(`  📄  ${c.name}\n${text.replace(/^/gm, '      ')}\n`);
      written++;
      await logRun({ slug: c.slug, status: 'dry-preview', reason: 'DRY=1, no write', sourcesKept: alive, numbersChecked });
      continue;
    }
    const next = stampSectionReviewed(upsertSection(md, { heading: spec.heading, body: text }), SECTION, today);
    await writeFile(file, next, 'utf8');
    console.log(`  ✓   ${c.name} — ${text.split(/\s+/).length} words, ${alive.length} source${alive.length === 1 ? '' : 's'}`);
    written++;
    await logRun({ slug: c.slug, status: 'written', reason: `${text.split(/\s+/).length} words`, sourcesKept: alive, numbersChecked });
  }
  console.log(`\nSECTION_SUMMARY section=${SECTION} written=${written} skipped=${skipped} refused=${refused}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
