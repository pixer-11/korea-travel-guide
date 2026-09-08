// ─────────────────────────────────────────────────────────────
//  ONE SAFE WAY TO CHANGE A POST'S FRONTMATTER
//
//  Sixty-eight scripts write files under src/content, and seven of them edit
//  frontmatter with hand-written patterns. Every one of those seven carries the
//  same bugs, because each reinvented the same job:
//
//    /^draft:\s*true\s*$/m       also matches a `draft: true` inside a fenced
//                                code sample in the BODY, and edits that instead
//    /^heldReason:/m             misses `heldReason : cancelled`, which is valid
//                                YAML — a cancelled event could be republished
//    /^heroImage:(...)*$/m       misses `heroImage :` and `heroImage: {url: …}`,
//                                leaving the quarantined photo in place
//    title: ${JSON.stringify()}  JSON quoting is not YAML quoting
//    lookahead on `\ngallery:`   breaks the file if that key ever moves
//
//  All five were found on 2026-09-08, three of them inside a rewrite that had
//  been made that same morning to fix the previous version. The lesson is not
//  "write better patterns"; it is that this job should exist once.
//
//  So: parse, edit the frontmatter TEXT minimally, and verify the result against
//  the original before handing it back.
//
//    · the body is never re-serialised — it comes back byte for byte, which is
//      what stops the horizontal-rule bug (a body beginning with `---` was read
//      as a second frontmatter block and swallowed: 414 words became 2)
//    · untouched keys keep their exact original lines, so quoting that carries
//      meaning survives (`description: "09"` unquoted becomes the number 9 under
//      Astro's YAML parser and breaks the build)
//    · new values are serialised by js-yaml, which quotes "09", "true", "no",
//      "1.0" and the rest correctly
//    · every edit is verified by re-parsing: body identical, requested keys
//      applied, every other key unchanged. Anything else throws.
//
//  Usage:
//    import { editFrontmatter, DELETE } from './lib/frontmatter-edit.mjs';
//    const next = editFrontmatter(raw, { draft: false, heroImage: DELETE });
//    // throws if the file has no frontmatter, does not parse, or the edit
//    // would change anything it was not asked to change
// ─────────────────────────────────────────────────────────────
import matter from 'gray-matter';
import yaml from 'js-yaml';

/** Pass as a value to remove a key (and the lines indented under it). */
export const DELETE = Symbol('delete-frontmatter-key');

const FM = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;

/** `key:` at the start of a line, with the key optionally quoted, and any
 *  spacing YAML allows before the colon. */
const keyLine = (key) => new RegExp(`^["']?${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?\\s*:`);

/** One `key: value` line, quoted the way YAML needs it. Multi-line values come
 *  back as a block scalar, already indented by js-yaml. */
function serialise(key, value) {
  return yaml.dump({ [key]: value }, { lineWidth: -1, noRefs: true }).replace(/\n$/, '');
}

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The parsed frontmatter, or null if the file has none or will not parse.
 *
 * Exported so a caller that only needs to READ a field does not have to import
 * gray-matter itself: one import means one seam, and the scripts that edit
 * content are copied into temp directories by their own tests, where a bare
 * specifier does not resolve.
 */
export function readFrontmatter(raw) {
  try { return matter(raw).data ?? null; } catch { return null; }
}

/**
 * @param {string} raw       the whole .md file
 * @param {object} changes   { key: value } — value DELETE removes the key
 * @returns {string}         the new file contents
 * @throws {Error}           with a reason, if the edit cannot be made safely
 */
export function editFrontmatter(raw, changes) {
  const m = FM.exec(raw);
  if (!m) throw new Error('no frontmatter block');

  let before;
  try { before = matter(raw); } catch (err) {
    throw new Error(`frontmatter does not parse: ${String(err.message).split('\n')[0]}`);
  }

  const body = raw.slice(m[0].length);
  const keys = Object.keys(changes);

  // Walk the frontmatter line by line. A key's "block" is its own line plus
  // every following line indented deeper than it — that is how YAML nests, and
  // it is what a pattern-based strip keeps getting wrong.
  const out = [];
  const applied = new Set();
  let skipUnder = null;

  for (const line of m[1].split('\n')) {
    const indent = /^(\s*)/.exec(line)[1].length;

    if (skipUnder !== null) {
      if (line.trim() === '' || indent > skipUnder) continue;
      skipUnder = null;
    }

    const hit = keys.find((k) => indent === 0 && keyLine(k).test(line));
    if (hit) {
      skipUnder = indent;
      applied.add(hit);
      if (changes[hit] !== DELETE) out.push(serialise(hit, changes[hit]));
      continue;
    }
    out.push(line);
  }

  // A key that was asked for but is not in the file yet gets appended.
  for (const k of keys) {
    if (applied.has(k) || changes[k] === DELETE) continue;
    out.push(serialise(k, changes[k]));
  }

  const text = `---\n${out.join('\n')}\n---\n${body}`;

  // Verify against the ORIGINAL. Checking that the three flags we set came back
  // is not verification — it is the check that passed while the body was being
  // deleted.
  let after;
  try { after = matter(text); } catch (err) {
    throw new Error(`the edit produced frontmatter that does not parse: ${String(err.message).split('\n')[0]}`);
  }
  if (after.content !== before.content) throw new Error('the edit changed the body');

  for (const k of keys) {
    if (changes[k] === DELETE) {
      if (k in after.data) throw new Error(`${k} was not removed`);
    } else if (!deepEqual(after.data[k], changes[k])) {
      throw new Error(`${k} did not take the requested value`);
    }
  }
  for (const k of Object.keys(before.data)) {
    if (keys.includes(k)) continue;
    if (!deepEqual(after.data[k], before.data[k])) throw new Error(`${k} changed, and was not asked to`);
  }

  return text;
}
