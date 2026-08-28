// ─────────────────────────────────────────────────────────────
//  CHILD SITEMAP SUBMISSION — one-shot, idempotent.
//
//  The sitemap is split into 35 files by language × page type precisely so
//  GSC coverage can be read per type — but only sitemap-index.xml was ever
//  submitted, so those per-file reports never existed (2026-08-28 audit).
//  Submitting a child that Google already knows via the index is free and
//  idempotent; what it buys is the per-sitemap indexed/discovered breakdown
//  in Search Console, which the 09-10 throttle verdict wants segmented.
//
//  Also submits image-sitemap.xml (referenced in robots.txt, never submitted).
//
//  Needs: GSC_SERVICE_ACCOUNT_JSON + GSC_SITE_URL, and the service account
//  added to the property with FULL permission (readonly users cannot submit —
//  the API answers 403, which this script reports rather than hides).
//
//    node scripts/submit-child-sitemaps.mjs
// ─────────────────────────────────────────────────────────────
import { getAccessToken } from './lib/gsc.mjs';

const SITE = 'https://wanderatlasguides.com';
const sa = JSON.parse(process.env.GSC_SERVICE_ACCOUNT_JSON ?? '{}');
const siteUrl = process.env.GSC_SITE_URL;
if (!sa.client_email || !siteUrl) {
  console.error('GSC_SERVICE_ACCOUNT_JSON / GSC_SITE_URL missing');
  process.exit(1);
}

// Enumerate children from the LIVE index — the deployed truth, not a local
// build that may be stale or absent on this runner.
const idx = await fetch(`${SITE}/sitemap-index.xml`).then((r) => r.text());
const children = [...idx.matchAll(/<loc>\s*(https:\/\/[^<\s]+\.xml)\s*<\/loc>/g)].map((m) => m[1]);
const feeds = [...children, `${SITE}/image-sitemap.xml`];
if (children.length < 30) {
  console.error(`only ${children.length} children found in the live index — refusing (expected ~35)`);
  process.exit(1);
}

const token = await getAccessToken(sa, 'https://www.googleapis.com/auth/webmasters');
let ok = 0, failed = 0;
for (const feed of feeds) {
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(feed)}`,
    { method: 'PUT', headers: { Authorization: `Bearer ${token}` } },
  );
  if (res.ok || res.status === 204) { ok++; console.log(`submitted: ${feed}`); }
  else { failed++; console.error(`FAILED ${res.status}: ${feed} — ${(await res.text()).slice(0, 160)}`); }
}
console.log(`\n${ok} submitted, ${failed} failed of ${feeds.length}`);
if (failed) {
  console.error('403 here means the service account has readonly/restricted permission on the property — raise it to Full in Search Console > Settings > Users.');
  process.exit(1);
}
