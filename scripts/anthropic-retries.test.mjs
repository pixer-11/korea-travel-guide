// Every Claude client a script makes retries an overloaded API more than twice.
//
// 2026-10-01 09:07 KST: the weekly "Discover current events" run had written
// events for 30 minutes when one 529 Overloaded came back. The SDK's default
// is two retries; the third failure threw, the run stopped, and the commit
// step was skipped — every event it had made was lost. All 37 scripts used the
// default. Each client now passes maxRetries; a new one that forgets fails here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const DIRS = ['./', './lib/'];

test('every new Anthropic(...) in scripts sets maxRetries', () => {
  const missing = [];
  for (const d of DIRS) {
    const dir = new URL(d, import.meta.url);
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.mjs') && !x.endsWith('.test.mjs'))) {
      const src = readFileSync(new URL(f, dir), 'utf8');
      // Read the arguments up to the BALANCED closing parenthesis: a regex that
      // stopped at the first ")" failed `new Anthropic({ apiKey: readKey(),
      // maxRetries: 6 })` (Codex review, 10-01).
      for (const m of src.matchAll(/new Anthropic\(/g)) {
        let depth = 1, i = m.index + m[0].length;
        while (i < src.length && depth) { if (src[i] === '(') depth++; else if (src[i] === ')') depth--; i++; }
        const args = src.slice(m.index + m[0].length, i - 1);
        if (!/maxRetries\s*:/.test(args)) missing.push(`${d}${f}: new Anthropic(${args.slice(0, 60)})`);
      }
    }
  }
  assert.deepEqual(missing, []);
});
