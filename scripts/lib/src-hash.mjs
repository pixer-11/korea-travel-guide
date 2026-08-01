import { createHash } from 'node:crypto';

// Fingerprint of exactly the fields translate-posts.mjs translates. Stored in
// each translation's frontmatter as `srcHash`; a mismatch on a later run means
// the English prose changed after translation, so the file is stale and gets
// re-queued. (Non-translated facts — place data, images, dates — are read from
// the English source at render time and intentionally do NOT enter the hash.)
export function srcHashOf(data) {
  return createHash('sha1')
    .update(JSON.stringify([data.title, data.description, data.quickAnswer || '', data.faq || [], data.body]))
    .digest('hex')
    .slice(0, 12);
}

// The stored srcHash of an existing translation file's raw text, or null
// (legacy file from before hash tracking).
export function storedHashIn(raw) {
  const m = raw.match(/^srcHash:\s*['"]?([0-9a-f]{12})['"]?\s*$/m);
  return m ? m[1] : null;
}
