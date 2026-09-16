// A photo credit is a caption, not a licence agreement.
//
// Wikimedia's `Artist` metadata field is free text, and a few photographers
// fill it with their whole usage request: "This Photo was taken by Wolfgang
// Moroder. Feel free to use my photos, but please mention me as the author and
// send me a message. This image is not in the public domain…" (806 characters).
// commonsCandidates pastes that straight into `Photo: ${artist} / Wikimedia
// Commons (…)`, so 22 live guides carried a paragraph of instructions under
// their hero photo where a name belongs (found 2026-09-16 on the Annecy
// basilica).
//
// Attribution is still owed in full — the name, the source and the licence are
// all kept, and `source` still links the Commons page where the author's own
// terms are stated. What is dropped is the request addressed to re-users, which
// is not part of the credit a reader needs.

const MAX = 60; // a name, not a sentence

// "This Photo was taken by X", "This picture has been taken by X".
const TAKEN_BY = /(?:photo|picture|photograph|image|file)\s+(?:was\s+|has\s+been\s+)?taken\s+by\s+([^.;,(\n]{2,60})/i;
const AUTHOR = /\bauthor\s*:\s*([^.;,(\n]{2,60})/i;

// Where a name stops and a message to re-users begins. Most of these blobs are
// the name followed immediately by the request, with no punctuation between
// them ("Ad Meskens You are free to use this picture…").
const REQUEST = /\s*\b(you are free|feel free|i'?d appreciate|i would appreciate|please|contact|if you|this (?:image|file|photo|picture)|licen[cs]e|permission|do not|attribution|example|e-?mail)\b|\s*©/i;

// A montage credits each source file: "File:A.JPG: Gryffindor File:B.JPG: Gryffindor".
const FILE_CREDIT = /File:[^:]+:\s*([^\n]{2,40}?)(?=\s+File:|$)/gi;

/** The person behind a long Commons `Artist` blob. Pure. */
export function shortArtist(artist) {
  const s = String(artist ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (s.length <= MAX) return s;

  const taken = s.match(TAKEN_BY) || s.match(AUTHOR);
  if (taken) {
    const name = taken[1].trim().replace(/\s+(and|und|et)$/i, '').trim();
    if (name && name.length <= MAX) return name;
  }

  // Every source file credited to the same person: that person.
  const names = [...s.matchAll(FILE_CREDIT)].map((m) => m[1].trim());
  if (names.length > 1 && new Set(names).size === 1 && names[0].length <= MAX) return names[0];

  // The name in front of the request.
  const cut = s.split(REQUEST)[0].trim().replace(/[,;:.]$/, '');
  if (cut && cut.length <= MAX) return cut;

  const first = s.split(/(?<=[.!?])\s/)[0];
  return (first.length <= MAX ? first : s.slice(0, MAX).replace(/\s\S*$/, '')).trim();
}

/**
 * Shorten a built credit line, keeping its "/ SOURCE (LICENCE)" tail intact.
 * The tail is matched at the END of the string: these blobs quote "/ Wikimedia
 * Commons" inside the author's own example attribution, and a non-greedy match
 * cut there instead, leaving half a sentence in the credit.
 * Anything already short, or not of the "Photo: X / Y (Z)" shape, comes back
 * unchanged. Pure.
 */
export function shortCredit(credit) {
  const s = String(credit ?? '');
  if (s.length <= 160) return s;
  const m = s.replace(/\s+/g, ' ').match(/^Photo:\s*([\s\S]+)\s*\/\s*([^/]*\([^()]*\))\s*$/);
  if (!m) return s;
  const name = shortArtist(m[1]);
  return name ? `Photo: ${name} / ${m[2]}` : s;
}
