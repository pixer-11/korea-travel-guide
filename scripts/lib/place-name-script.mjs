// Is each translated place name written in its language's own script?
//
// On 2026-10-05 a publish run stored Canggu's Chinese name as "створ"
// (Cyrillic) and nothing looked: places.json feeds every localized page that
// names the area. A wrong-PLACE answer (Surin → シーサケート, a different
// province) cannot be caught this way; a wrong SCRIPT can, for free.
//   ko: Hangul · ja: kana or kanji · zh: hanzi, no kana/Hangul · es: Latin
// Cyrillic is never right in any of the four.

const CYR = /[Ѐ-ӿ]/;
const OK = {
  ko: (s) => /[가-힣]/.test(s) && !/[ぁ-んァ-ヶ]/.test(s) && !CYR.test(s),
  ja: (s) => /[ぁ-んァ-ヶ一-鿿]/.test(s) && !/[가-힣]/.test(s) && !CYR.test(s),
  zh: (s) => /[一-鿿]/.test(s) && !/[ぁ-んァ-ヶ가-힣]/.test(s) && !CYR.test(s),
  es: (s) => /[A-Za-zÀ-ÿ]/.test(s) && !/[ぁ-んァ-ヶ一-鿿가-힣]/.test(s) && !CYR.test(s),
};

/** The languages of `entry` ({ko, ja, es, zh}) that are missing or in the wrong script. */
export function wrongScript(entry) {
  return Object.keys(OK).filter((l) => !(typeof entry?.[l] === 'string' && entry[l].trim() && OK[l](entry[l])));
}
