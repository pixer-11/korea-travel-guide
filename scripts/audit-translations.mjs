#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  TRANSLATION LANGUAGE-MIX AUDIT — scans every translated markdown body
//  (posts i18n, essentials-i18n, essentials-topics-i18n, static-pages-i18n)
//  for content in the WRONG language:
//   • ko file: paragraphs with no Hangul / Japanese kana / long English runs
//   • ja file: paragraphs with no kana+han / Hangul leakage / long English runs
//   • zh file: paragraphs with no Han / Hangul or kana leakage / long English runs
//   • es file: CJK leakage / heavily-English paragraphs (stopword ratio)
//  Conservative on purpose: place names, brand names and short Latin fragments
//  are normal in translations — only paragraph-level foreign runs are flagged.
//  Exit 1 when anything is flagged (usable as a CI gate).
//  Usage: node scripts/audit-translations.mjs [--verbose]
// ─────────────────────────────────────────────────────────────
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import yaml from 'js-yaml';

// Broken-syllable detection (ko) lives in lib/ko-syllables.mjs so the WRITE gate
// in translate-posts.mjs and this audit judge by exactly the same set — the audit
// was catching the same tic every morning because nothing stopped the translator
// producing it (2026-08-09).
import { koBrokenSyllables } from './lib/ko-syllables.mjs';
// Paragraph-level wrong-language rules live in lib/ so they can be tested
// without running the whole corpus audit (2026-08-15).
import { scriptLeakFlags } from './lib/translation-leak.mjs';

const ROOTS = [
  ['src/content/i18n', 'posts'],
  ['src/content/essentials-i18n', 'essentials'],
  ['src/content/essentials-topics-i18n', 'topics'],
  ['src/content/static-pages-i18n', 'static'],
];
const VERBOSE = process.argv.includes('--verbose');

// Where a translation root's ENGLISH source lives, so a translated file can be
// compared against the fields the source actually had.
const SOURCE_OF = {
  'src/content/i18n': 'src/content/posts',
  'src/content/essentials-i18n': 'src/content/essentials',
  'src/content/essentials-topics-i18n': 'src/content/essentials-topics',
};

// Tool-call markup that leaked into a field value — never legitimate prose.
const SPILL = /<\/?(description|quickAnswer|title|body|faq|parameter|function_calls|invoke)\b|<parameter\s+name=/i;

const fmField = (fm, key) => new RegExp(`^${key}:`, 'm').test(fm);

