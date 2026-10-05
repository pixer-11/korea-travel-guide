import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';

// CommonMark refuses to CLOSE ** when punctuation sits immediately before the
// closer and a word character follows it. In CJK that is the normal way to
// write a glossed proper noun:
//
//   **왓 랏차부라나(Wat Ratchaburana)**와  →  literal asterisks on the page
//   **サラデーン駅(Sala Daeng station)**まで
//   **内堡（Inner Fort）**是
//
// 145 files were repaired by hand on 2026-08-01 and eleven more arrived with
// the translations written since, because nothing stopped the translator
// producing them (found 2026-08-06). The fix is mechanical — move the closer
// in front of the parenthetical or the trailing punctuation, which leaves the
// same words bold and renders correctly — so it belongs in the write path, not
// in a repair script that has to be remembered.

const OPTS = { extensions: [gfm()], htmlExtensions: [gfmHtml()] };

/** True when a line's ** all resolve; literal asterisks in the HTML mean they did not. */
export const rendersBold = (line) => !micromark(line, OPTS).includes('**');

// **text(gloss)** → **text**(gloss)     — closer moved before the parenthetical
// Either rule's closer may also be followed by an ITALIC opener: "**Other Dutch
// wrecks:** *Vergulde Draeck*" came back in Chinese as "**其他荷兰沉船：***镀金龙号*"
// (no space after a full-width colon), and the old lookahead [^\s*] refused the
// following * — so the guide failed three attempts and shipped with no Chinese
// page at all, and every Chinese list linking it 404'd (2026-09-29,
// fremantle-wa-shipwrecks-museum). One * is allowed; ** still is not.
const PAREN = /\*\*([^*\n]+?)([(（][^)）\n]*[)）])\*\*(?=[^\s*]|\*(?!\*))/g;
// **text、** → **text**、               — closer moved before trailing punctuation
const PUNCT = /\*\*([^*\n]+?)([、。，,.:：;；!！?？…·]+)\*\*(?=[^\s*]|\*(?!\*))/g;
// **「text」** → 「**text**」            — brackets pushed outside the emphasis.
// The mirror image of the two above: punctuation immediately AFTER the opener,
// with a word character in front of it, stops ** from OPENING at all. That is
// how a glossed proper noun written 尾根道**「神々の小径」** ships with literal
// asterisks even though nothing is wrong with its closer (found 2026-09-07, ja).
// The two lists gained the STRAIGHT ASCII quotes on 2026-09-09: a Chinese guide
// shipped 著名的**"存钱猪"雷切尔（…）**铜像 written with " rather than “, and the
// repair tool called it unfixable for two days because only the curly and CJK
// quotes were listed. Quotes only — the first attempt used the Unicode bracket
// categories (Ps/Pe) instead, which swept in ASCII "(" and made LEAD treat the
// CLOSING ** of `**「神々の小径」**(センティエロ)` as an opener because a paren
// happened to follow it. That line's test caught it. A quote is ambidextrous
// and needs naming; a paren is not, and the pairs already listed suffice.
const LEAD = /\*\*(["'「『（【〈《〔“‘]+)(?=[^\s*])/g;
const TRAIL = /(["'」』）】〉》〕”’]+)\*\*/g;

// *italic* inside or against a bold span. CJK typesetting has no italics, and a
// single * inside **…** hides the span from every rule above: the retry of the
// Fremantle guide came back "**桑索号蒸汽船（SS *Xantho*）：**一艘…" three times
// (2026-09-30). Dropping the italic markers is the LAST resort, tried only after
// every non-destructive rewrite failed and kept only if the line then renders.
// Only italics INSIDE a bold span are touched — the first version stripped the
// whole line, so a Spanish "…lee *Don Quijote*." lost an italic that had nothing
// to do with the broken bold, and a list marker "* " paired with the next * and
// turned the list into a paragraph (Codex, 2026-09-30). An italic opener must be
// followed by a non-space, which a list marker never is.
const ITALIC = /\*\*((?:[^*\n]|\*(?![*\s])[^*\n]*?[^*\s]\*(?!\*))+?)\*\*/g;
const unItalic = (_, inner) => `**${inner.replace(/\*(?![*\s])([^*\n]*?[^*\s])\*(?!\*)/g, '$1')}**`;

// Each rule with the replacement that lifts its punctuation out of the span.
const MOVES = new Map([[PAREN, '**$1**$2'], [PUNCT, '**$1**$2'], [LEAD, '$1**'], [TRAIL, '**$1'], [ITALIC, unItalic]]);
// Tried in order; the first rewrite that actually renders wins.
const SEQUENCES = [[PAREN], [PUNCT], [LEAD, TRAIL], [LEAD], [TRAIL], [PAREN, PUNCT], [LEAD, TRAIL, PAREN, PUNCT],
  [ITALIC], [ITALIC, PUNCT], [ITALIC, PAREN], [ITALIC, PAREN, PUNCT], [ITALIC, LEAD, TRAIL, PAREN, PUNCT]];

/**
 * Repair one line's unclosable bold. Returns the line unchanged when there is
 * nothing wrong with it, or when no rewrite makes it render — a line we cannot
 * fix is left exactly as the translator wrote it rather than mangled.
 */
// The regexes above look at one span at a time, so with two bold spans on a
// line PUNCT can take the FIRST span's closer and the SECOND span's opener for
// a pair — "…时候**，所以…比周末好。**周末…" — and every sequence fails. The zh
// Mustafa's kebab guide was refused three times on exactly that (10-03), and
// shipped with no Chinese page. Pairing the markers in order (1st with 2nd,
// 3rd with 4th) and moving each span's trailing punctuation out cannot cross
// spans. Tried first; the per-span rules stay for what this does not cover.
// Sentence punctuation only. A closing bracket or quote has its opener inside
// the span, and moving just the closer out splits the pair — PAREN and TRAIL
// below handle those whole.
const TRAIL_PUNCT = /[、。，,.:：;；!！?？…·]+$/;
function pairwise(line) {
  // *** (bold + italic) and `code` split differently from a plain ** pair;
  // leave those lines to the per-span rules (Codex, 10-03: ***C。*** came out
  // as ***C**。* with the italic stars showing).
  // Exactly three, though: "****" is two plain spans side by side — the source
  // "**KRL Commuter Line:** **Palmerah**" loses its space in Chinese and became
  // "**KRL通勤铁路：****Palmerah**", which this used to skip, so the zh Jakarta
  // guide was refused three times on every run (2026-10-05).
  if (/(?<!\*)\*{3}(?!\*)/.test(line) || line.includes('`')) return line;
  const parts = line.split('**');
  if (parts.length % 2 === 0) return line; // an odd number of markers: no pairing to trust
  for (let i = 1; i < parts.length; i += 2) {
    const m = TRAIL_PUNCT.exec(parts[i]);
    if (!m || m.index === 0 || /^\s/.test(parts[i + 1] ?? '')) continue;
    parts[i] = parts[i].slice(0, m.index);
    parts[i + 1] = m[0] + parts[i + 1];
  }
  return parts.join('**');
}

export function fixCjkBoldLine(line) {
  if (!line.includes('**') || rendersBold(line)) return line;
  const paired = pairwise(line);
  if (paired !== line && rendersBold(paired)) return paired;
  // The per-span rules, on the line as written and then on the paired one (a
  // bracket in one span, a full stop in another).
  for (const start of paired !== line ? [line, paired] : [line]) {
    for (const seq of SEQUENCES) {
      let candidate = start;
      for (const re of seq) candidate = candidate.replace(re, MOVES.get(re));
      if (candidate !== line && rendersBold(candidate)) return candidate;
    }
  }
  return line;
}

/** Same, over a whole body. Line-by-line: bold never spans a line break. */
export function fixCjkBold(body) {
  // Lines inside a fenced code block are code: a ** there is literal, and a
  // line read on its own cannot know it is fenced (Codex, 10-03).
  let fenced = false;
  return String(body ?? '').split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return line; }
    return fenced ? line : fixCjkBoldLine(line);
  }).join('\n');
}

// The whole-body check the audit and the translator share, so the two cannot
// drift. A bare regex can't tell an opener from a closer (`。**次**` is legal),
// so ask the renderer: if `**` survives into the HTML, a delimiter failed.
// Returns the first offending line, or null when every ** renders.
const OPTS_HTML = { extensions: [gfm()], htmlExtensions: [gfmHtml()], allowDangerousHtml: true };
export function brokenBoldLine(body) {
  const text = String(body ?? '');
  if (!text.includes('**')) return null;
  if (!micromark(text, OPTS_HTML).includes('**')) return null;
  for (const line of text.split('\n')) {
    if (line.includes('**') && micromark(line, OPTS_HTML).includes('**')) return line;
  }
  return text.split('\n').find((x) => x.includes('**')) || '**';
}

/** 렌더 뒤에도 글자로 남는 ** 의 개수. 코드 표기 안의 ** 처럼 원문에도 있는 것까지 센다. */
export function literalBoldCount(body) {
  const text = String(body ?? '');
  if (!text.includes('**')) return 0;
  return (micromark(text, OPTS_HTML).match(/\*\*/g) || []).length;
}
