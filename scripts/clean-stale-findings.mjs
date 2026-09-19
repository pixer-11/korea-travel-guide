#!/usr/bin/env node
// Queue hygiene: drop findings the rule book already answers.
//
// The weekly auditor is handed each venue's measured crowd hours and still
// reports sentences quoting them as "invented-specifics". repair-prose has
// refused to act on those since 2026-09-05 (they are verified data), so no
// money is being spent on them — but nothing ever removed them from the queue,
// so they are carried from week to week and counted in the Telegram line the
// owner reads. On 2026-09-19 that line said 291 posts; 141 of the 157
// clock-quoting findings in it were sentences our own data supports.
//
// full-content-audit.mjs now applies the same check before it writes a finding
// (lib/crowd-claim.mjs). This clears what is already banked, in both files: the
// queue repair-prose reads, and the per-post verdicts the audit carries forward
// for unchanged posts.
//
//   DRY=1 node scripts/clean-crowd-claim-findings.mjs
//   node scripts/clean-crowd-claim-findings.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import matter from 'gray-matter';
import { crowdClaimSupported } from './lib/crowd-claim.mjs';
import { heroTierReason } from './lib/event-hero-tier.mjs';

const DRY = process.env.DRY === '1';
const QUEUE = 'data/full-audit.json';
const SEEN = 'data/full-audit-seen.json';
const POSTS = 'src/content/posts';

const VISION = 'data/visual-audit.json';
const COVERS = 'data/region-covers.json';
const SEP = String.fromCharCode(1);
const vision = existsSync(VISION) ? JSON.parse(readFileSync(VISION, 'utf8')) : {};
const covers = existsSync(COVERS) ? JSON.parse(readFileSync(COVERS, 'utf8')) : {};

const frontmatterOf = (slug) => {
  const f = `${POSTS}/${slug}.md`;
  if (!existsSync(f)) return null;
  try { return matter(readFileSync(f, 'utf8')).data ?? null; } catch { return null; }
};

const busynessOf = (slug) => {
  const f = `${POSTS}/${slug}.md`;
  if (!existsSync(f)) return null;
  try { return matter(readFileSync(f, 'utf8')).data?.place?.busyness ?? null; } catch { return null; }
};

let droppedFindings = 0;
let droppedImages = 0;
let clearedPosts = 0;

/** Strip supported crowd claims from one result row. Returns the row, or null when it has nothing left. */
function clean(row) {
  // IMAGE half: an image finding is banked against the post's BODY hash, so it
  // is carried forward even after the photo itself has been judged acceptable.
  // Four of the nine "photo failed" lines in the 2026-09-19 report were banked
  // on 09-05/09-12 and kept being re-sent after the daily patrol judged those
  // heroes CITY-TIER on 09-13, and the other five were city photos on event
  // posts — the third tier the owner approved on 2026-09-11.
  if (row?.image) {
    const d = frontmatterOf(row.slug);
    const url = d?.heroImage?.url;
    const v = url ? vision[`${row.slug}${SEP}${url}`] : null;
    const judgedOk = v && v.verdict !== 'MISMATCH';
    const cityTier = url && d?.category === 'event' && Boolean(heroTierReason(url, d, covers));
    if (judgedOk || cityTier) {
      droppedImages++;
      const { image, ...rest } = row;
      row = rest;
    }
  }
  if (!Array.isArray(row?.prose) || !row.prose.length) return row.image || row.imageError || row.proseError || row.prose ? row : null;
  const bz = busynessOf(row.slug);
  if (!bz) return row;
  const kept = row.prose.filter((p) => !crowdClaimSupported(p.quote, bz));
  droppedFindings += row.prose.length - kept.length;
  if (kept.length === row.prose.length) return row;
  if (kept.length) return { ...row, prose: kept };
  const { prose, ...rest } = row;
  clearedPosts++;
  return rest.image || rest.imageError || rest.proseError ? rest : null;
}

// 1. the work queue
const queue = JSON.parse(readFileSync(QUEUE, 'utf8'));
const rows = Array.isArray(queue) ? queue : queue.results || [];
const cleanedRows = rows.map(clean).filter(Boolean);

// 2. the per-post verdicts carried forward for unchanged posts
const seen = JSON.parse(readFileSync(SEEN, 'utf8'));
for (const [slug, entry] of Object.entries(seen)) {
  if (!entry?.result) continue;
  const cleaned = clean({ slug, ...entry.result });
  entry.result = cleaned ? (({ slug: _s, ...r }) => r)(cleaned) : null;
}

console.log(`queue: ${rows.length} → ${cleanedRows.length} row(s)`);
console.log(`prose findings dropped: ${droppedFindings} · image findings dropped: ${droppedImages} · posts cleared entirely: ${clearedPosts}`);
if (DRY) { console.log('DRY — nothing written'); process.exit(0); }

writeFileSync(QUEUE, JSON.stringify(Array.isArray(queue) ? cleanedRows : { ...queue, results: cleanedRows }, null, 2) + '\n');
writeFileSync(SEEN, JSON.stringify(seen, null, 2) + '\n');
console.log('written');
