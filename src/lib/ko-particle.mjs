// 은/는 for a Korean noun: 은 after a final consonant (받침), 는 after a vowel.
// "태국은 · 싱가포르는 · 호주는 · 베트남은". A name that does not end in a Hangul
// syllable (an untranslated "Laos") gets the neutral 는 — no country with posts
// is in that state, and add-country translates the name before the first post.
export function eunNeun(word) {
  const s = String(word ?? '');
  const c = s.charCodeAt(s.length - 1);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0 ? '은' : '는';
}
