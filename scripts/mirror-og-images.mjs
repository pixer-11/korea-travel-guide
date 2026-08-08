// ─────────────────────────────────────────────────────────────
//  OG IMAGE MIRROR — self-host every post's share image on R2.
//
//  Why: og:image currently hotlinks the original hero (Wikimedia/FSQ URLs,
//  some with utm params). A moved file or an expired FSQ URL silently breaks
//  the share card and Discover eligibility. Mirroring the ≥1200px derivative
//  under our own domain removes the external dependency while keeping the
//  Discover invariant (og:image = the SAME photo as the hero, ≥1200px wide).
//
//  Output: data/og-mirror.json  { "<original hero url>": "/og/<hash>.webp" }
//  BaseLayout consults the table at build time; a missing entry falls back to
//  the original URL, so this script can run incrementally and never breaks a
//  page. The /og/* path is served by the worker from the R2 bucket.
//
//  Prereqs (owner, once):
//   1. Enable R2 on the Cloudflare dashboard (free tier is fine).
//   2. Create bucket `wa-og-images` + an R2 API token (Object Read & Write).
//   3. Put in .env:  R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY
//   4. Uncomment the r2_buckets binding in wrangler.jsonc (see comment there)
//      so the worker can serve /og/*.
//
//    node scripts/mirror-og-images.mjs            # mirror new heroes
//    node scripts/mirror-og-images.mjs --limit=50 # cap this run
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AwsClient } from 'aws4fetch';

const POSTS = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const TABLE = fileURLToPath(new URL('../data/og-mirror.json', import.meta.url));
const BUCKET = 'wa-og-images';
const MIN_W = 1200;
const limit = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? Infinity);

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  console.log('R2 credentials missing (.env: R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY).');
  console.log('Enable R2 on the dashboard, create bucket wa-og-images + an API token, then re-run.');
  process.exit(0); // not an error: the mirror is optional until credentials exist
}
const aws = new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY });
const endpoint = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET}`;

const table = existsSync(TABLE) ? JSON.parse(readFileSync(TABLE, 'utf8')) : {};

// Every LIVE post's hero (drafts wait until they publish).
const heroes = [];
for (const f of readdirSync(POSTS)) {
  if (!f.endsWith('.md')) continue;
  const s = readFileSync(POSTS + f, 'utf8');
  if (/^draft:\s*true/m.test(s)) continue;
  // The hero's url specifically — a bare /^\s*url:/ would match whichever
  // url-ish field happens to come first in the frontmatter.
  const url = s.match(/^heroImage:\r?\n\s+url:\s*(\S+)/m)?.[1]?.replace(/^["']|["']$/g, '');
  if (url && /^https?:\/\//.test(url)) heroes.push(url);
}
const todo = [...new Set(heroes)].filter((u) => !table[u]).slice(0, limit);
console.log(`${heroes.length} hero URL(s), ${Object.keys(table).length} mirrored, ${todo.length} to do`);

let done = 0, skipped = 0, failed = 0;
for (const url of todo) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'WanderAtlasBot/1.0 (og-mirror; wanderatlasguides.com)' } });
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buf).metadata();
    // The Discover invariant is ≥1200px. A narrower original stays hotlinked
    // rather than being upscaled into a soft fake.
    if ((meta.width ?? 0) < MIN_W) { skipped++; continue; }
    const out = await sharp(buf).resize({ width: MIN_W, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    const key = createHash('sha256').update(url).digest('hex').slice(0, 16) + '.webp';
    const put = await aws.fetch(`${endpoint}/${key}`, { method: 'PUT', body: out, headers: { 'content-type': 'image/webp' } });
    if (!put.ok) throw new Error(`R2 PUT ${put.status}`);
    table[url] = `/og/${key}`;
    done++;
  } catch (e) {
    failed++;
    console.log(`  ✗ ${url.slice(0, 80)} — ${e.message}`);
  }
}
writeFileSync(TABLE, JSON.stringify(table, null, 2) + '\n');
console.log(`mirrored ${done}, narrow-skipped ${skipped}, failed ${failed} → data/og-mirror.json (${Object.keys(table).length} total)`);
