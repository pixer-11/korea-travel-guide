// Translate per-country ESSENTIALS prose into ko/ja/es/zh with Claude, writing
// one file per language per country to src/content/essentials-i18n/<lang>/<slug>.md.
//
// Only prose is translated (title, description, body). Hard facts — official URLs,
// numbers, dates, lastReviewed — stay in the English source and are read from
// there at render time. RESUMABLE + idempotent (existing files are skipped).
//
//   node scripts/translate-essentials.mjs --limit=1
//   node scripts/translate-essentials.mjs --lang=ko
//   node scripts/translate-essentials.mjs            # everything missing
import './lib/env.mjs';
import Anthropic from '@anthropic-ai/sdk';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { fixCjkBold } from './lib/cjk-bold.mjs';
import { findToolSpill } from './lib/tool-spill.mjs';
import { srcHashOfSourceFile, storedHashIn, stampSrcHash } from './lib/src-hash.mjs';

const SRC = fileURLToPath(new URL('../src/content/essentials/', import.meta.url));
const OUT = fileURLToPath(new URL('../src/content/essentials-i18n/', import.meta.url));
const MODEL = process.env.TRANSLATE_MODEL || 'claude-sonnet-5';
const CONCURRENCY = Number(process.env.TRANSLATE_CONCURRENCY || 4);

const LANGS = { ko: 'Korean', ja: 'Japanese', es: 'Spanish', zh: 'Simplified Chinese' };
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const LIMIT = Number(arg('limit') || 0) || Infinity;
const ONLY_LANG = arg('lang');
const FORCE = process.argv.includes('--force');

// The srcHash contract: exactly the fields this script translates, in this
// order, plus the body. Until 2026-09-06 this writer skipped on existence
// alone, so an edited English guide was never re-translated — the four
// luggage-storage sections landed and the ko/ja/es/zh guides kept the old
// text with no warning. Change the TOOL schema and this list together.
const HASH_FIELDS = ['title', 'description'];

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const TOOL = {
  name: 'submit_translation',
  description: 'Return the translated travel essentials guide.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Translated title, natural in the target language.' },
      description: { type: 'string', description: 'Translated meta description (1-2 sentences).' },
      body: { type: 'string', description: 'Translated markdown body, same heading structure and links.' },
    },
    required: ['title', 'description', 'body'],
  },
};

function prompt(langName, data) {
  return `Translate this English "travel essentials" country guide into ${langName} for a travel website. It covers visa & entry, transport, money, best time to visit, and emergencies.

RULES
- Natural, fluent ${langName} a local reader would find idiomatic — not word-for-word.
- KEEP EXACTLY AS-IS: numbers, prices, dates, deadlines, phone/emergency numbers, visa day-counts, station/line names, and URLs.
- This is safety-relevant information (visas, entry rules, emergencies). Do NOT add, remove, soften, or embellish any fact. Translate faithfully.
- Proper nouns (agencies, portals, place names): use the established local rendering if one exists; otherwise keep the original, adding the original in parentheses on first mention where a reader would need it.
- Preserve markdown structure exactly: the same "##" headings (translated text), lists, bold, and links with unchanged URLs.
- Do not add a translator's note.

SOURCE
Title: ${data.title}
Description: ${data.description}

Body (markdown):
${data.body}`;
}

