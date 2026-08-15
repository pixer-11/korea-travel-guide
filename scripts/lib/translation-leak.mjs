// Wrong-language detection for translated pages: does a ko/ja/zh/es body still
// carry paragraphs written in some OTHER language? Extracted from
// scripts/audit-translations.mjs on 2026-08-15 so the rules are testable on
// their own — a false positive here is expensive (the repair tools rewrite a
// healthy page, the gate quarantines it), so every exemption needs a regression
// case standing next to the leak it must still catch.

const hangul = (s) => (s.match(/[가-힣]/g) || []).length;
const kana = (s) => (s.match(/[ぁ-んァ-ヶ]/g) || []).length;
const han = (s) => (s.match(/[一-鿿]/g) || []).length;
const latinWords = (s) => (s.match(/[A-Za-z]{2,}/g) || []);

const EN_STOP = /\b(the|and|with|from|your|that|this|have|will|are|for|you|of|to|in|is|it)\b/gi;
const ES_MARK = /[áéíóúñü¿¡]|\b(el|la|los|las|una|para|con|que|del|es|más)\b/gi;

// Strip the bits where foreign scripts/Latin are LEGITIMATE before scoring:
// links/URLs, inline code, bold place names get kept as text but link URLS go.
export function cleanParagraph(p) {
  return p
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // keep link text, drop URL
    .replace(/`[^`]*`/g, '')
    .replace(/https?:\S+/g, '')
    // The gloss can sit on EITHER side of the native name. An address meant to
    // be shown to a taxi driver puts the native script FIRST and the reader's
    // language in the parens — "강원도 … 옛등대길 24-7（江原道…旧灯台街24-7）" — which
    // is the same good practice mirrored, not a leak. Drop the native run only
    // when a gloss immediately follows it, and cap its length: a genuinely
    // untranslated paragraph must never buy amnesty with one parenthesis.
    .replace(/[가-힣ぁ-んァ-ヶ][가-힣ぁ-んァ-ヶ\dA-Za-z\s.,·・~〜-]{0,59}(?=\s*[（(])/g, '')
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
export function isLinkList(raw) {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const linkLines = lines.filter((l) => /^[-*]\s*\[/.test(l));
  return lines.length > 0 && linkLines.length / lines.length >= 0.6;
}

// Paragraph-level script flags. Returns [type, rawParagraph] pairs, same shape
// the audit reports. CRLF must already be normalized by the caller: `\r\n\r\n`
// never matches the `\n{2,}` split and the whole body collapses into ONE
// paragraph, which misfires every threshold below.
export function scriptLeakFlags(lang, body) {
  const flags = [];
  const paras = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 60 && !p.startsWith('|'));
  for (const raw of paras) {
    if (isLinkList(raw)) continue;
    const p = cleanParagraph(raw);
    const latinRun = latinWords(p).join(' ').length;
    const h = hangul(p), k = kana(p), c = han(p);
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
  }
  return flags;
}
