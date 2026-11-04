// Rehype plugin: double quotes in Chinese, Japanese and Korean prose open and
// close the right way.
//
// The translator writes ASCII quotes (称之为"光之雨"), and Astro's smartypants
// guesses which way each one curls from the characters around it, a rule made
// for English spacing. In CJK prose it guesses wrong both ways: an opening
// quote right after a Han character becomes a closing one (”光之雨”), and a
// closing quote after a bracket or ? followed by Hangul becomes an opening one
// (“빛의 비(rain of light)“라). Measured 2026-11-04 over every zh/ja/ko body run
// through the same smartypants: 3,958 blocks with quotes were right and 2,039
// wrong. Rewriting the files would have to be repeated for every future
// translation; fixing the rendered text here covers every page in one place.
//
// Rule, per block (paragraph, list item, heading, cell, caption): if the block
// holds an even number of double quotes, they alternate “ ” “ ” in reading
// order, whatever smartypants guessed. Quotes may open in one text node and
// close in another (around **bold** or a link), so the count runs across the
// block's inline children. An odd count is left exactly as it is: it is not a
// set of pairs to guess at (the one such block is German „Guten Tag“, which is
// right). Nested double quotes (“A “B” C”) would come out alternating; there
// were none in the 6,000 blocks, and nesting in these languages uses ‘’ or 『』,
// which this never touches. Code is left alone.

const CJK_DIR = /[\\/]content[\\/][a-z-]*i18n[\\/](zh|ja|ko)[\\/]/;
const BLOCK = new Set(['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th', 'dt', 'dd', 'figcaption', 'caption', 'summary']);
const SKIP = new Set(['code', 'pre', 'kbd', 'samp', 'script', 'style']);
const QUOTES = /[“”]/g;

/** Fix the text nodes of one block, in reading order. */
export function fixBlockQuotes(block) {
  const nodes = [];
  const collect = (node) => {
    if (node.type === 'element' && SKIP.has(node.tagName)) return;
    // A nested block (a paragraph inside a list item) keeps its own count.
    if (node !== block && node.type === 'element' && BLOCK.has(node.tagName)) { fixBlockQuotes(node); return; }
    if (node.type === 'text' && /[“”]/.test(node.value)) nodes.push(node);
    for (const child of node.children ?? []) collect(child);
  };
  collect(block);
  const count = nodes.reduce((n, t) => n + t.value.match(QUOTES).length, 0);
  if (count % 2) return;
  let i = 0;
  for (const t of nodes) t.value = t.value.replace(QUOTES, () => (i++ % 2 ? '”' : '“'));
}

export default function rehypeCjkQuotes() {
  return (tree, file) => {
    const p = String(file?.path || file?.history?.[0] || '').replace(/\\/g, '/');
    if (!CJK_DIR.test(p)) return;
    const walk = (node) => {
      if (node.type === 'element' && SKIP.has(node.tagName)) return;
      if (node.type === 'element' && BLOCK.has(node.tagName)) { fixBlockQuotes(node); return; }
      for (const child of node.children ?? []) walk(child);
    };
    walk(tree);
  };
}