async function translateOne(langCode, slug, data, hash) {
  const msg = await client.messages.create({
    model: MODEL,
    // 8000 was the source guide's own ceiling; a ja or zh translation of a full
    // guide runs longer than the English it came from, so the translation could
    // be cut by a limit the source cleared. 2026-09-01: the SOURCE builder was
    // caught shipping japan.md and vietnam.md cut mid-sentence, and this writer
    // would have faithfully translated the cut into four more languages.
    max_tokens: 16000,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'submit_translation' },
    messages: [{ role: 'user', content: prompt(LANGS[langCode], data) }],
  });
  // Whatever the ceiling is, never write a translation the API says it had to
  // cut short. A half-sentence is worse than yesterday's translation staying up.
  if (msg.stop_reason === 'max_tokens') {
    throw new Error('translation hit the token ceiling and was cut mid-sentence');
  }
  const out = msg.content.find((c) => c.type === 'tool_use')?.input;
  if (!out?.body || !out?.title) throw new Error('model returned no translation');
  // The model can close one field and open the next in XML *inside* a value
  // (2026-09-05, essentials topics ko) — the text is then wrong and the
  // following key is lost. Never keep such a reply.
  const spill = findToolSpill(out);
  if (spill.length) throw new Error(`tool-call spill in ${spill.join(', ')}`);
  // A body far shorter than its source is a stub with a title for camouflage
  // (posts: dubai-def-leppard ko/es at 2% of the English, 2026-09-02). The
  // existence-only skip below would then keep it forever. Same floor as
  // translate-posts: Chinese runs at ~0.4 of English, 0.2 is under any real
  // translation.
  if (String(out.body).trim().length < 0.2 * String(data.body || '').trim().length) {
    throw new Error(`translation body is a stub (${String(out.body).trim().length} chars against ${String(data.body || '').trim().length})`);
  }

  const fm = {
    lang: langCode,
    slug,
    srcHash: hash,
    title: out.title,
    description: out.description || out.title,
  };
  // CJK range tildes ("4~5월") are markdown strikethrough markers — escape in the
  // BODY (same fix as translate-posts.mjs; frontmatter renders as plain text).
  // fixCjkBold too: translate-posts has applied it at write time since 08-06,
  // but THIS writer never did, so the very first guide it produced after that
  // (Hong Kong, 08-13) shipped ja/zh essentials with literal ** in the visa
  // section — the exact defect the shared fixer exists to stop. Same pipeline,
  // same guards, or the gap just moves to whichever writer was forgotten.
  const safeBody = fixCjkBold(out.body.trim().replace(/(?<!\\)~/g, '\\~'));
  const file = `---\n${yaml.dump(fm, { lineWidth: -1 })}---\n\n${safeBody}\n`;
  const dir = join(OUT, langCode);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${slug}.md`), file, 'utf8');
}

// ── gather work ──────────────────────────────────────────────
const files = (await readdir(SRC)).filter((f) => f.endsWith('.md'));
const langs = ONLY_LANG ? [ONLY_LANG] : Object.keys(LANGS);
const jobs = [];
const plan = { missing: 0, stale: 0, fresh: 0, legacy: 0, forced: 0 };
let stamped = 0;
let count = 0;

for (const f of files) {
  if (count >= LIMIT) break;
  const slug = f.replace(/\.md$/, '');
  const raw = await readFile(join(SRC, f), 'utf8');
  const end = raw.indexOf('\n---', 3);
  let fm;
  try { fm = yaml.load(raw.slice(4, end)); } catch { continue; }
  if (!fm || fm.draft) continue;
  const body = raw.slice(end + 4).trim();
  if (!body) continue;

  const data = { title: fm.title, description: fm.description, body };
  const hash = srcHashOfSourceFile(raw, HASH_FIELDS);
  let queued = false;
  for (const lang of langs) {
    if (!LANGS[lang]) continue;
    const target = join(OUT, lang, `${slug}.md`);
    let reason;
    if (FORCE) reason = 'forced';
    else if (!existsSync(target)) reason = 'missing';
    else {
      const stored = storedHashIn(await readFile(target, 'utf8'));
      if (stored === hash) reason = 'fresh';
      else if (stored === null) {
        // Written before hashing existed. Stamp it as current rather than pay
        // to re-translate prose nobody changed; the next real edit re-queues it.
        reason = 'legacy';
        const out = stampSrcHash(await readFile(target, 'utf8'), hash);
        if (out) { await writeFile(target, out, 'utf8'); stamped++; }
        else console.log(`  ⚠ ${lang}/${slug}: legacy file could not be stamped`);
      } else reason = 'stale';
    }
    plan[reason]++;
    if (reason === 'fresh' || reason === 'legacy') continue;
    jobs.push({ lang, slug, data, hash });
    queued = true;
  }
  if (queued) count++;
}

console.log(`${jobs.length} translation(s) across ${count} country guide(s) · missing ${plan.missing} · stale ${plan.stale} · fresh ${plan.fresh} · legacy ${plan.legacy}${stamped ? ` (stamped ${stamped})` : ''}${plan.forced ? ` · forced ${plan.forced}` : ''} · model ${MODEL} · concurrency ${CONCURRENCY}`);
if (!jobs.length) { console.log('Nothing to translate — all up to date.'); process.exit(0); }

let done = 0, failed = 0, next = 0;
async function worker() {
  while (next < jobs.length) {
    const j = jobs[next++];
    try {
      await translateOne(j.lang, j.slug, j.data, j.hash);
      done++;
      console.log(`  OK ${j.lang}/${j.slug}  (${done}/${jobs.length})`);
    } catch (e) {
      failed++;
      console.log(`  FAIL ${j.lang}/${j.slug} — ${String(e.message).slice(0, 140)}`);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
console.log(`\nDone. ${done} translated, ${failed} failed.`);
if (failed) process.exitCode = 1;
