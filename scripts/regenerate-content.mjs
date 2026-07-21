#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  REGENERATE POST PROSE with the deepened writer.
//  Keeps EVERYTHING factual/structural (heroImage, place data, ratings,
//  gallery, tags, pubDate, slug) — only the AI-written body + quickAnswer +
//  FAQ are replaced, so existing posts gain the same depth as new ones.
//
//  Safe & resumable: on any per-post error the original file is left untouched.
//  Usage:
//    node scripts/regenerate-content.mjs            # all posts
//    node scripts/regenerate-content.mjs seoul      # only slugs containing "seoul"
//    LIMIT=5 node scripts/regenerate-content.mjs     # cap how many to do
//    DRY=1 node scripts/regenerate-content.mjs       # report only
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import yaml from 'js-yaml';
import { writeArticle } from './lib/writer.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const POSTS_DIR = join(__dirname, '..', 'src', 'content', 'posts');
const DRY = process.env.DRY === '1';
const FILTER = process.argv[2] || '';
const LIMIT = Number(process.env.LIMIT ?? Infinity);

function splitFrontmatter(raw) {
  const norm = raw.replace(/\r\n/g, '\n');
  const m = norm.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return null;
  return { fm: m[1], rest: norm.slice(m[0].length) };
}

function factsFor(data) {
  if (data.place?.name) {
    return {
      kind: 'place',
      facts: {
        name: data.place.name,
        address: data.place.address,
        rating: data.place.rating,
        reviews: data.place.userRatingsTotal,
        priceLevel: data.place.priceLevel,
        region: data.region,
      },
    };
  }
  const topic = (data.tags && data.tags[1]) || data.category;
  return {
    kind: 'placeless',
    facts: {
      topic,
      area: data.title,
      region: data.region,
      category: data.category,
      guidance:
        'No single verified venue for this post. Write a genuinely useful, SPECIFIC guide to this topic/area for international visitors — name real neighborhoods, streets, subway stations/lines, signature dishes or sights, and nearby places you are confident exist. Do NOT invent specific business names, exact current hours, or prices.',
    },
  };
}

function disclosureFor(hasPlace) {
  const src = hasPlace
    ? 'Facts such as ratings and location come from live Google Places data; images are licensed or public domain.'
    : 'Images are licensed or public domain. This is a general area/topic overview — verify specific venue details before visiting.';
  return `> **How this guide was made:** Editor-reviewed, AI-assisted. ${src} See our [editorial policy](/about).`;
}

async function main() {
  const files = (await readdir(POSTS_DIR))
    .filter((f) => f.endsWith('.md'))
    .filter((f) => !FILTER || f.includes(FILTER));

  console.log(`\n✍️  Regenerating prose — ${files.length} candidate post(s)${DRY ? ' (DRY)' : ''}\n`);

  let done = 0, skipped = 0, failed = 0;
  for (const file of files) {
    if (done >= LIMIT) break;
    const path = join(POSTS_DIR, file);
    try {
      const raw = await readFile(path, 'utf8');
      const split = splitFrontmatter(raw);
      if (!split) { console.log(`  ?  ${file} — no frontmatter, skipped`); skipped++; continue; }

      const data = yaml.load(split.fm);
      if (!data?.title) { console.log(`  ?  ${file} — no title, skipped`); skipped++; continue; }

      const { kind, facts } = factsFor(data);
      if (DRY) { console.log(`  ·  would regen [${kind}] ${file}`); done++; continue; }

      const { body, quickAnswer, faq } = await writeArticle({
        title: data.title, region: data.region, category: data.category, facts,
      });
      if (!body || body.length < 300) { console.log(`  ⚠️  ${file} — writer returned too little, kept original`); failed++; continue; }

      data.quickAnswer = quickAnswer;
      data.faq = faq;

      const fmOut = yaml.dump(data, { lineWidth: -1, noRefs: true, sortKeys: false });
      const md = `---\n${fmOut}---\n\n${disclosureFor(!!data.place?.name)}\n\n${body}\n`;
      await writeFile(path, md, 'utf8');
      done++;
      console.log(`  ✅ [${kind}] ${file} — ${body.split(/\s+/).length} words`);
    } catch (err) {
      failed++;
      console.log(`  ⚠️  ${file} — ${err.message} (kept original)`);
    }
  }

  console.log(`\n📦  Done. ${done} regenerated · ${skipped} skipped · ${failed} failed${DRY ? ' (DRY)' : ''}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
