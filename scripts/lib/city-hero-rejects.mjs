// Which (city, photo) pairs vision has already said are not a view of that city.
//
// fill-event-city-heroes asks one question about a Commons file: is this a view
// of <region>? The post is not part of the question, so the answer belongs to
// the city and the file. Nothing wrote it down, and on 2026-11-07 the same 37
// files were judged 118 times for the 94 post/photo pairs of the night before:
// 96% of November's rejections were repeats, about $20 a month.
//
// A separate file, not data/visual-audit.json: a row there is read as "this
// photo is wrong for this post" by the event-photo patrols, and "not a view of
// the city" says nothing about whether it shows the event.
import { cleanCommonsUrl } from './commons.mjs';
import { isMeasurementFailure } from './audit-verdict.mjs';

export const REJECTS_FILE = 'data/city-hero-rejects.json';

// Long enough to stop paying nightly; short enough that the judge gets another
// look at a file if the prompt or the model has changed.
const RETRY_AFTER_DAYS = 30;
const DAY = 864e5;

// verifyHeroImage answers ok:false for these too, and none is a judgement of
// the photo. Recorded, one outage would blacklist every candidate of the night
// (2026-08-30: a Flickr 502 did that to 24 candidates).
// Case-sensitive on purpose: these are our own lower-case strings, and a model
// is free to write "Image unusable: visible watermark" as its verdict (Codex).
const NOT_A_VERDICT = /^(vision unavailable|vision check failed|no-api-key|image unusable|candidate unusable)/;

export const rejectKey = (region, url) => `${region}\x01${cleanCommonsUrl(url)}`;

/** Did vision reject this file for this city within the last 30 days? */
export function wasRejected(store, region, url, now = Date.now()) {
  const at = Date.parse(store[rejectKey(region, url)]?.at);
  return Number.isFinite(at) && now - at < RETRY_AFTER_DAYS * DAY;
}

/** Record a rejection. Returns false, recording nothing, when `reason` is an outage. */
export function rememberRejection(store, region, url, reason, now = Date.now()) {
  const why = String(reason ?? '');
  if (NOT_A_VERDICT.test(why) || isMeasurementFailure({ reason: why })) return false;
  store[rejectKey(region, url)] = { reason: why.slice(0, 150), at: new Date(now).toISOString() };
  return true;
}

/** Drop rows past the retry window. Returns true when something was removed. */
export function pruneRejections(store, now = Date.now()) {
  let removed = false;
  for (const [k, v] of Object.entries(store)) {
    const at = Date.parse(v?.at);
    if (Number.isFinite(at) && now - at < RETRY_AFTER_DAYS * DAY) continue;
    delete store[k];
    removed = true;
  }
  return removed;
}
