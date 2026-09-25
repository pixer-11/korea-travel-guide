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
import { brokenBoldLine } from './lib/cjk-bold.mjs';
import yaml from 'js-yaml';

// Broken-syllable detection (ko) lives in lib/ko-syllables.mjs so the WRITE gate
// in translate-posts.mjs and this audit judge by exactly the same set — the audit
// was catching the same tic every morning because nothing stopped the translator
// producing it (2026-08-09).
import { koBrokenSyllables } from './lib/ko-syllables.mjs';
// Paragraph-level wrong-language rules live in lib/ so they can be tested
// without running the whole corpus audit (2026-08-15).
import { scriptLeakFlags } from './lib/translation-leak.mjs';
import { requireExamined } from './lib/examined.mjs';

const ROOTS = [
  ['src/content/i18n', 'posts'],
  ['src/content/essentials-i18n', 'essentials'],
  ['src/content/essentials-topics-i18n', 'topics'],
  ['src/content/static-pages-i18n', 'static'],
];
const VERBOSE = process.argv.includes('--verbose');
// --slugs=a,b — 특정 글의 번역만, **초안이어도** 본다.
// restore-retired-posts 는 은퇴한 글을 초안으로 되살린다. 기본 모드는 초안을 통째로
// 건너뛰므로(아래 auditFrontmatter), 되살아난 글이 안고 돌아온 낡은 번역 결함은
// 복원 시점엔 아무도 보지 않았다 — 몇 주 뒤 사진 순찰이 그 글을 공개한 다음 날
// 아침, 순찰 경고로 처음 나타났다. 되살리는 쪽이 그 자리에서 물어볼 수 있게 하는 문.
// 출력은 사람이 읽는 줄 + 수리 기계가 읽는 TRANSLATION-DEFECT: <lang>/<slug>
// (repair-flagged-translations 의 KEYS 와 같은 형식).
const SLUGS = new Set(
  (process.argv.find((a) => a.startsWith('--slugs='))?.slice('--slugs='.length) || '')
    .split(',')
    .map((s) => s.trim().replace(/\.md$/, ''))
    .filter(Boolean),
);
const ASKED = SLUGS.size > 0;

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

async function auditFrontmatter(root, lang, file, fm, body = '', includeDrafts = false) {
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
  // --slugs 로 콕 집어 물었을 때만 초안도 본다: 물은 쪽은 "이건 곧 공개된다"를
  // 아는 자리(복원 도구)다. 그 밖에는 종전대로 건너뛴다.
  if (!includeDrafts && /^draft:\s*true\s*$/m.test(srcFm)) return null;

  // srcHash 가 없으면 translate-posts 는 그 파일을 **최신으로 간주**한다
  // (원문이 바뀜어도 재번역 큐에 안 들어간다). 2026-08-01 일괄 스탬프가 189편을
  // 빠뜨렸고, 그중 59편은 원문이 그 뒤 바뀌었는데도 7주간 아무도 모르고 있었다.
  // 즌 잘린 요약문 3건이 그 증상으로 매일 아침 경고로 나왔다(2026-09-21).
  if (!/^srcHash:/m.test(fm)) flags.push(['MISSING-SRCHASH', 'srcHash']);
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
// brokenBoldLine lives in lib/cjk-bold.mjs since 2026-09-26, shared with
// translate-posts, which now retries a translation that fails it instead of
// writing it (a stray closing ** reached the live zh Austin market page).

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
const keys = [];
for (const [root, label] of ROOTS) {
  // 슬러그를 물었으면 글 번역만 본다 — essentials·topics·static 에는 슬러그가 없다.
  if (ASKED && root !== 'src/content/i18n') continue;
  let langs = [];
  try { langs = await readdir(root); } catch { continue; }
  for (const lang of langs) {
    if (!['ko', 'ja', 'es', 'zh'].includes(lang)) continue;
    for (const f of (await readdir(join(root, lang))).filter((f) => f.endsWith('.md'))) {
      if (ASKED && !SLUGS.has(f.replace(/\.md$/, ''))) continue;
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
      const fmFlags = await auditFrontmatter(root, lang, f, fmEnd === -1 ? '' : raw.slice(4, fmEnd), body, ASKED);
      if (fmFlags === null) { drafts++; continue; } // unpublished — nothing renders
      const flags = [...auditBody(lang, body), ...fmFlags];
      if (flags.length) {
        flagged++;
        report.push(`${label}/${lang}/${f}: ${flags.map(([t]) => t).join(', ')}`);
        keys.push(`${lang}/${f.replace(/.md$/, '')}`);
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
  // 수리 기계가 읽는 줄 — repair-flagged-translations 의 KEYS 와 같은 형식.
  if (ASKED) { console.log(''); for (const k of keys) console.log(`TRANSLATION-DEFECT: ${k}`); }
  process.exit(1);
}
if (ASKED) {
  // 검사기 계약: “못 본 것”을 “깨끗한 것”으로 보고하지 않는다. 슬러그 오타나 번역이
  // 아직 한 장도 없는 글을 ✅ 로 답하면, 복원 도구가 안심하고 넘어간다.
  if (!files) {
    console.error(`✗ asked about ${SLUGS.size} slug(s) and examined 0 translation(s) — nothing was measured.`);
    process.exit(2);
  }
  console.log(`✓ ${files} translation(s) of ${SLUGS.size} slug(s) are clean.`);
  process.exit(0);
}
requireExamined(files, '번역 파일', 'src/content/i18n 이 비어 있나?');
console.log('✓ no wrong-language content found in any translation.');