async function auditFrontmatter(root, lang, file, fm, body = '') {
  const flags = [];
  if (!fm) return flags;

  const srcDir = SOURCE_OF[root];
  let src = '';
  if (srcDir) {
    try {
      src = await readFile(join(srcDir, file), 'utf8');
    } catch {
      src = ''; // no source to compare against (orphan is a separate check)
    }
  }
  const srcEnd = src.indexOf('\n---', 3);
  const srcFm = srcEnd === -1 ? '' : src.slice(4, srcEnd);

  // A draft never renders, so its translation cannot show anyone the wrong
  // language. Flagging it just sends the owner the same warning every morning
  // about a page nobody can reach; the check applies again the moment it is
  // published, because that flips this flag. Signals the caller to skip the
  // body checks too — otherwise a draft still gets flagged, just by a different
  // rule.
  if (/^draft:\s*true\s*$/m.test(srcFm)) return null;

  if (SPILL.test(fm)) flags.push(['TOOL-SPILL', fm.match(SPILL)[0]]);
  // quickAnswer, description and FAQ answers are rendered as plain text, so a
  // `**` in them is not bold — it is two asterisks on the page. zh/visa carried
  // 国籍**和**目的地 in an FAQ answer while the body check passed (2026-09-02).
  if (/\S\*\*|\*\*\S/.test(fm)) flags.push(['broken-bold-frontmatter', fm.match(/.{0,24}\*\*.{0,24}/)[0]]);
  // A description that stops mid-clause is the page's SERP copy in that
  // language — 407 translations mirrored the truncated English descriptions
  // until the 2026-08-01 rebuild. Terminal punctuation (any script), possibly
  // inside a closing quote/bracket, and balanced parens (width-agnostic: a
  // fullwidth（ closed by halfwidth ) is a pair, not a truncation).
  {
    let desc = null;
    try {
      const parsed = yaml.load(fm);
      if (parsed && typeof parsed.description === 'string') desc = parsed.description.trim();
    } catch { /* malformed frontmatter is caught by other checks */ }
    if (desc) {
      const balanced = (desc.match(/[(（]/g) || []).length === (desc.match(/[)）]/g) || []).length;
      if (!/[.!?…。．！？](['"”’」』】)\]）]*)?$/.test(desc) || !balanced) {
        flags.push(['TRUNCATED-DESCRIPTION', `…${desc.slice(-50)}`]);
      }
    }
  }
  // A body or answer that is literally the word 'placeholder'. One Chinese page
  // shipped with both — the whole article was that word — and nothing noticed,
  // because the file existed, parsed, and had a real title.
  if (/^\s*placeholder\s*$/im.test(body) || /:\s*placeholder\s*$/im.test(fm)) {
    flags.push(['PLACEHOLDER-BODY', 'placeholder']);
  }
  if (!srcDir || !src) return flags;
  // A field the source has but the translation lost renders the ENGLISH value on
  // a translated page — the exact symptom that started this check.
  for (const key of ['quickAnswer', 'description', 'title']) {
    if (fmField(srcFm, key) && !fmField(fm, key)) flags.push([`MISSING-${key}`, key]);
  }
  return flags;
}

// Model chatter leaking into a saved translation ("지금까지 … 확인했습니다",
// "Here is the translation") — found once at the top of a ko essentials body.
const CHATTER = /지금까지 가이드|필요한 모든 정보를 확인|다음은 번역|번역입니다|以下は翻訳|翻訳です|以下是翻译|翻译如下|He aquí la traducción|Here is the translation/;

// CommonMark refuses to close `**` when the char just before the closer is
// punctuation — ）)。」etc — and the char just after is a CJK/word character
// (right-flanking rule), so `**内堡（Inner Fort）**是` shows literal asterisks
// on the page. 145 live ko/ja/zh files had this before the 2026-08-01 sweep.
// A bare regex can't tell an opener from a closer (`。**次**` is legal), so ask
// the renderer itself: if `**` survives into the HTML, a delimiter failed.
const MD_OPTS = { extensions: [gfm()], htmlExtensions: [gfmHtml()], allowDangerousHtml: true };
function brokenBoldLine(body) {
  if (!body.includes('**')) return null;
  if (!micromark(body, MD_OPTS).includes('**')) return null;
  for (const line of body.split('\n')) {
    if (line.includes('**') && micromark(line, MD_OPTS).includes('**')) return line;
  }
  return body.split('\n').find((l) => l.includes('**')) || '**';
}

function auditBody(lang, body) {
  const flags = [];
  const firstPara = (body.trim().split(/\n{2,}/)[0] || '').slice(0, 300);
  if (CHATTER.test(firstPara)) flags.push(['translator-chatter', firstPara]);
  const brokenBold = brokenBoldLine(body);
  if (brokenBold !== null) flags.push(['broken-bold', brokenBold]);
  if (lang === 'ko') {
    for (const b of koBrokenSyllables(body).slice(0, 3)) flags.push(['broken-syllable', b]);
  }
  flags.push(...scriptLeakFlags(lang, body));
  return flags;
}

let files = 0, flagged = 0, drafts = 0;
const report = [];
for (const [root, label] of ROOTS) {
  let langs = [];
  try { langs = await readdir(root); } catch { continue; }
  for (const lang of langs) {
    if (!['ko', 'ja', 'es', 'zh'].includes(lang)) continue;
    for (const f of (await readdir(join(root, lang))).filter((f) => f.endsWith('.md'))) {
      files++;
      // Windows checkouts (core.autocrlf) hand us CRLF, and `\r\n\r\n` never
      // matches the `\n{2,}` paragraph split — the whole body becomes ONE
      // paragraph and per-paragraph thresholds misfire (false korean-leak on
      // ja/gangneung-local-restaurant.md). Normalize before any line math.
      const raw = (await readFile(join(root, lang, f), 'utf8')).replace(/\r\n/g, '\n');
      const fmEnd = raw.indexOf('\n---', 3);
      const body = fmEnd === -1 ? raw : raw.slice(fmEnd + 4);
      // The audit only ever read the BODY, so a frontmatter defect was invisible:
      // 26 posts shipped with the tool call spilled into `description` and
      // `quickAnswer` missing entirely, which makes the page render the ENGLISH
      // quick answer on a translated page. That is exactly the failure this
      // audit exists to catch, so it has to look at the frontmatter too.
      const fmFlags = await auditFrontmatter(root, lang, f, fmEnd === -1 ? '' : raw.slice(4, fmEnd), body);
      if (fmFlags === null) { drafts++; continue; } // unpublished — nothing renders
      const flags = [...auditBody(lang, body), ...fmFlags];
      if (flags.length) {
        flagged++;
        report.push(`${label}/${lang}/${f}: ${flags.map(([t]) => t).join(', ')}`);
        if (VERBOSE) for (const [t, p] of flags) report.push(`    [${t}] ${p.slice(0, 140)}`);
      }
    }
  }
}

console.log(
  `\n🌐 Translation language audit — ${files} file(s) scanned` +
    (drafts ? `, ${drafts} draft(s) skipped` : '')
);
if (report.length) {
  console.log(`❌ ${flagged} file(s) flagged:\n`);
  for (const r of report) console.log(`  • ${r}`);
  process.exit(1);
}
console.log('✓ no wrong-language content found in any translation.');
