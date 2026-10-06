// Patch a translation instead of re-translating it, when the English changed a
// little and we know exactly how.
//
// Why (2026-09-28): the weekly prose repair (repair-prose.mjs) changes one or
// two sentences in up to 60 posts. Each change moves the post's srcHash, so the
// next publish run re-translated all four languages of every one of them in
// full: on 09-26/27 that was 60 posts, 68 lines added and 124 removed in
// English, and 339 translation calls ($12.77) — about 70% of that day's bill.
// Most of those edits still have to reach the translations (an invented detail
// removed in English must go from Korean too), but by editing a sentence, not
// rewriting the page.
//
// How: repair-prose records, per post, the srcHash before and after its edit
// and the English paragraphs that changed (data/prose-patches.json).
// translate-posts sends a stale translation whose stored hash is exactly that
// "before", on a post whose hash is exactly that "after", a patch request: the
// changed English paragraphs plus the current translation, answered with
// find/replace edits. The patched page then goes through every gate a fresh
// translation goes through; anything that fails — an edit that does not match
// exactly once, a gate, a model error — falls back to the full translation.
// A patch can therefore only save money, never ship a worse page.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export const PATCHES_FILE = new URL('../../data/prose-patches.json', import.meta.url);
const KEEP_DAYS = 45;

const paras = (body) => String(body).replace(/\r\n/g, '\n').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

/** English paragraphs that left the body and that entered it (order kept). */
export function paragraphDiff(oldBody, newBody) {
  const before = paras(oldBody);
  const after = paras(newBody);
  const count = (list) => list.reduce((m, p) => m.set(p, (m.get(p) || 0) + 1), new Map());
  const a = count(after);
  const b = count(before);
  const removed = before.filter((p) => { const n = a.get(p) || 0; if (n) { a.set(p, n - 1); return false; } return true; });
  const added = after.filter((p) => { const n = b.get(p) || 0; if (n) { b.set(p, n - 1); return false; } return true; });
  return { removed, added };
}

// Every translatable field as ONE text, so a repair that edits the
// description, the Quick Answer or a FAQ answer can be patched like a body
// paragraph. The ended-event rewrite (repair-ended-event-editorial) touches
// all four, about ten posts a day, and each one used to cost four full Opus
// translations the next morning (cost review, 2026-10-06). Marker lines
// separate the fields; a patch that disturbs one is refused by fieldsOf and
// the translation is redone in full, exactly as before.
const MARK = (name) => `@@${name}@@`;
const MARK_LINE = /^@@([A-Z0-9 ]+)@@$/;

/** The translatable fields (title excluded) as one marked text. */
export function docOf({ description = '', quickAnswer = '', faq = [], body = '' } = {}) {
  const parts = [MARK('DESCRIPTION'), String(description).trim(), MARK('QUICK ANSWER'), String(quickAnswer).trim()];
  (faq || []).forEach((x, i) => parts.push(MARK(`FAQ ${i + 1}`), `Q: ${String(x?.q ?? '').trim()}\nA: ${String(x?.a ?? '').trim()}`));
  parts.push(MARK('BODY'), String(body).replace(/\r\n/g, '\n').trim());
  return parts.join('\n\n');
}

/**
 * Back from docOf's text to the fields, or null when the markers are not
 * exactly the ones docOf wrote for `faqCount` questions (an edit that touched
 * a marker, merged two fields or dropped a question).
 */
export function fieldsOf(doc, faqCount) {
  const lines = String(doc).split('\n');
  const sections = [];
  for (const line of lines) {
    const m = MARK_LINE.exec(line.trim());
    if (m) sections.push({ name: m[1], text: [] });
    else if (sections.length) sections.at(-1).text.push(line);
    else if (line.trim()) return null; // text before the first marker
  }
  const want = ['DESCRIPTION', 'QUICK ANSWER', ...Array.from({ length: faqCount }, (_, i) => `FAQ ${i + 1}`), 'BODY'];
  if (sections.map((s) => s.name).join('|') !== want.join('|')) return null;
  const text = (s) => s.text.join('\n').trim();
  const faq = [];
  for (const s of sections.slice(2, 2 + faqCount)) {
    // Exactly one Q line and one A line: a second "Q:"/"A:" pair written
    // inside an answer would otherwise ride along as part of it (Codex, 10-06).
    const t = text(s);
    if ((t.match(/^Q:/gm) || []).length !== 1 || (t.match(/^A:/gm) || []).length !== 1) return null;
    const m = /^Q:\s*([\s\S]*?)\nA:\s*([\s\S]*)$/.exec(t);
    if (!m || !m[1].trim() || !m[2].trim()) return null;
    faq.push({ q: m[1].trim(), a: m[2].trim() });
  }
  const body = text(sections.at(-1));
  if (!body) return null;
  return { description: text(sections[0]), quickAnswer: text(sections[1]), faq, body };
}

