// What must not happen to a card, a cell or a photo credit at phone width, judged
// from the numbers scripts/live/phone-fit.mjs reads in the page. Kept apart from
// the browser so the judgement can be tested both ways in CI (phone-fit.test.mjs).

/** Under this is sub-pixel rounding, not a defect. */
export const SLACK = 0.75;

/** How far `right` runs past `edge`; 0 when it stays inside. */
export function pastBy(right, edge) {
  const over = right - edge;
  return over > SLACK ? over : 0;
}

/**
 * How far a text runs past its own cell. Chrome trims half of a full-width closing
 * mark at the end of a line and the text range still counts its whole advance, so
 * that half is not the words leaving the cell (福冈圣诞市集（…）, zh at 390px).
 * The curly closing quotes are full-width too when the text is Chinese, Japanese
 * or Korean, and only then: 阿雷佐“圣诞之城” read 0.88px past a cell its own box
 * sat exactly inside (zh /events at 360px, 2026-11-13). In Latin text ” is a
 * narrow mark that nothing trims, so there an overrun is still an overrun.
 */
const FULL_WIDTH_CLOSER = /[）」』】〕》〉、。，．！？：；]/;
const CJK = /[぀-ヿ㐀-鿿가-힯]/;
export function wordsPastCell({ right, edge, text, px }) {
  const over = pastBy(right, edge);
  const trimmed = FULL_WIDTH_CLOSER.test(text) || (/[”’]/.test(text) && CJK.test(text));
  return trimmed && over <= px * 0.55 ? 0 : over;
}

/** A one-line credit that lost its tail: the licence is the part that goes. */
export function creditCut({ scrollWidth, clientWidth }) {
  return scrollWidth - clientWidth > 1;
}

/**
 * The twelve bars on a country card.
 * @param {{ stripRight: number, lastRight: number, bars: number[], labels: {left: number, right: number}[] }} strip
 *   `bars` are the twelve widths; `labels` are the visible month numbers, left to right.
 * @returns {string[]} what is wrong, empty when nothing is.
 */
export function monthStripProblems({ stripRight, lastRight, bars, labels }) {
  const out = [];
  const over = pastBy(lastRight, stripRight);
  if (over) out.push(`12월이 띠 밖으로 ${over.toFixed(1)}px`);
  // A two-digit label must not widen its own month: the bars are the chart.
  const ratio = Math.max(...bars) / Math.min(...bars);
  if (ratio > 1.15) out.push(`막대 폭이 제각각(최대/최소 ${ratio.toFixed(2)})`);
  for (let i = 1; i < labels.length; i++) {
    const gap = labels[i].left - labels[i - 1].right;
    if (gap < 1) { out.push(`월 숫자가 붙음(간격 ${gap.toFixed(1)}px)`); break; }
  }
  return out;
}
