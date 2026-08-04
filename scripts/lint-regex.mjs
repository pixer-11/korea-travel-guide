// Catch regex literals that lost their backslashes.
//
// This has now happened four times in this repo in a single day. A pattern gets
// written through a shell heredoc, `\s` arrives as `s`, `\d` as `d`, and the
// result is still a VALID regex — it just matches something else, usually
// nothing. It reads correctly in every diff. The most recent one sat in
// audit-translations.mjs for a week: `/^s*placeholder s*$/` looked like a
// whitespace check and was really "zero or more letter s", so the guard that
// commit added never fired.
//
// Nothing here understands regexes deeply. It looks for the specific shape the
// accident produces: a lone class letter (s, d, w, b, S, D, W, B) sitting where
// a quantifier or an anchor makes it obvious a class was meant.
//
//   node scripts/lint-regex.mjs [dir]
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = process.argv[2] || 'scripts';

// A regex literal, roughly: /…/flags not preceded by an identifier char.
const LITERAL = /(?<![\w)\]])\/(?![/*])((?:\\.|\[(?:\\.|[^\]])*\]|[^/\\\n])+)\/[gimsuyv]*/g;

// The tells. Each is a letter that means nothing on its own but is a character
// class when escaped, in a position where a literal letter makes no sense.
// `(?<!\\)` on every one of them: in the literal's SOURCE text an escaped class
// is the two characters \ and s, so without the lookbehind a perfectly correct
// `\s*$` reads as a bare `s*$` and the linter reports 40 false positives — which
// is how a linter gets switched off and stops catching the real thing.
const TELLS = [
  // `s*` / `d+` / `w{2,}` directly after ^, (, |, or another quantifier
  { re: /(?:^|[(|^])(?<!\\)([sdwbSDWB])[*+?{]/, why: 'quantified bare class letter' },
  // `…s*$` — trailing, right before the end anchor
  { re: /(?<!\\)([sdwbSDWB])[*+]\$/, why: 'quantified bare class letter before $' },
  // `:s*` — the shape that broke the placeholder check
  { re: /[:=,](?<!\\)([sdwb])[*+]/, why: 'bare class letter after a separator' },
];

// The OTHER half of the same accident (found 2026-08-04). Instead of losing the
// backslash, the escape gets INTERPRETED on the way in: `\b` arrives as an
// actual backspace character, `\x01` as the control byte itself. The regex is
// still valid and still reads correctly in a diff, because the character is
// invisible. In ItineraryPage.astro the transit-tip pattern held
// `[역駅站]<U+0008>` — a branch searching for "역 followed by a literal
// backspace", which no page has ever contained, so that branch was dead from the
// day it was written. Judged by CODE POINT, never by a literal in this file.
const isInvisible = (cp) =>
  (cp <= 0x08) || (cp === 0x0b) || (cp === 0x0c) || (cp >= 0x0e && cp <= 0x1f) ||
  (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x2028 && cp <= 0x202e) || (cp === 0xfeff);

// Backslash-loss scanning stays on hand-written script sources: an .astro file
// is full of `</div>` that a regex-literal matcher can misread. The invisible
// character scan has no such ambiguity, so it runs over everything.
const SCRIPT_EXT = /\.(mjs|js|ts)$/;
const ALL_EXT = /\.(mjs|js|ts|astro|yml|yaml)$/;
const ROOTS = ROOT === 'scripts' ? ['scripts', 'src', '.github/workflows'] : [ROOT];

const files = [];
for (const root of ROOTS) {
  try { statSync(root); } catch { continue; }
  (function walk(dir) {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (e === 'node_modules' || e === 'dist') continue;
      // .github is named explicitly in ROOTS; other dot-entries stay skipped.
      if (e.startsWith('.') && dir !== '.') continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (ALL_EXT.test(e)) files.push(p);
    }
  })(root);
}

const hits = [];
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split(/\r?\n/);
  const scanBackslash = SCRIPT_EXT.test(f);
  lines.forEach((line, i) => {
    if (/lint-regex/.test(line)) return;             // this file's own examples
    const bad = [...line].map((c) => c.codePointAt(0)).filter(isInvisible);
    if (bad.length) {
      const cps = [...new Set(bad)].map((c) => 'U+' + c.toString(16).padStart(4, '0')).join(',');
      hits.push({ f, n: i + 1, why: `invisible character in source (${cps}) — write it as an escape`, src: line.trim().slice(0, 78) });
      return;
    }
    if (!scanBackslash) return;
    for (const m of line.matchAll(LITERAL)) {
      const body = m[1];
      for (const t of TELLS) {
        if (t.re.test(body)) {
          hits.push({ f, n: i + 1, why: t.why, src: m[0].slice(0, 78) });
          return;
        }
      }
    }
  });
}

for (const h of hits) console.log(`${h.f}:${h.n}  ${h.why}\n    ${h.src}`);
console.log(hits.length
  ? `\n❌ ${hits.length} pattern(s) look like a lost or swallowed escape.`
  : `✓ ${files.length} file(s) scanned — no lost backslashes, no invisible characters.`);
process.exit(hits.length ? 1 : 0);