/**
 * paragraphDiff over every field, each paragraph tagged with its field. A
 * plain diff of two docOf texts compares one pool of paragraphs, so a sentence
 * that moved from the description to the Quick Answer (and one that moved the
 * other way) cancelled out and the change was never recorded: the translator
 * would have kept both stale fields under a fresh hash (Codex, 10-06).
 */
export function fieldDiff(before, after) {
  const tagged = (f) => {
    const out = [`[DESCRIPTION] ${String(f.description ?? '').trim()}`, `[QUICK ANSWER] ${String(f.quickAnswer ?? '').trim()}`];
    (f.faq || []).forEach((x, i) => out.push(`[FAQ ${i + 1}] Q: ${String(x?.q ?? '').trim()} A: ${String(x?.a ?? '').trim()}`));
    return [...out, String(f.body ?? '').replace(/\r\n/g, '\n').trim()].join('\n\n');
  };
  return paragraphDiff(tagged(before), tagged(after));
}

/**
 * Is patching cheaper than translating in full? A patch answers with find AND
 * replace text for every changed sentence, on top of reading the whole
 * translation, so past about a quarter of the document it costs more. Measured
 * 2026-10-06 on a real ended-event rewrite (LANY, 26 of ~35 paragraphs
 * changed): the Korean patch wrote 6,951 output tokens where a full
 * translation writes ~3,500. Small repairs — a sentence or two, the weekly
 * prose fix — stay well under the line.
 */
export const PATCH_MAX_SHARE = 0.25;
export function patchIsCheaper(patch, englishDoc) {
  const changed = [...(patch?.removed || []), ...(patch?.added || [])].reduce((n, p) => n + String(p).length, 0);
  const whole = String(englishDoc || '').length;
  return whole > 0 && changed / 2 <= whole * PATCH_MAX_SHARE;
}

const MAX_STEPS = 12;

/**
 * Record one repair as a step. Steps are kept apart, not merged, so a
 * translation at ANY earlier step can still be patched: one that caught up last
 * week needs only this week's step, one that lagged needs both (Codex, 09-28 —
 * the first version merged them and locked every caught-up translation out).
 * A repair that does not continue from the last step (the post changed some
 * other way in between) starts a new chain: the older steps no longer describe
 * a path to the current text.
 */
export function recordRepair(records, slug, fromHash, toHash, diff, now = new Date()) {
  const steps = records[slug]?.steps || [];
  const continues = steps.length && steps[steps.length - 1].to === fromHash;
  const step = { from: fromHash, to: toHash, at: now.toISOString(), removed: diff.removed, added: diff.added };
  records[slug] = { steps: [...(continues ? steps : []), step].slice(-MAX_STEPS) };
  return records;
}

/** Drop steps old enough that every translation has long since caught up. */
export function pruneRecords(records, now = new Date()) {
  const cut = now.getTime() - KEEP_DAYS * 86400e3;
  for (const [slug, r] of Object.entries(records)) {
    const steps = (r?.steps || []).filter((s) => Date.parse(s.at) >= cut);
    if (steps.length) records[slug] = { steps }; else delete records[slug];
  }
  return records;
}

/**
 * The net change from `storedHash` to `currentHash`: the paragraphs that left
 * and the ones that are there now. A paragraph one step added and a later step
 * removed is in neither — the first version concatenated the steps and showed
 * such a deleted paragraph (a price, say) as current text (Codex, 09-28).
 */
function netChange(steps) {
  const removed = [];
  const added = [];
  for (const s of steps) {
    for (const p of s.removed) {
      const i = added.indexOf(p);
      if (i >= 0) added.splice(i, 1); else removed.push(p);
    }
    added.push(...s.added);
  }
  return { removed, added };
}

export function loadRecords(file = PATCHES_FILE) {
  try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}; } catch { return {}; }
}

