// ─────────────────────────────────────────────────────────────
//  IMAGE BYTE FETCH — one UA ladder for every place we pull an image
//  file from someone else's CDN (width probe, vision gate, wall thumbs,
//  Pinterest, Threads).
//
//  We identify ourselves by default, because Wikimedia asks us to and a
//  disguised UA is how a project gets banned from Commons.
//
//  But some CDNs answer that honesty with a 502. Measured 2026-08-30 over the
//  24 Flickr URLs sitting in the audit store as failures:
//      WanderAtlasBot/1.0 …   200 on  4 / 24
//      a browser UA           200 on 24 / 24
//  The bot UA gets through maybe one time in six, which is exactly what made
//  this so slippery — a single hand-run curl "proves" the URL is fine, and the
//  4 that pass shuffle between runs. politeFetch already retries a 502, but it
//  retries with THE SAME UA, so it never escapes.
//
//  Hence the ladder: our name first, a browser UA only once the host has
//  actually refused us. A 404 is not a refusal — it is an absence, and no UA
//  will conjure the file back, so we do not spend a second round trip on it.
//
//  The cost of the old behaviour was not a slow build: it was 20 perfectly
//  good photos written into visual-audit.json as permanent MISMATCH verdicts
//  (see widthVerdict in image-width.mjs — a photo we could not MEASURE is not
//  a photo we have JUDGED).
// ─────────────────────────────────────────────────────────────
import { politeFetch } from './polite-fetch.mjs';

export const IMAGE_UA = 'WanderAtlasBot/1.0 (https://wanderatlasguides.com)';

// Chrome's UA verbatim. Not a disguise we reach for first — the rung we step
// onto only after a host has told us our own name is unwelcome.
export const FALLBACK_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

// Statuses that mean "the host pushed back", not "the file is not there".
// Same set politeFetch retries, and for the same reason.
const REFUSED = new Set([403, 429, 502, 503, 504]);

/**
 * fetch() for image bytes, with the identify-then-fall-back UA ladder.
 * Everything else (retries on transient status, Retry-After) is politeFetch's.
 *
 * @param {string} url
 * `ua` lets a caller keep its own, more specific identity on the first rung
 * (build-wall says which script is asking); the fallback rung is shared.
 *
 * @param {RequestInit & { fetchImpl?: typeof fetch, tries?: number, baseMs?: number, ua?: string }} [opts]
 * @returns {Promise<Response>} the better of the two attempts
 */
export async function imageFetch(url, opts = {}) {
  const { fetchImpl, headers = {}, ua = IMAGE_UA, ...rest } = opts;
  const get = (agent, tries) => {
    const init = { ...rest, tries, headers: { ...headers, 'User-Agent': agent } };
    return fetchImpl ? fetchImpl(url, init) : politeFetch(url, init);
  };
  // The refusal is about our NAME, so nagging the host under the same name is
  // pure latency — 3 tries × backoff burned before the rung that actually
  // works. Knock once here; spend the retry budget on the fallback.
  const budget = rest.tries ?? 3;

  let res;
  try {
    res = await get(ua, 1);
  } catch {
    // A thrown request is a refusal too — give the other UA its turn.
    return get(FALLBACK_UA, budget);
  }
  if (res.ok || !REFUSED.has(res.status)) return res;

  // Drain the refusal so the socket can be reused for the retry.
  try { await res.arrayBuffer?.(); } catch {}
  try {
    return await get(FALLBACK_UA, budget);
  } catch {
    return res; // both rungs failed — hand back the first verdict
  }
}
