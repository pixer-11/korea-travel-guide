import { createHash } from 'node:crypto';
import yaml from 'js-yaml';

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

// The hash of an English post FILE, read the one way that counts: the way
// translate-posts.mjs reads it when deciding whether a translation is stale.
//
// This exists because getting it subtly wrong is silent and expensive. The body
// must be CRLF-normalized (a Windows checkout must agree with CI) and TRIMMED —
// and any caller that passes gray-matter's `.content` instead computes a
// different hash for the same file. resync-rating-badges did exactly that, so
// the re-stamp meant to prevent re-translation wrote a value the translator
// never recognised, and the "no re-translation" promise in its header never
// held. Every tool that re-stamps a translation must call THIS, so the formula
// cannot drift apart again.
export function srcHashOfPostFile(raw) {
  const norm = String(raw).replace(/\r\n/g, '\n');
  const end = norm.indexOf('\n---', 3);
  if (end < 0) return null;
  let fm;
  try { fm = yaml.load(norm.slice(4, end)); } catch { return null; }
  if (!fm) return null;
  return srcHashOf({
    title: fm.title,
    description: fm.description,
    quickAnswer: fm.quickAnswer,
    faq: fm.faq,
    body: norm.slice(end + 4).trim(),
  });
}

// The stored srcHash of an existing translation file's raw text, or null
// (legacy file from before hash tracking).
export function storedHashIn(raw) {
  const m = raw.match(/^srcHash:\s*['"]?([0-9a-f]{12})['"]?\s*$/m);
  return m ? m[1] : null;
}