export function saveRecords(records, file = PATCHES_FILE) {
  const sorted = Object.fromEntries(Object.entries(records).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(file, JSON.stringify(sorted, null, 1) + '\n', 'utf8');
}

/**
 * The change to patch with ({ removed, added }), or null. Qualifies only when
 * an unbroken run of recorded steps leads from the translation's stored hash
 * exactly to the post's current hash.
 */
export function patchFor(record, storedHash, currentHash) {
  const steps = record?.steps;
  if (!Array.isArray(steps) || !storedHash || !currentHash) return null;
  const start = steps.findIndex((s) => s.from === storedHash);
  if (start < 0) return null;
  const run = steps.slice(start);
  for (let i = 1; i < run.length; i++) if (run[i].from !== run[i - 1].to) return null;
  if (run[run.length - 1].to !== currentHash) return null;
  const net = netChange(run);
  return net.removed.length || net.added.length ? net : null;
}

/**
 * Apply find/replace edits. Every `find` must occur exactly once in the text as
 * it stands when that edit is applied, or the whole patch is refused (null) and
 * the caller re-translates. An empty edit list is a valid answer: the English
 * change did not alter the meaning (a/an, punctuation, markup).
 */
export function applyEdits(text, edits) {
  if (!Array.isArray(edits)) return null;
  let out = String(text);
  for (const e of edits) {
    const find = typeof e?.find === 'string' ? e.find : '';
    const replace = typeof e?.replace === 'string' ? e.replace : null;
    if (!find || replace === null) return null;
    const at = out.indexOf(find);
    if (at < 0 || out.indexOf(find, at + 1) >= 0) return null;
    out = out.slice(0, at) + replace + out.slice(at + find.length);
  }
  // A deletion can leave three newlines where a paragraph was.
  return out.replace(/\n{3,}/g, '\n\n');
}

export const EDIT_TOOL = {
  name: 'submit_edits',
  description: 'Return the edits that bring the translation in line with the edited English.',
  input_schema: {
    type: 'object',
    properties: {
      edits: {
        type: 'array',
        description: 'Find/replace edits on the current translation. Empty when the English edit changed no meaning.',
        items: {
          type: 'object',
          properties: {
            find: { type: 'string', description: 'Exact text copied from the current translation; must occur exactly once.' },
            replace: { type: 'string', description: 'New text in the target language. Empty string deletes.' },
          },
          required: ['find', 'replace'],
        },
      },
    },
    required: ['edits'],
  },
};

export function patchPrompt(langName, register, record, translationBody) {
  const list = (xs) => (xs.length ? xs.map((p) => `<<<\n${p}\n>>>`).join('\n') : '(none)');
  return `You maintain the ${langName} version of a travel guide. An editor changed a few paragraphs of the English source. Bring the ${langName} text in line with that change and touch nothing else.

ENGLISH PARAGRAPHS AS THEY WERE (removed or replaced):
${list(record.removed)}

ENGLISH PARAGRAPHS AS THEY ARE NOW (added or replacing the ones above):
${list(record.added)}

RULES
- Find the ${langName} sentences that correspond to what changed, and edit only those. Where the English removed a detail (a price, a date, a named dish, an address), remove it from the ${langName} too; where it generalised a claim, generalise it the same way.
- If the change does not alter the meaning (grammar, punctuation, a/an, markup), return an empty edit list.
- Each "find" is copied exactly from the CURRENT ${langName.toUpperCase()} TEXT below, occurs there exactly once, and is as short as it can be while unique (a sentence or a clause, not a paragraph).
- Each "replace" is natural ${langName} in the same voice. Register: ${register} An empty "replace" deletes.
- Keep numbers, names, links and markdown exactly as they are unless the English change is about them.
- Lines like @@DESCRIPTION@@, @@QUICK ANSWER@@, @@FAQ 1@@ and @@BODY@@ mark where each field starts. Never include one in a "find" or a "replace", and keep each FAQ's "Q:" and "A:" prefixes.

CURRENT ${langName.toUpperCase()} TEXT
${translationBody}`;
}

/**
 * Tidy a repaired body the model handed back, or refuse it.
 *
 * repair-prose.mjs puts a `---` line between its instructions and the body,
 * and on 2026-10-03 the model echoed that separator as the first line of its
 * answer. The repair wrote it straight under the frontmatter, so the post had
 * `---` twice in a row — a horizontal rule on the live page, a file the
 * frontmatter writers could no longer re-read (check-writer-safety stopped CI),
 * and a recorded patch that would have carried the stray line into all four
 * translations. A leading echo is stripped; any OTHER bare `---` line the
 * original body did not have is a reason to leave the post alone.
 *
 * @returns {{ out: string } | { reason: string }}
 */
export function cleanRepairOutput(out, body) {
  const fences = (s) => (String(s).match(/^-{3,}[ \t]*$/gm) || []).length;
  let text = String(out ?? '').replace(/^\s*-{3,}[ \t]*\r?\n/, '');
  if (fences(text) > fences(body)) return { reason: 'the rewrite added a bare "---" line the article never had' };
  return { out: text };
}
