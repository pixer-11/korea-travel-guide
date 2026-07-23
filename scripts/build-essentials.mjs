#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  BUILD / REFRESH per-country "Essentials" guides (web search)
//  For each ACTIVE country, uses Claude's web-search tool to research CURRENT
//  visa/entry, transport, money, best time, and emergency info, and writes a
//  Markdown essentials guide to src/content/essentials/<country>.md.
//
//  SAFETY: visa/legal specifics are summaries only — the guide always links the
//  official sources and tells readers to confirm there, and stamps a
//  "lastReviewed" date. Re-runs within REFRESH_DAYS are skipped (monthly cron).
//  Usage:  node scripts/build-essentials.mjs            (all active)
//          COUNTRY=Japan FORCE=1 node scripts/build-essentials.mjs
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { slugify } from './lib/slugify.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'src', 'content', 'essentials');
const COUNTRIES_FILE = join(ROOT, 'data', 'countries.json');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.WRITER_MODEL || 'claude-sonnet-5';
const REFRESH_DAYS = Number(process.env.REFRESH_DAYS ?? 25);
const FORCE = process.env.FORCE === '1';

function recentlyReviewed(md) {
  const m = md.match(/^lastReviewed:\s*"?(\d{4}-\d{2}-\d{2})/m);
  if (!m) return false;
  const days = (Date.now() - new Date(m[1]).getTime()) / 86400000;
  return days < REFRESH_DAYS;
}

async function research(country) {
  const now = new Date();
  const monthYear = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const prompt =
    `You are writing a factual "Know Before You Go" travel essentials guide for international visitors to ${country}, current as of ${monthYear}. ` +
    `Use web search to confirm CURRENT (2026) entry/visa rules, public transport, money/cards, best time to visit, and emergency numbers.\n\n` +
    `Write a well-structured GitHub-flavored Markdown guide of about 700–1000 words with EXACTLY these H2 sections in order:\n` +
    `## Visa & entry\n## Getting around\n## Money & costs\n## Best time to visit\n## Emergencies & safety\n## Official sources\n\n` +
    `Rules:\n` +
    `- Start with a single line: **Quick answer:** followed by a 1–2 sentence summary.\n` +
    `- Give concrete, current facts (real emergency numbers, typical visa-free lengths, transport passes, currency).\n` +
    `- For visa/entry: summarize, but explicitly tell readers to CONFIRM on the official links because rules change.\n` +
    `- "## Official sources" must list REAL official government / tourism-board links as markdown links (immigration, e-visa/ETA portal, transport, tourism board).\n` +
    `- Do NOT invent specifics you couldn't verify. No preamble — output ONLY the markdown guide.`;

  const msg = await client.messages.create({
    model: MODEL,
    // 3000 truncated guides mid-section (south-korea.md shipped with only 2 of 6
    // H2s). 5000 comfortably fits a 700–1000-word, 6-section guide + sources.
    max_tokens: 5000,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }],
    messages: [{ role: 'user', content: prompt }],
  });
  return msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}

const esc = (s) => String(s).replace(/"/g, '\\"');

async function main() {
  if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true });
  const { countries } = JSON.parse(await readFile(COUNTRIES_FILE, 'utf8'));
  const only = process.env.COUNTRY;
  const active = countries.filter((c) => c.active && (!only || c.name === only));

  console.log(`\n📘  Essentials — ${active.map((c) => c.name).join(', ')}${FORCE ? ' (FORCE)' : ''}\n`);
  let made = 0, skipped = 0, failed = 0;

  for (const c of active) {
    const file = join(OUT_DIR, `${c.slug}.md`);
    if (!FORCE && existsSync(file) && recentlyReviewed(await readFile(file, 'utf8'))) {
      console.log(`  ⏭️   ${c.name} — reviewed recently`); skipped++; continue;
    }
    try {
      let body = await research(c.name);
      // strip an accidental leading markdown fence
      body = body.replace(/^```(markdown)?\n/i, '').replace(/\n```\s*$/i, '').trim();
      // Completeness gate: a guide missing any of the 6 required sections (usually
      // from truncation) must NOT ship — the topic hubs deep-link to these anchors,
      // and a half-written essentials page is worse than none on a young domain.
      const REQUIRED_H2 = [
        '## Visa & entry', '## Getting around', '## Money & costs',
        '## Best time to visit', '## Emergencies & safety', '## Official sources',
      ];
      const missing = REQUIRED_H2.filter((h) => !body.includes(h));
      if (body.length < 400 || missing.length) {
        console.log(`  ⚠️  ${c.name} — incomplete (${missing.length ? 'missing: ' + missing.join(', ') : 'too thin'})`); failed++; continue;
      }
      const today = new Date().toISOString().slice(0, 10);
      const fm =
        `---\n` +
        `country: "${esc(c.name)}"\n` +
        `title: "${esc(c.name)} Travel Essentials: Visa, Transport & More"\n` +
        `description: "Know before you go to ${esc(c.name)} — current visa & entry, getting around, money, best time to visit, and emergency numbers, with official sources."\n` +
        `lastReviewed: ${today}\n` +
        `draft: false\n` +
        `---\n\n`;
      await writeFile(file, fm + body + '\n', 'utf8');
      made++;
      console.log(`  ✅  ${c.slug}.md`);
    } catch (e) {
      failed++;
      console.log(`  ⚠️  ${c.name} — ${e.message}`);
    }
  }
  console.log(`\n📦  ${made} written · ${skipped} skipped · ${failed} failed\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
