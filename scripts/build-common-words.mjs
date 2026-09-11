// Which words are ordinary English, measured instead of listed by hand.
//
// The event hero search picks ONE anchor word out of a title and asks Commons
// for it. When that word is an ordinary word the archive answers with ordinary
// things, and the filename check waved them through because the anchor was not
// on COMMON_ANCHOR's hand-written list:
//
//   "Quick Style India Tour"   → anchor "quick"     → Shoeburyness Quick Fire Battery
//   "One Universe Festival"    → anchor "one"       → a COSCO container ship
//   "Dubai Summer Surprises"   → anchor "surprises" → an Emirates 777 in 2003 livery
//
// That list can never be finished: every new event brings a new ordinary word,
// and adding them one at a time is how the same defect keeps coming back. So
// the question is answered from data instead.
//
// The signal is CASE. Our guides are English prose, so an ordinary word appears
// in lower case mid-sentence ("a quick walk", "one of the best", "mint tea")
// while a name almost never does. Counting only mid-sentence occurrences keeps
// a capitalised sentence opener from making every word look like a name.
//
// Measured over the corpus on 2026-09-11:
//
//   quick 2552 · one 4188 · style 806 · open 3135 · miss 170 · dance 101
//   film 64 · moon 26 · surprises 21 · independence 14 · snooker 12 · comic 9
//   mint 8 · forever 6 · athletics 4          ← all ordinary
//   weeknd 3 · lalala 2 · mefcc 2 · biff 2 · pestapora 1                ← names
//   shakira 0 · evanescence 0 · ankalaev 0 · yunho 0 · masskara 0 · faker 0
//
// The threshold sits at 4 because that is the widest gap in the middle: it
// takes "athletics" and leaves "weeknd", the lowest-scoring word we must keep
// treating as identity.
//
//   node scripts/build-common-words.mjs           # rewrite data/common-words.json
//   node scripts/build-common-words.mjs --check   # fail if the file is stale
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'src/content/posts';
const OUT = 'data/common-words.json';
export const THRESHOLD = 4;

// Only the BODY, and only prose.
//
// Counting the whole file made "malone" an ordinary word: the frontmatter
// carries hero URLs, slugs and credits, and those spell every proper noun in
// lower case ("post_malone_at_rolling_loud_2019.jpg"). That is the exact
// opposite of the signal we are after, and it would have turned the Post
// Malone guide's own photo into "some other act" (caught by the regression
// test the same hour, 2026-09-11). Frontmatter is dropped, then URLs, then
// markdown link targets.
export function prose(text) {
  const t = String(text).replace(/\r\n/g, '\n');
  const end = t.startsWith('---') ? t.indexOf('\n---', 3) : -1;
  const body = end < 0 ? t : t.slice(end + 4);
  return body
    .replace(/https?:\/\/\S+/g, ' ')      // bare links
    .replace(/\]\([^)]*\)/g, '] ')        // markdown link targets
    .replace(/`[^`]*`/g, ' ');            // inline code and file names
}

export function countLowercase(text, into = new Map()) {
  // A capital right after ., !, ?, :, ;, a newline, a quote or an opening
  // bracket is a sentence opener and says nothing about the word.
  const re = /([.!?:;\n"'(\[]\s*)?([A-Za-z][a-z]{2,})/g;
  let m;
  while ((m = re.exec(prose(text)))) {
    const w = m[2];
    if (/^[A-Z]/.test(w)) continue;
    const k = w.toLowerCase();
    into.set(k, (into.get(k) ?? 0) + 1);
  }
  return into;
}

export function buildWords(dir = DIR) {
  const counts = new Map();
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  for (const f of files) countLowercase(readFileSync(join(dir, f), 'utf8'), counts);
  const words = [...counts.entries()]
    .filter(([, c]) => c >= THRESHOLD)
    .map(([w]) => w)
    .sort();
  return { files: files.length, words };
}

if (process.argv[1]?.endsWith('build-common-words.mjs')) {
  const { files, words } = buildWords();
  // An empty corpus must not be allowed to write an empty list: every anchor
  // would become a name and the check this feeds would pass everything.
  if (!files || words.length < 1000) {
    console.log(`refusing to write: ${files} post(s) gave only ${words.length} word(s) — is src/content/posts empty?`);
    process.exit(1);
  }
  const payload = {
    _comment: 'Ordinary English words, measured from our own guides (mid-sentence lower case >= threshold). Rebuild with scripts/build-common-words.mjs — do not hand-edit.',
    threshold: THRESHOLD,
    posts: files,
    words,
  };
  const next = JSON.stringify(payload, null, 1) + '\n';
  const prev = (() => { try { return readFileSync(OUT, 'utf8'); } catch { return ''; } })();

  if (process.argv.includes('--check')) {
    const same = prev === next;
    console.log(same
      ? `✓ ${OUT} is current (${words.length} words from ${files} posts)`
      : `✗ ${OUT} is stale — run node scripts/build-common-words.mjs`);
    process.exit(same ? 0 : 1);
  }
  writeFileSync(OUT, next, 'utf8');
  console.log(`${words.length} ordinary word(s) from ${files} post(s) → ${OUT}`);
}
