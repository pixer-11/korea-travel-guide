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

CURRENT ${langName.toUpperCase()} TEXT
${translationBody}`;
}
