#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  RECORD WHAT THE OG:IMAGE AUDIT ALREADY MEASURED.
//
//  audit-og-width probes every image the hubs share, prints the narrow ones and
//  exits. Nothing kept the number, so pickOgPhoto — which only skips a hero it
//  can PROVE is narrow — chose the same photo again the next day. The alert
//  fired twice in twenty-four hours before anyone noticed the loop was open:
//  an 849px OMSI on /continents/north-america/, then a 533px Charlie Puth on
//  /regions/pasay/. The audit runs in build-check, which has no commit rights,
//  so the write has to happen here.
//
//  Give it the URLs the alert named. It measures each one itself rather than
//  trusting the number in the message, and stores ONLY a real measurement —
//  a failed probe is a fact about the network, not about the photo
//  (see lib/image-width.mjs).
//
//    node scripts/record-og-width.mjs <url> [<url> ...]
//    node scripts/record-og-width.mjs --dry <url>
// ─────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { probeWidth } from './lib/image-width.mjs';

const STORE = 'data/og-width-probes.json';
const DRY = process.argv.includes('--dry');
const urls = process.argv.slice(2).filter((a) => !a.startsWith('--'));

if (!urls.length) {
  console.error('usage: node scripts/record-og-width.mjs <url> [<url> ...]');
  process.exit(2);
}

const store = existsSync(STORE) ? JSON.parse(readFileSync(STORE, 'utf8')) : {};
let changed = 0;
let unmeasured = 0;

for (const url of urls) {
  const width = await probeWidth(url);
  if (typeof width !== 'number') {
    console.log(`  ?  could not measure — leaving unrecorded: ${url}`);
    unmeasured++;
    continue;
  }
  const before = store[url];
  if (before === width) {
    console.log(`  =  ${String(width).padStart(5)}px already recorded: ${url}`);
    continue;
  }
  store[url] = width;
  changed++;
  console.log(`  ${width < 1200 ? '✗' : '✓'}  ${String(width).padStart(5)}px ${before ? `(was ${before}) ` : ''}${url}`);
}

if (!changed) {
  console.log(`\nnothing to write (${unmeasured} unmeasured).`);
  process.exit(unmeasured ? 1 : 0);
}
if (DRY) {
  console.log(`\n(dry run — ${changed} would be written to ${STORE})`);
  process.exit(0);
}
const sorted = Object.fromEntries(Object.keys(store).sort().map((k) => [k, store[k]]));
writeFileSync(STORE, JSON.stringify(sorted, null, 1) + '\n', 'utf8');
console.log(`\nwrote ${changed} measurement(s) to ${STORE} (${Object.keys(sorted).length} total).`);
if (unmeasured) process.exit(1);
