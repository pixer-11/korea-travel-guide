#!/usr/bin/env node
/**
 * IndexNow — tell Bing/Yandex/Seznam/Naver about new and changed pages instead
 * of waiting to be crawled.
 *
 * Google does not participate, so this is not a Google play. It matters for a
 * different reason: ChatGPT's search is served from Bing's index, so a page Bing
 * has not crawled cannot be cited by ChatGPT at all. This site's one genuinely
 * uncopyable asset — quiet-times/crowd data, which is absent from Google Maps
 * and unlicensable by assistants — is worth nothing to an assistant that never
 * sees the page. Publishing was fully automated months before anything told a
 * non-Google engine that a page existed.
 *
 * Drives itself off the LIVE sitemap rather than off the publish run. Posts
 * arrive by several paths — daily publish, country backfill, manual dispatch,
 * translation follow-ups, title/description rewrites — and a hook on any one of
 * them silently misses the others. The sitemap is the one place every published
 * URL has to appear, and it also has the property that a URL in it is known to
 * exist: submitting a 404 to IndexNow is a strike against the host.
 *
 * State is a { url: lastmod } map, so a page whose lastmod moved (a rewritten
 * title, a refreshed venue) is resubmitted, not just brand-new pages.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_PATH = join(ROOT, 'data', 'indexnow-state.json');
const PUBLIC_DIR = join(ROOT, 'public');

const HOST = 'wanderatlasguides.com';
const SITEMAP_INDEX = `https://${HOST}/sitemap-index.xml`;
const ENDPOINT = 'https://api.indexnow.org/indexnow';

/**
 * The key is public by design — it is served as a file at the site root so the
 * engines can prove we own the host. It lives here as a constant, and the file
 * in public/ must be named after it; verifyKeyFile() below refuses to run if
 * the two ever drift apart, because a mismatched key makes every submission a
 * silent 403.
 */
const KEY = '282e944b35a0a42d76d9ae81206893ac';
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;

// IndexNow accepts 10,000 URLs per request. The smaller batch is about failure
// granularity, not limits: one rejected batch of 1,000 is recoverable, one
// rejected batch of 6,000 loses the whole run.
const BATCH = 1000;

// A full-site rebuild can move every lastmod at once. Submitting 6,000 URLs as
// "changed" on a normal day is the shape of a spam signal, so the run spends at
// most this many and leaves the rest for the next one — which is fine, because
// the state file only records what was actually sent.
const MAX_PER_RUN = 2000;

const LOC_RE = new RegExp(String.raw`<loc>\s*([^<]+?)\s*</loc>`, 'g');
const URL_BLOCK_RE = new RegExp(String.raw`<url\b[\s\S]*?</url>`, 'g');
const LASTMOD_RE = new RegExp(String.raw`<lastmod>\s*([^<]+?)\s*</lastmod>`);

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'wander-atlas-indexnow' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

/** Fails loudly: without a reachable key file every submission is rejected. */
async function verifyKeyFile() {
  const local = join(PUBLIC_DIR, `${KEY}.txt`);
  if (!existsSync(local)) {
    const found = readdirSync(PUBLIC_DIR).filter((f) => /^[0-9a-f]{8,}\.txt$/.test(f));
    throw new Error(
      `public/${KEY}.txt is missing (found: ${found.join(', ') || 'none'}). ` +
        'The key constant and the key file must match.',
    );
  }
  if (readFileSync(local, 'utf8').trim() !== KEY) {
    throw new Error(`public/${KEY}.txt exists but its contents are not the key.`);
  }
  const res = await fetch(KEY_LOCATION, { headers: { 'user-agent': 'wander-atlas-indexnow' } });
  if (!res.ok) throw new Error(`key file not served yet: ${res.status} at ${KEY_LOCATION}`);
  if ((await res.text()).trim() !== KEY) throw new Error(`key file served at ${KEY_LOCATION} has wrong contents`);
}

