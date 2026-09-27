// Opus 5.5 answers a forced tool_choice ({ type: 'tool', name }) with HTTP 400.
// The writer hit it on 2026-09-24 and the translator would have on 2026-09-28;
// both now pick 'auto' for Opus. This keeps the next file that defaults to Opus
// 5.5 from shipping a request that can only fail.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OPUS_55 = /['"]claude-(?:opus-5-5|fable-5|mythos-5)[\w-]*['"]/;
const FORCED = /tool_choice:\s*\{\s*type:\s*['"]tool['"]/;

function files(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') out.push(...files(p)); continue; }
    if (/\.(mjs|js|ts)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}

test('no file that defaults to Opus 5.5 forces tool_choice', () => {
  const bad = [];
  let opus = 0;
  for (const f of [...files(join(ROOT, 'scripts')), ...files(join(ROOT, 'src'))]) {
    const src = readFileSync(f, 'utf8');
    if (!OPUS_55.test(src)) continue;
    opus++;
    if (FORCED.test(src)) bad.push(f.slice(ROOT.length));
  }
  assert.ok(opus >= 2, `only ${opus} Opus 5.5 files found - the scan is looking in the wrong place`);
  assert.deepEqual(bad, [], 'these send a forced tool_choice to Opus 5.5, which returns 400');
});

test('the translator sends Opus 5.5 an auto tool_choice and the tool-only line', () => {
  const src = readFileSync(join(ROOT, 'scripts/translate-posts.mjs'), 'utf8');
  assert.match(src, /TRANSLATE_MODEL \|\| 'claude-opus-5-5'/);
  assert.match(src, /NO_FORCED_TOOL = \/opus-5-5\|fable-5\|mythos-5\/\.test\(MODEL\)/);
  // Both requests (the translation and the FAQ-only rescue) go through the helper.
  assert.equal((src.match(/tool_choice: toolChoice\('/g) || []).length, 2);
  assert.match(src, /prompt\(LANGS\[langCode\], data\) \+ toolOnly\('submit_translation'\)/);
  // And the helper itself has to return the right thing: counting calls alone
  // passed with a helper that forced the tool for every model (Codex, 09-28).
  // The script runs on import, so its three helper lines are evaluated here.
  const lines = ['NO_FORCED_TOOL', 'toolChoice', 'toolOnly'].map((n) => {
    const m = src.match(new RegExp(`^const ${n} = .*;$`, 'm'));
    assert.ok(m, `const ${n} not found on one line`);
    return m[0];
  });
  const build = new Function('MODEL', `${lines.join('\n')}\nreturn { toolChoice, toolOnly };`);
  const opus = build('claude-opus-5-5');
  assert.deepEqual(opus.toolChoice('submit_translation'), { type: 'auto' });
  assert.deepEqual(opus.toolChoice('submit_faq'), { type: 'auto' });
  assert.match(opus.toolOnly('submit_translation'), /ONLY by calling the submit_translation tool/);
  // TRANSLATE_MODEL=claude-sonnet-5 must still send the old request unchanged.
  const sonnet = build('claude-sonnet-5');
  assert.deepEqual(sonnet.toolChoice('submit_translation'), { type: 'tool', name: 'submit_translation' });
  assert.equal(sonnet.toolOnly('submit_translation'), '');
});
