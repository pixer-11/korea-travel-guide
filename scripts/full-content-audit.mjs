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
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import matter from 'gray-matter';
import Anthropic from '@anthropic-ai/sdk';
import { verifyHeroImage } from './lib/vision-check.mjs';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.AUDIT_MODEL || 'claude-sonnet-5';
const LIMIT = Number(process.env.LIMIT ?? Infinity);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 6);
const OUT = 'data/full-audit.json';
const VISION_STORE = 'data/visual-audit.json';

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

  // ── Read what has already been judged ────────────────────────────────────
  // This audit used to re-read EVERY live post EVERY week — 1,007 posts × two
  // model calls, and the bill grew with the corpus rather than with the work.
  // Re-reading an unchanged post that already passed cannot surface anything
  // new, so the pass is now keyed to what actually changed. Three guards keep
  // that from becoming a hole:
  //   1. RULES below is part of the key. Edit the editor prompt — add a defect
  //      class, tighten a rule — and every post is re-audited automatically.
  //      A tightened checker that only ever sees new posts is the failure this
  //      prevents (nothing else in the pipeline would notice).
  //   2. A skipped post's previous findings are CARRIED FORWARD into the
  //      report. The translation judge taught this one on 2026-08-16: a
  //      flagged item that silently drops out of the next report reads as
  //      fixed. Skipping the re-read must not un-report the defect.
  //   3. The hero's vision verdict is read from the daily patrol's store
  //      instead of being re-derived. Both passes ask the same question about
  //      the same image; the patrol already skips heroes it has judged, so the
  //      weekly pass was paying a second time for the same answer.
  const RULES = 'editor-v1-2026-08-17';
  const SEEN = 'data/full-audit-seen.json';
  const AUDIT_ALL = process.env.AUDIT_ALL === '1';
  const seen = existsSync(SEEN) ? JSON.parse(await readFile(SEEN, 'utf8')) : {};
  const vision = existsSync(VISION_STORE) ? JSON.parse(await readFile(VISION_STORE, 'utf8')) : {};
  const hashOf = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);

  const carried = [];
  const fresh = [];
  for (const p of posts) {
    const bodyHash = hashOf(p.content);
    const prev = seen[p.slug];
    const unchanged = !AUDIT_ALL && prev && prev.bodyHash === bodyHash && prev.rules === RULES;
    if (unchanged) {
      // Guard 2: re-report what the last pass found here.
      if (prev.result) carried.push({ ...prev.result, carriedFrom: prev.at });
      continue;
    }
    p.bodyHash = bodyHash;
    // Guard 3: the daily patrol's verdict for this exact hero, if it has one.
    const heroUrl = p.data.heroImage?.url;
    p.visionVerdict = heroUrl ? vision[`${p.slug}\x01${heroUrl}`] : null;
    fresh.push(p);
  }

  // Newest first. On the first run the store is empty, so `fresh` is the whole
  // corpus and LIMIT spreads the seeding over a few weeks — but the day's new
  // posts must never queue behind a years-old backfill, because they are the
  // ones the pipeline just wrote and the ones most likely to carry a defect.
  fresh.sort((a, b) => new Date(b.data.pubDate || b.data.date || 0) - new Date(a.data.pubDate || a.data.date || 0));
  const todo = fresh.slice(0, LIMIT);
  const skipped = posts.length - fresh.length;
  console.log(`\n🔍 FULL AUDIT — 라이브 ${posts.length}편 중 ${todo.length}편 검사 (변경분·신규분), ${skipped}편은 지난 판정 유지\n`);

  const results = [...carried];
  let imgBad = 0, proseBad = 0, doneN = 0;
  const queue = [...todo];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const p = queue.shift();
      if (!p) return;
      const r = { slug: p.slug, category: p.data.category, region: p.data.region };
      try {
        if (!p.data.heroImage?.url) r.image = 'NO HERO';
        else if (p.visionVerdict) {
          // Already judged by the daily patrol for this exact hero — reuse it
          // rather than paying for the same verdict twice.
          if (p.visionVerdict.verdict === 'MISMATCH') { r.image = p.visionVerdict.reason; imgBad++; }
        } else {
          const subject = p.data.place?.name || p.data.title;
          const vis = await verifyHeroImage({
            url: p.data.heroImage.url, name: subject, category: p.data.category,
            region: p.data.region, country: p.data.country, eventMode: p.data.category === 'event',
          });
          if (!vis.ok) { r.image = vis.reason; imgBad++; }
        }
      } catch (e) { r.imageError = e.message.slice(0, 60); }
      try {
        const issues = await editorCheck(p);
        if (issues.length) { r.prose = issues; proseBad++; }
      } catch (e) { r.proseError = e.message.slice(0, 60); }
      const bad = r.image || r.prose || r.imageError || r.proseError;
      if (bad) results.push(r);
      // Record the verdict either way — a clean post is exactly what the next
      // run needs to know it can skip. Only banked when the pass actually
      // completed, so an API failure re-audits next week instead of being
      // remembered as clean.
      if (!r.imageError && !r.proseError) {
        seen[p.slug] = { bodyHash: p.bodyHash, rules: RULES, at: new Date().toISOString(), result: bad ? r : null };
      }
      doneN++;
      if (doneN % 25 === 0) console.log(`  … ${doneN}/${todo.length} (image issues ${imgBad} · prose issues ${proseBad})`);
    }
  }));

  await writeFile(SEEN, JSON.stringify(seen, null, 1) + '\n', 'utf8');
  // Carried-forward findings count toward the reported totals — the numbers
  // describe the corpus's current state, not just this run's calls.
  for (const c of carried) { if (c.image) imgBad++; if (c.prose) proseBad++; }
  // The workflow fails the job when this count is < 1 — the guard against an
  // audit that reports a clean site while reading nothing. Incremental auditing
  // makes "0 calls this run" legitimate, so coverage is what must be counted:
  // posts examined now PLUS posts standing on a still-valid prior verdict.
  // It must NOT be hardcoded to the corpus size — that would report full
  // coverage from an empty store and silently disarm the guard forever (this
  // exact mistake made it into the first draft of this change).
  const covered = todo.length + skipped;
  await writeFile(OUT, JSON.stringify({ audited: covered, checkedNow: todo.length, skipped, at: new Date().toISOString(), imgBad, proseBad, results }, null, 2) + '\n', 'utf8');
  console.log(`\n📦 AUDIT DONE — ${covered} posts | image FAIL ${imgBad} | prose issues ${proseBad} → ${OUT}`);
  console.log(`   (이번 실행에서 모델 호출: ${todo.length}편 · 지난 판정 재사용: ${skipped}편)`);
  const types = {};
  for (const r of results) for (const i of r.prose || []) types[i.type] = (types[i.type] || 0) + 1;
  console.log('prose issue types:', JSON.stringify(types));
}

main().catch((e) => { console.error(e); process.exit(1); });
