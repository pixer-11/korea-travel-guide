// Reads rendered HTML the way rehype-cjk-quotes.mjs fixes it, for the live
// check (scripts/live/cjk-quotes.mjs): each block (p, li, heading, cell,
// caption) counts only its own text — a nested block counts on its own — and
// code is skipped. A regex that takes <li>…</li> stops at the first </li> of a
// nested list and merges two blocks' quotes (Codex, 11-04), so this walks the
// tags with a stack instead.

const BLOCK = new Set(['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th', 'dt', 'dd', 'figcaption', 'caption', 'summary']);
const SKIP = new Set(['code', 'pre', 'kbd', 'samp', 'script', 'style']);
const ENTITY = { '&ldquo;': '“', '&rdquo;': '”', '&#8220;': '“', '&#8221;': '”', '&#x201c;': '“', '&#x201d;': '”' };

/** Every block's own text, in document order. */
export function blockTexts(html) {
  const out = [];
  const stack = [];
  let skip = 0;
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>|<!--[\s\S]*?-->|[^<]+/g)) {
    const [tok, close, rawName] = m;
    if (!rawName) {
      if (tok.startsWith('<!--') || skip || !stack.length) continue;
      stack[stack.length - 1].text += tok.replace(/&(ldquo|rdquo|#822[01]|#x201[cd]);/gi, (e) => ENTITY[e.toLowerCase()]);
      continue;
    }
    const name = rawName.toLowerCase();
    if (SKIP.has(name)) { if (close) skip = Math.max(0, skip - 1); else if (!tok.endsWith('/>')) skip++; continue; }
    if (!BLOCK.has(name) || skip) continue;
    if (!close) { stack.push({ tag: name, text: '' }); continue; }
    // Close the matching block (and any left open inside it).
    const at = stack.map((b) => b.tag).lastIndexOf(name);
    if (at === -1) continue;
    for (const b of stack.splice(at).reverse()) out.push(b.text);
  }
  for (const b of stack.reverse()) out.push(b.text);
  return out;
}

/** Blocks whose even number of double quotes does not alternate “ ” “ ”. */
export function quoteOrderIssues(html) {
  let read = 0;
  const bad = [];
  for (const text of blockTexts(html)) {
    const marks = [...text].filter((ch) => ch === '“' || ch === '”');
    read += marks.length;
    if (!marks.length || marks.length % 2) continue;
    if (marks.every((ch, i) => ch === (i % 2 ? '”' : '“'))) continue;
    const at = text.search(/[“”]/);
    bad.push(text.slice(Math.max(0, at - 6), at + 24));
  }
  return { read, bad };
}
