import { createHash } from 'node:crypto';
import yaml from 'js-yaml';

// Fingerprint of an ORDERED list of translatable values. Every translator's
// srcHash is this over its own field list — posts (srcHashOf below), the five
// essentials topic hubs and the static pages (srcHashOfSourceFile). One formula,
// so no sibling can drift into a hash the others don't recognise.
export function srcHashOfValues(values) {
  return createHash('sha1').update(JSON.stringify(values)).digest('hex').slice(0, 12);
}

// Fingerprint of exactly the fields translate-posts.mjs translates. Stored in
// each translation's frontmatter as `srcHash`; a mismatch on a later run means
// the English prose changed after translation, so the file is stale and gets
// re-queued. (Non-translated facts — place data, images, dates — are read from
// the English source at render time and intentionally do NOT enter the hash.)
export function srcHashOf(data) {
  return srcHashOfValues([data.title, data.description, data.quickAnswer || '', data.faq || [], data.body]);
}

// Split a source markdown file into { fm, body } the one way that counts for
// hashing: CRLF-normalized (a Windows checkout must agree with CI) and the body
// TRIMMED. Returns null when there is no parseable frontmatter.
export function parseSourceFile(raw) {
  const norm = String(raw).replace(/\r\n/g, '\n');
  const end = norm.indexOf('\n---', 3);
  if (end < 0) return null;
  let fm;
  try { fm = yaml.load(norm.slice(4, end)); } catch { return null; }
  if (!fm) return null;
  return { fm, body: norm.slice(end + 4).trim() };
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
  const parsed = parseSourceFile(raw);
  if (!parsed) return null;
  const { fm, body } = parsed;
  return srcHashOf({
    title: fm.title,
    description: fm.description,
    quickAnswer: fm.quickAnswer,
    faq: fm.faq,
    body,
  });
}

// The hash of a NON-post source file (topic hub, static page) over the named
// frontmatter fields, in the order given, plus the trimmed body. The field list
// is the translator's contract: it must be exactly the fields it translates, so
// an edit to any of them — and nothing else — makes the translation stale.
export function srcHashOfSourceFile(raw, fields) {
  const parsed = parseSourceFile(raw);
  if (!parsed) return null;
  return srcHashOfValues([...fields.map((k) => parsed.fm[k] ?? ''), parsed.body]);
}

// The stored srcHash of an existing translation file's raw text, or null
// (legacy file from before hash tracking).
export function storedHashIn(raw) {
  const m = raw.match(/^srcHash:\s*['"]?([0-9a-f]{12})['"]?\s*$/m);
  return m ? m[1] : null;
}

// js-yaml leaves a hash like 818631094e44 unquoted (not a float under its YAML
// 1.1 rules), but Astro's YAML 1.2 parser reads it as scientific notation and
// the number then fails the schema's z.string() — twelve translations broke the
// build that way on 2026-08-01. Quote the line ourselves; the bare-hex pattern
// can't touch a line js-yaml already quoted.
export function quoteSrcHashLine(fmText) {
  return fmText.replace(/^srcHash: ([0-9a-f]{12})$/m, "srcHash: '$1'");
}

// Stamp a srcHash into a LEGACY translation file (one written before hash
// tracking) without re-translating it — the in-place backfill that
// scripts/backfill-src-hashes.mjs did for posts on 2026-08-01. Inserted after
// the `slug:` line, always quoted (see quoteSrcHashLine). Returns the new text,
// or null when the file already carries a hash or has no `slug:` line to
// anchor on. Line endings of the file are preserved.
export function stampSrcHash(raw, hash) {
  if (storedHashIn(raw)) return null;
  const out = raw.replace(/^(slug:[^\r\n]*)(\r?\n)/m, `$1$2srcHash: '${hash}'$2`);
  return storedHashIn(out) === hash ? out : null;
}
