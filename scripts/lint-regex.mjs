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

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (e === 'node_modules' || e === 'dist' || e.startsWith('.')) continue;
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(mjs|js|ts)$/.test(e)) files.push(p);
  }
})(ROOT);

const hits = [];
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (/lint-regex/.test(line)) return;             // this file's own examples
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
  ? `\n❌ ${hits.length} regex literal(s) look like a lost backslash.`
  : `✓ ${files.length} file(s) scanned — no regex with a missing backslash.`);
process.exit(hits.length ? 1 : 0);
