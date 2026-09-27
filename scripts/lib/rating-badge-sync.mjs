// Keep the review-signal badge in a meta description TRUE.
//
// generate.mjs stamps "4.7★ (706 reviews)" into the description from the
// stored Google figures (see serp.mjs). The weekly refresh then updates
// place.rating and place.userRatingsTotal — and never touched the sentence, so
// 88 English descriptions and ~280 translated ones were quoting a review count
// from the day they were written. The number only ever grows, so the page was
// quietly understating the venue and, once the rating moved, stating something
// false outright (found 2026-08-06).
//
// The badge has the same shape in every language, because the number and the ★
// survive translation while the words around them do not:
//   en 4.7★ (706 reviews)      ko 4.7★ (리뷰 706개)
//   ja 4.7★(706件のレビュー)     zh 4.7★（706条评价）      es 4.7★ (706 reseñas)
// So: rewrite the rating and the digits, keep everything else exactly as the
// translator wrote it. No API call, no re-translation.

// rating ★ ( … digits … )  — ASCII or full-width parentheses.
//
// The decimal separator has to be part of the pattern, not assumed. Spanish
// writes the badge the way Spanish writes numbers — "4,2★ (27.451 reseñas)" —
// and a rating pattern of `\d(?:\.\d)?` matches only the "2" of "4,2". The
// rewrite then started mid-number and produced "4,4.2★ (27,451.451 reseñas)".
// Found 2026-08-17 on 129 of the 398 Spanish descriptions; it had never shipped
// only because refresh.yml was not staging src/content/i18n at all, so every
// corrupted file was discarded on the runner. Fixing that staging without this
// would have published the corruption to every Spanish page carrying a badge.
//
// The star is not always "★". The translator writes it in words about a
// quarter of the time in Chinese — "4.4星（29,423条评价）", "4.5星评分（…）" — and
// now and then in Korean ("4.5점(리뷰 1,234건)") and Japanese ("4.5つ星(…)").
// None of those matched, so on 2026-09-28 266 Chinese, 18 Korean and 5
// Japanese descriptions still quoted their day-one figures, and every weekly
// refresh left them un-restamped: 143 of the 156 translations the refresh
// sent to full re-translation in 30 days were exactly this.
const STAR = String.raw`(?:★|星(?:评分)?|つ星|점)`;
const BADGE = new RegExp(
  String.raw`(\d(?:[.,]\d)?)(\s*${STAR}\s*[（(][^）)]*?)([\d][\d.,，]*)([^）)]*?[）)])`,
);
// A worded star ("星", "점") is only a badge with a decimal rating in front of
// it: "4.5점(리뷰 1,234건)" is a rating, "10점(만점)" is not.
function matchBadge(s) {
  const m = BADGE.exec(s);
  if (!m) return null;
  if (!/★/.test(m[2]) && !/[.,]/.test(m[1])) return null;
  return m;
}
// Anything that LOOKS like a rating with a count — used to refuse a re-stamp
// when a badge is there in a shape this file cannot rewrite. Re-stamping then
// would mark wrong figures as current.
const BADGE_LIKE = /\d[.,]\d[^\d（(]{0,6}[（(][^）)]*\d[^）)]*[）)]/;

const groupDigits = (n) => Number(n).toLocaleString('en-US');
// Spanish groups with "." and decimalises with "," — the exact mirror of en.
const groupDigitsEs = (n) => Number(n).toLocaleString('de-DE');

/**
 * Rewrite the badge's figures in one description.
 * Returns the new text, or null when there is no badge to update.
 * Leaves the text alone when the figures already match — callers use the null
 * to decide whether a file needs writing at all.
 */
export function resyncBadge(text, rating, total) {
  const s = String(text ?? '');
  const m = matchBadge(s);
  if (!m) return null;
  if (!(Number(rating) > 0) || !(Number(total) > 0)) return null;

  // Each figure keeps ITS OWN convention, read off the text rather than assumed
  // from the language. They genuinely disagree inside one badge: Busan Tower's
  // Spanish description reads "4.2★ (9.727 reseñas)" — an English decimal on
  // the rating, a Spanish group separator on the count. Deciding both from the
  // rating rewrote that count as "9,727", which a Spanish reader parses as nine
  // point seven two seven.
  const newRating = Number(rating).toFixed(1).replace('.', m[1].includes(',') ? ',' : '.');
  // Match the digit grouping already in the text — but only when the old number
  // was big enough to HAVE grouping. "706" carries no evidence either way, and
  // reading it as "this text does not group" would drop the comma from every
  // venue that crossed a thousand reviews since it was written.
  const oldTotal = Number(String(m[3]).replace(/[.,，]/g, ''));
  const grouped = oldTotal >= 1000 ? /[.,，]/.test(m[3]) : true;
  const groupsWithPeriod = /\.\d{3}(?:\D|$)/.test(m[3]);
  const newTotal = grouped ? (groupsWithPeriod ? groupDigitsEs(total) : groupDigits(total)) : String(total);

  const out = s.slice(0, m.index) + `${newRating}${m[2]}${newTotal}${m[4]}` + s.slice(m.index + m[0].length);
  return out === s ? null : out;
}

/** The figures a badge currently claims, or null when there is no badge. */
export function readBadge(text) {
  const m = matchBadge(String(text ?? ''));
  if (!m) return null;
  return {
    rating: Number(String(m[1]).replace(',', '.')),
    total: Number(String(m[3]).replace(/[.,，]/g, '')),
  };
}

/**
 * True when two descriptions differ ONLY in their badge figures.
 * This is the safety catch for re-stamping a translation's srcHash: it lets the
 * sync say "this translation is still current" when the only English change was
 * a number it just copied across, and refuses when the prose itself moved.
 */
export function differsOnlyInBadge(before, after) {
  const strip = (s) => {
    const t = String(s ?? '');
    const m = matchBadge(t);
    return m ? t.slice(0, m.index) + '★' + t.slice(m.index + m[0].length) : t;
  };
  return before !== after && strip(before) === strip(after);
}

/**
 * Whether a translation's description is still current after an English
 * badge-only change, given the live figures: its badge now carries them, or it
 * never quoted figures at all. False when something rating-shaped is there that
 * this file cannot read — re-stamping would then certify figures nobody checked.
 */
export function translationBadgeCurrent(text, rating, total) {
  const s = String(text ?? '');
  const b = readBadge(s);
  if (b) return b.rating === Number(Number(rating).toFixed(1)) && b.total === Number(total);
  return !BADGE_LIKE.test(s);
}
