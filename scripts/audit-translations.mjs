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

let files = 0, flagged = 0;
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
      const flags = auditBody(lang, body);
      if (flags.length) {
        flagged++;
        report.push(`${label}/${lang}/${f}: ${flags.map(([t]) => t).join(', ')}`);
        if (VERBOSE) for (const [t, p] of flags) report.push(`    [${t}] ${p.slice(0, 140)}`);
      }
    }
  }
}

console.log(`\n🌐 Translation language audit — ${files} file(s) scanned`);
if (report.length) {
  console.log(`❌ ${flagged} file(s) flagged:\n`);
  for (const r of report) console.log(`  • ${r}`);
  process.exit(1);
}
console.log('✓ no wrong-language content found in any translation.');
