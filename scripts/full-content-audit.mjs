#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  FULL CONTENT AUDIT — every live post, two independent AI passes:
//   1) VISION: does the hero image honestly depict this subject?
//      (catches name-collision photos the filename heuristic can't see)
//   2) EDITOR: an AI reads the body like a human editor — flags robotic
//      symbols ("$$"), template/translator chatter, broken markdown,
//      invented-looking specifics (exact prices/schedules), foreign fragments.
//  Output: data/full-audit.json + console summary. READ-ONLY (no fixes) —
//  the report drives the fix batch + new permanent gates per class found.
//  Env: ANTHROPIC_API_KEY. LIMIT, CONCURRENCY (default 6), START (slug offset).
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import matter from 'gray-matter';
import Anthropic from '@anthropic-ai/sdk';
import { verifyHeroImage } from './lib/vision-check.mjs';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.AUDIT_MODEL || 'claude-sonnet-5';
const LIMIT = Number(process.env.LIMIT ?? Infinity);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 6);
const OUT = 'data/full-audit.json';

async function editorCheck(post) {
  const body = post.content.slice(0, 9000);
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 500,
    messages: [{
      role: 'user',
      content:
        `You are the strictest copy editor of a travel guide whose #1 rule is accuracy and natural prose. ` +
        `Article: "${post.data.title}" (${post.data.category}, ${post.data.region}, ${post.data.country}).\n` +
        `Scan the body below for ONLY these defect classes:\n` +
        `- symbol-in-prose: rating symbols like "$$"/"★"/price-level codes written into sentences\n` +
        `- template-chatter: leftover AI/template phrases ("Here is", "as an AI", meta-instructions)\n` +
        `- broken-markdown: visible markdown syntax errors, stray **, unclosed brackets, raw HTML\n` +
        `- invented-specifics: exact PRICES, exact OPENING HOURS, or specific MENU ITEMS stated as fact WITHOUT hedging. NOTE: star ratings and review counts (e.g. "4.6 from 8,000 reviews") are VERIFIED live data — NEVER flag those.\n` +
        `- foreign-fragment: sentences in a language other than the article's (proper nouns/parenthetical native names are FINE)\n` +
        `- other-glaring: anything a reader would screenshot as embarrassing\n` +
        `Respond ONLY JSON: {"issues":[{"type":"...","quote":"<exact short quote>"}]} — empty array if clean. Max 5 issues.\n\n` +
        `BODY:\n${body}`,
    }],
  });
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const m = text.match(/\{[\s\S]*\}/);
  return m ? (JSON.parse(m[0]).issues || []) : [];
}

async function main() {
  const files = (await readdir('src/content/posts')).filter((f) => f.endsWith('.md')).sort();
  const posts = [];
  for (const f of files) {
    const g = matter(await readFile(`src/content/posts/${f}`, 'utf8'));
    if (g.data.draft) continue;
    posts.push({ slug: f.replace(/\.md$/, ''), data: g.data, content: g.content });
  }
  const todo = posts.slice(0, LIMIT);
  console.log(`\n🔍 FULL AUDIT — ${todo.length} live post(s), vision + editor passes\n`);

  const results = [];
  let imgBad = 0, proseBad = 0, doneN = 0;
  const queue = [...todo];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const p = queue.shift();
      if (!p) return;
      const r = { slug: p.slug, category: p.data.category, region: p.data.region };
      try {
        if (p.data.heroImage?.url) {
          const subject = p.data.place?.name || p.data.title;
          const vis = await verifyHeroImage({
            url: p.data.heroImage.url, name: subject, category: p.data.category,
            region: p.data.region, country: p.data.country, eventMode: p.data.category === 'event',
          });
          if (!vis.ok) { r.image = vis.reason; imgBad++; }
        } else r.image = 'NO HERO';
      } catch (e) { r.imageError = e.message.slice(0, 60); }
      try {
        const issues = await editorCheck(p);
        if (issues.length) { r.prose = issues; proseBad++; }
      } catch (e) { r.proseError = e.message.slice(0, 60); }
      if (r.image || r.prose || r.imageError || r.proseError) results.push(r);
      doneN++;
      if (doneN % 25 === 0) console.log(`  … ${doneN}/${todo.length} (image issues ${imgBad} · prose issues ${proseBad})`);
    }
  }));

  await writeFile(OUT, JSON.stringify({ audited: todo.length, at: new Date().toISOString(), imgBad, proseBad, results }, null, 2) + '\n', 'utf8');
  console.log(`\n📦 AUDIT DONE — ${todo.length} posts | image FAIL ${imgBad} | prose issues ${proseBad} → ${OUT}`);
  const types = {};
  for (const r of results) for (const i of r.prose || []) types[i.type] = (types[i.type] || 0) + 1;
  console.log('prose issue types:', JSON.stringify(types));
}

main().catch((e) => { console.error(e); process.exit(1); });
