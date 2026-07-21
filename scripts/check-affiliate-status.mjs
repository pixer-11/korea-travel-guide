#!/usr/bin/env node
// Checks whether the Travelpayouts flight/hotel programs are live for our marker.
// The Hotellook widget endpoint returns an EMPTY body while the marker isn't yet
// subscribed to the program, and real widget JS once it's approved — so a
// non-empty response is a reliable "approved" signal. Aviasales (flights) is
// approved in the same project review, so hotels going live ⇒ flights too.
import { appendFileSync } from 'node:fs';

const HOTEL_URL =
  'https://tp.media/content?currency=usd&trs=553157&shmarker=754088&show_hotels=true&powered_by=true&locale=en&searchUrl=search.hotellook.com&plain=false&promo_id=7873&campaign_id=101&destination=Seoul';

async function bodyLen(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'WanderAtlasStatusCheck/1.0' } });
    const text = await res.text();
    return text.trim().length;
  } catch (e) {
    console.error('fetch error:', e.message);
    return -1;
  }
}

const len = await bodyLen(HOTEL_URL);
const live = len > 0;

const line = live
  ? `✅ LIVE — Hotellook widget returns content (${len} bytes). Flights + hotels are approved and earning.`
  : `⏳ PENDING — Hotellook widget still returns empty (${len} bytes). Account is under review.`;

console.log(line);

// Expose result to the workflow (step output + job summary).
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `live=${live}\n`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Affiliate status\n\n${line}\n`);
