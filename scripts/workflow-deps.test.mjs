// A workflow job that never runs `npm ci` can only run scripts whose whole
// import graph is Node built-ins and repo files. On 2026-10-06 the daily
// analytics report died with ERR_MODULE_NOT_FOUND 'gray-matter': a 10-05
// cleanup moved scripts/analytics-report.mjs onto lib/frontmatter-edit.mjs
// (which imports gray-matter), and analytics-report.yml installs nothing.
// Every unit test passed, because the test runner has node_modules.
//   node --test scripts/workflow-deps.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WF = join(ROOT, '.github', 'workflows');

// Bare package imports reachable from a file, following relative imports.
export function packagesReached(file, seen = new Set(), out = new Set()) {
  if (seen.has(file) || !existsSync(file)) return out;
  seen.add(file);
  const src = readFileSync(file, 'utf8');
  const specs = [
    ...src.matchAll(/^\s*import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm),
    ...src.matchAll(/^\s*export\s+[^'"]*?\s+from\s+['"]([^'"]+)['"]/gm),
    ...src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].map((m) => m[1]);
  for (const s of specs) {
    if (s.startsWith('node:')) continue;
    if (s.startsWith('.') || s.startsWith('/')) {
      const next = resolve(dirname(file), s);
      packagesReached(next, seen, out);
    } else {
      out.add(s.split('/').slice(0, s.startsWith('@') ? 2 : 1).join('/'));
    }
  }
  return out;
}

// Jobs of a workflow file, crudely split at the top-level `jobs:` children.
function jobs(text) {
  const at = text.indexOf('\njobs:');
  if (at < 0) return [];
  const body = text.slice(at + 6);
  return body.split(/\n(?=  [A-Za-z0-9_-]+:\s*\n)/).filter((j) => /^\s*[A-Za-z0-9_-]+:/.test(j));
}

test('a job without npm ci runs only scripts that need no package', () => {
  const problems = [];
  let checked = 0;
  for (const f of readdirSync(WF).filter((x) => /\.ya?ml$/.test(x))) {
    for (const job of jobs(readFileSync(join(WF, f), 'utf8'))) {
      if (/\bnpm (ci|install|i)\b/.test(job) || /uses:\s*\.\/\.github\/workflows\//.test(job)) continue;
      for (const m of job.matchAll(/\bnode\s+(scripts\/[\w./-]+\.mjs)/g)) {
        checked++;
        const pkgs = [...packagesReached(join(ROOT, m[1]))];
        if (pkgs.length) problems.push(`${f}: ${m[1]} needs ${pkgs.join(', ')} but the job runs no npm ci`);
      }
    }
  }
  assert.ok(checked > 0, 'no install-free job scripts found — the scan is reading nothing');
  assert.deepEqual(problems, []);
});

test('the scan sees a package two imports deep', () => {
  const pkgs = packagesReached(join(ROOT, 'scripts', 'lib', 'frontmatter-edit.mjs'));
  assert.ok(pkgs.has('gray-matter'));
});
