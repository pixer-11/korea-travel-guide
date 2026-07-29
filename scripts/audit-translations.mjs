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

const hangul = (s) => (s.match(/[가-힣]/g) || []).length;
const kana = (s) => (s.match(/[ぁ-んァ-ヶ]/g) || []).length;
const han = (s) => (s.match(/[一-鿿]/g) || []).length;
const latinWords = (s) => (s.match(/[A-Za-z]{2,}/g) || []);

const EN_STOP = /\b(the|and|with|from|your|that|this|have|will|are|for|you|of|to|in|is|it)\b/gi;
const ES_MARK = /[áéíóúñü¿¡]|\b(el|la|los|las|una|para|con|que|del|es|más)\b/gi;

// Strip the bits where foreign scripts/Latin are LEGITIMATE before scoring:
// links/URLs, inline code, bold place names get kept as text but link URLS go.
function cleanParagraph(p) {
  return p
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // keep link text, drop URL
    .replace(/`[^`]*`/g, '')
    .replace(/https?:\S+/g, '')
    // Parenthetical native-script names — "草堂純豆腐(초당순두부)", "元祖…横丁 (Ganso…)"
    // — are GOOD translation practice (readers can match signage), never a leak.
    .replace(/（[^（）]*）/g, '')
    .replace(/\([^()]*\)/g, '')
    // Quoted native phrases — taught traveler phrases ("더 주세요") and signage
    // names ("元祖さっぽろラーメン横丁") — are content, not leakage.
    .replace(/"[^"\n]*"/g, '')
    .replace(/“[^”\n]*”/g, '')
    .replace(/「[^」\n]*」/g, '')
    .replace(/『[^』\n]*』/g, '')
    .replace(/〈[^〉\n]*〉/g, '');
}

// Official-source link lists keep their English site titles verbatim — a
// paragraph that is mostly "- [Title](url)" lines is reference material, not
// untranslated prose.
function isLinkList(raw) {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const linkLines = lines.filter((l) => /^[-*]\s*\[/.test(l));
  return lines.length > 0 && linkLines.length / lines.length >= 0.6;
}

// Model chatter leaking into a saved translation ("지금까지 … 확인했습니다",
// "Here is the translation") — found once at the top of a ko essentials body.
const CHATTER = /지금까지 가이드|필요한 모든 정보를 확인|다음은 번역|번역입니다|以下は翻訳|翻訳です|以下是翻译|翻译如下|He aquí la traducción|Here is the translation/;

function auditBody(lang, body) {
  const flags = [];
  const firstPara = (body.trim().split(/\n{2,}/)[0] || '').slice(0, 300);
  if (CHATTER.test(firstPara)) flags.push(['translator-chatter', firstPara]);
  const paras = body.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length >= 60 && !p.startsWith('|'));
  for (const raw of paras) {
    if (isLinkList(raw)) continue;
    const p = cleanParagraph(raw);
    const lw = latinWords(p);
    const latinRun = lw.join(' ').length;
    const h = hangul(p), k = kana(p), c = han(p);
    const total = p.length;
    if (lang === 'ko') {
      if (h === 0 && latinRun > 80) flags.push(['english-paragraph', raw]);
      else if (k > 10) flags.push(['japanese-leak', raw]);
    } else if (lang === 'ja') {
      if (h > 10) flags.push(['korean-leak', raw]);
      else if (k + c === 0 && latinRun > 80) flags.push(['english-paragraph', raw]);
    } else if (lang === 'zh') {
      if (h > 10) flags.push(['korean-leak', raw]);
      else if (k > 10) flags.push(['japanese-leak', raw]);
      else if (c === 0 && latinRun > 80) flags.push(['english-paragraph', raw]);
    } else if (lang === 'es') {
      if (h + k + c > 10) flags.push(['cjk-leak', raw]);
      else {
        const en = (p.match(EN_STOP) || []).length;
        const es = (p.match(ES_MARK) || []).length;
        if (en >= 6 && es === 0) flags.push(['english-paragraph', raw]);
      }
    }
    void total;
  }
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
      const raw = await readFile(join(root, lang, f), 'utf8');
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