/** Every <loc> in the sitemap set, paired with its <lastmod> when present. */
async function collectSitemap() {
  const index = await fetchText(SITEMAP_INDEX);
  const children = [...index.matchAll(LOC_RE)].map((m) => m[1]).filter((u) => u.endsWith('.xml'));
  const maps = children.length ? children : [SITEMAP_INDEX];

  const out = new Map();
  for (const map of maps) {
    const xml = await fetchText(map);
    for (const block of xml.match(URL_BLOCK_RE) ?? []) {
      LOC_RE.lastIndex = 0;
      const loc = LOC_RE.exec(block)?.[1];
      if (!loc) continue;
      out.set(loc, LASTMOD_RE.exec(block)?.[1] ?? '');
    }
  }
  return out;
}

function readState() {
  try {
    const raw = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    return { submitted: raw.submitted ?? {}, lastRunAt: raw.lastRunAt ?? null };
  } catch {
    return { submitted: {}, lastRunAt: null };
  }
}

function writeState(submitted, extra) {
  // Sorted so a day that adds 16 posts produces a 16-line diff instead of a
  // reshuffled 6,000-line file.
  const ordered = {};
  for (const k of Object.keys(submitted).sort()) ordered[k] = submitted[k];
  writeFileSync(STATE_PATH, `${JSON.stringify({ ...extra, submitted: ordered }, null, 2)}\n`);
}

async function submit(urls) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList: urls }),
  });
  // 200 accepted, 202 accepted-pending-key-validation. Everything else is a
  // refusal worth reporting rather than swallowing.
  if (res.status !== 200 && res.status !== 202) {
    throw new Error(`IndexNow returned ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.status;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  await verifyKeyFile();

  const live = await collectSitemap();
  if (live.size === 0) throw new Error('sitemap yielded 0 URLs — refusing to proceed');

  const state = readState();
  const fresh = [];
  for (const [url, lastmod] of live) {
    const seen = state.submitted[url];
    if (seen === undefined) fresh.push([url, lastmod, 'new']);
    else if (lastmod && lastmod !== seen) fresh.push([url, lastmod, 'changed']);
  }

  const newCount = fresh.filter((f) => f[2] === 'new').length;
  console.log(`sitemap ${live.size} URLs · ${newCount} new · ${fresh.length - newCount} changed`);

  if (fresh.length === 0) {
    console.log('nothing to submit');
    if (!dryRun) writeState(state.submitted, { lastRunAt: new Date().toISOString(), lastSubmitted: 0 });
    return;
  }

  const capped = fresh.slice(0, MAX_PER_RUN);
  if (capped.length < fresh.length) {
    console.log(`NOTE: capped at ${MAX_PER_RUN}; ${fresh.length - capped.length} deferred to the next run`);
  }

  if (dryRun) {
    console.log(`[dry-run] would submit ${capped.length}:`);
    for (const [url, , why] of capped.slice(0, 10)) console.log(`  ${why.padEnd(7)} ${url}`);
    return;
  }

  const submitted = { ...state.submitted };
  let sent = 0;
  for (let i = 0; i < capped.length; i += BATCH) {
    const slice = capped.slice(i, i + BATCH);
    const status = await submit(slice.map(([u]) => u));
    // Recorded per batch, so a mid-run failure keeps what already succeeded and
    // the next run retries only the remainder.
    for (const [url, lastmod] of slice) submitted[url] = lastmod;
    sent += slice.length;
    console.log(`  batch ${i / BATCH + 1}: ${slice.length} URLs → HTTP ${status}`);
    writeState(submitted, { lastRunAt: new Date().toISOString(), lastSubmitted: sent });
  }

  console.log(`submitted ${sent} URLs to IndexNow`);
}

main().catch((err) => {
  console.error(`IndexNow submission failed: ${err.message}`);
  process.exit(1);
});
