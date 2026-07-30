// Rewrite the sentences that send readers to a closed venue.
//
// audit-hours-claims.mjs finds them; this fixes them. The venue's opening hours
// are the fact — they come from Google — so the PROSE is what changes, never the
// frontmatter. The model is given the hours and the offending sentences and told
// to keep everything else about the article untouched.
//
//   node scripts/fix-hours-claims.mjs            # every post the audit flags
//   node scripts/fix-hours-claims.mjs --dry      # show the rewrites, change nothing
//   node scripts/fix-hours-claims.mjs --only=a,b
import './lib/env.mjs';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import yaml from 'js-yaml';

const DIR = 'src/content/posts';
const MODEL = process.env.WRITER_MODEL || 'claude-sonnet-5';
const dry = process.argv.includes('--dry');
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7)
  .split(',').map((s) => s.trim()).filter(Boolean);

// Ask the auditor which posts are wrong rather than re-implementing the test —
// one definition of "contradicts its hours", used by both.
// The auditor exits 1 when it finds something, which is the normal case here —
// execSync throws on a non-zero exit, so read stdout off the error too.
const auditOut = (() => {
  const flags = process.argv.includes('--drafts') ? ' --drafts' : '';
  try { return execSync('node scripts/audit-hours-claims.mjs' + flags, { encoding: 'utf8', maxBuffer: 1e8 }); }
  catch (e) { return String(e.stdout ?? ''); }
})();
const flagged = auditOut
  .split('\n')
  .map((l) => l.match(/^HOURS-CONTRADICTION:\s*(\S+\.md)/)?.[1])
  .filter(Boolean)
  .filter((f) => !only.length || only.includes(f.replace(/\.md$/, '')));

if (!flagged.length) { console.log('nothing to fix'); process.exit(0); }
console.log(`${flagged.length} post(s) to correct\n`);

const client = new Anthropic();
let fixed = 0, failed = 0;

for (const f of flagged) {
  const path = join(DIR, f);
  const raw = readFileSync(path, 'utf8');
  const cut = raw.indexOf('\n---', 3);
  let fm;
  try { fm = yaml.load(raw.slice(4, cut)); } catch { console.log(`  ✗ ${f}: unparseable`); failed++; continue; }
  const body = raw.slice(cut + 4);
  const hours = (fm.place?.openingHours ?? []).join('\n');

  const prompt = `This published travel guide gives visiting advice that contradicts the venue's real opening hours. Readers following it arrive at a closed door.

VENUE: ${fm.place?.name || fm.title}
REAL OPENING HOURS (from Google — these are correct and must not be contradicted):
${hours}

ARTICLE BODY:
${body}

ALSO CHECK THESE FIELDS, which appear on the page above the article:
DESCRIPTION: ${fm.description ?? '(none)'}
QUICK ANSWER: ${fm.quickAnswer ?? '(none)'}
FAQ: ${JSON.stringify(fm.faq ?? [], null, 1)}

Rewrite ONLY the sentences whose timing advice is wrong, so that every time and day mentioned falls inside the real hours above. Rules:
- Keep the article's voice, length and structure. Do not restructure, retitle, or add sections.
- Do not touch any sentence that is already consistent with the hours.
- Where the article recommended a time the venue is shut, recommend the nearest sensible time it is OPEN — e.g. if it opens at 11:00 and the text said "arrive at 10:30", say "right at opening, 11am".
- If the text names a closing day incorrectly, correct it to the real closing day (or remove the claim if there is none).
- Never invent facts that are not in the article or the hours above.
- Keep markdown formatting exactly as it is.

Reply with ONE JSON object and nothing else:
{"body":"<corrected article body, markdown, unchanged where it was already right>","description":"<corrected or unchanged>","quickAnswer":"<corrected or unchanged>","faq":[{"q":"…","a":"…"}]}
Include description, quickAnswer and faq exactly as given if they needed no correction. The museum FAQ that said "closed on Mondays" beside hours listing Monday 9:00 AM – 2:00 PM is why these fields are here: fixing only the body leaves the wrong answer on the page.`;

  try {
    const msg = await client.messages.create({
      model: MODEL, max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content.find((b) => b.type === 'text')?.text?.trim();
    if (!text) throw new Error('empty response');
    const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    const out = String(j.body || '').replace(/^```(?:markdown)?\n?/, '').replace(/\n?```$/, '').trim();
    if (!out) throw new Error('no body in response');
    // A rewrite that loses a third of the article is a failure, not a fix.
    if (out.length < body.length * 0.6) throw new Error(`body shrank ${body.length}→${out.length}`);

    // The frontmatter is rewritten field by field, never re-serialised wholesale:
    // place/heroImage/gallery carry data this script has no business reshaping.
    const next = { ...fm };
    if (j.description) next.description = String(j.description);
    if (j.quickAnswer) next.quickAnswer = String(j.quickAnswer);
    if (Array.isArray(j.faq) && j.faq.length === (fm.faq ?? []).length) next.faq = j.faq;
    else if (Array.isArray(j.faq) && j.faq.length && (fm.faq ?? []).length) {
      throw new Error(`faq count changed ${(fm.faq ?? []).length}→${j.faq.length}`);
    }

    if (dry) {
      console.log(`  — ${f}: would rewrite body ${body.length}→${out.length}` +
        `${next.description !== fm.description ? ' +description' : ''}` +
        `${next.quickAnswer !== fm.quickAnswer ? ' +quickAnswer' : ''}` +
        `${JSON.stringify(next.faq) !== JSON.stringify(fm.faq) ? ' +faq' : ''}`);
    } else {
      const head = yaml.dump(next, { lineWidth: -1, quotingType: '"', forceQuotes: false });
      writeFileSync(path, `---\n${head}---\n\n${out}\n`);
      console.log(`  ✓ ${f}`);
    }
    fixed++;
  } catch (e) {
    console.log(`  ✗ ${f}: ${e.message}`);
    failed++;
  }
}

console.log(`\n${dry ? 'would fix' : 'fixed'} ${fixed}, failed ${failed}`);
console.log(dry ? '' : 'Re-run scripts/audit-hours-claims.mjs to confirm, then re-translate the changed posts.');
