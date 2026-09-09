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
const PAREN = /\*\*([^*\n]+?)([(（][^)）\n]*[)）])\*\*(?=[^\s*])/g;
// **text、** → **text**、               — closer moved before trailing punctuation
const PUNCT = /\*\*([^*\n]+?)([、。，,.:：;；!！?？…·]+)\*\*(?=[^\s*])/g;
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

// Each rule with the replacement that lifts its punctuation out of the span.
const MOVES = new Map([[PAREN, '**$1**$2'], [PUNCT, '**$1**$2'], [LEAD, '$1**'], [TRAIL, '**$1']]);
// Tried in order; the first rewrite that actually renders wins.
const SEQUENCES = [[PAREN], [PUNCT], [LEAD, TRAIL], [LEAD], [TRAIL], [PAREN, PUNCT], [LEAD, TRAIL, PAREN, PUNCT]];

/**
 * Repair one line's unclosable bold. Returns the line unchanged when there is
 * nothing wrong with it, or when no rewrite makes it render — a line we cannot
 * fix is left exactly as the translator wrote it rather than mangled.
 */
export function fixCjkBoldLine(line) {
  if (!line.includes('**') || rendersBold(line)) return line;
  for (const seq of SEQUENCES) {
    let candidate = line;
    for (const re of seq) candidate = candidate.replace(re, MOVES.get(re));
    if (candidate !== line && rendersBold(candidate)) return candidate;
  }
  return line;
}

/** Same, over a whole body. Line-by-line: bold never spans a line break. */
export function fixCjkBold(body) {
  return String(body ?? '').split('\n').map(fixCjkBoldLine).join('\n');
}
