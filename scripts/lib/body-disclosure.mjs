// The in-body AI disclosure blockquote that generate.mjs prepended to every
// guide until 2026-09. PostArticle.astro already renders the same disclosure
// as a localized <details> on EVERY post, so 922 live pages said it twice —
// the 08-31 SEO audit's cheapest finding. This removes the body copy only.
//
// Language-agnostic by SHAPE, not by wording: the disclosure is the first
// CONTENT line of the body, it is a blockquote, and it links to /about. A
// pull-quote (no /about link) and an /about link in prose (not a leading
// blockquote) both have to survive, which is what the tests pin down.
//
// Two things this got wrong on the first attempt, both caught by running it
// against the corpus rather than by reading it:
//   1. Bodies begin with a blank line — every translation and 601 of 883
//      English files. Anchoring at index 0 matched 282 and missed 601.
//   2. [^\n]* swallows the \r of a CRLF file, so the slice left a lone \n
//      behind and the file ended up with mixed line endings. Use [^\r\n]*.
const DISCLOSURE_LINE = /^>[ \t]*\*\*[^\r\n]*\]\(\/about\)[^\r\n]*/;
const LEADING_BLANKS = /^(?:[ \t]*\r?\n)*/;

/** @param {string} body @returns {{ body: string, removed: string | null }} */
export function stripBodyDisclosure(body) {
  const s = String(body);
  const lead = s.match(LEADING_BLANKS)[0];
  const rest = s.slice(lead.length);
  const m = rest.match(DISCLOSURE_LINE);
  if (!m) return { body: s, removed: null };
  // Drop the line, then at most one blank line after it — never more, so a
  // deliberate gap in the prose below is preserved. The leading blank line the
  // body already had stays, so a stripped file looks like a never-stamped one.
  const after = rest.slice(m[0].length).replace(/^(?:[ \t]*\r?\n){1,2}/, '');
  return { body: lead + after, removed: m[0] };
}

/** @param {string} body */
export function hasBodyDisclosure(body) {
  const s = String(body);
  return DISCLOSURE_LINE.test(s.slice(s.match(LEADING_BLANKS)[0].length));
}
