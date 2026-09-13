// A body that STARTS with `---` is a body our repair tools destroy.
//
// Eleven scripts rewrite a whole post with `matter.stringify(content, data)`,
// and gray-matter re-parses the body it is handed: if that body opens with a
// `---` line, everything up to the next one is read as frontmatter and the
// article is swallowed. On 2026-09-07 a 414-word guide became 2 words that
// way. On 2026-09-13 a Toulouse guide published with a leading rule and
// check-writer-safety turned the whole Tests workflow red.
//
// The rule carries no meaning there either — the frontmatter's own `---` sits
// directly above it — so the fix belongs upstream of every repair tool: do not
// write one in the first place.
//
// Only the FIRST rule goes, and only when it is the very first thing in the
// body. A horizontal rule further down is ordinary markdown and is left alone.
const LEADING_RULE = /^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*(?:\r?\n)+/;

export function stripLeadingRule(md) {
  return String(md ?? '').replace(LEADING_RULE, '');
}
