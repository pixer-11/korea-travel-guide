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

/**
 * Repair one line's unclosable bold. Returns the line unchanged when there is
 * nothing wrong with it, or when no rewrite makes it render — a line we cannot
 * fix is left exactly as the translator wrote it rather than mangled.
 */
export function fixCjkBoldLine(line) {
  if (!line.includes('**') || rendersBold(line)) return line;
  for (const re of [PAREN, PUNCT]) {
    const candidate = line.replace(re, '**$1**$2');
    if (candidate !== line && rendersBold(candidate)) return candidate;
  }
  // Both rules in sequence, for a line carrying one of each.
  const both = line.replace(PAREN, '**$1**$2').replace(PUNCT, '**$1**$2');
  return both !== line && rendersBold(both) ? both : line;
}

/** Same, over a whole body. Line-by-line: bold never spans a line break. */
export function fixCjkBold(body) {
  return String(body ?? '').split('\n').map(fixCjkBoldLine).join('\n');
}
