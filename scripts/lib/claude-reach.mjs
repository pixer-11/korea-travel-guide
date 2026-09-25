// Which scripts load the Claude cost meter, and which workflows run them.
//
// A process is metered when its import graph reaches scripts/lib/claude-meter.mjs
// (every file that imports the SDK imports the meter). A workflow that runs such
// a process must name the ledger and commit it, or that spend is invisible:
// on 2026-09-25 twelve workflows called Claude with no ledger at all.
// It does not follow child processes (a script that spawns another script), so
// the test also requires the ledger wherever a workflow hands out the API key.
// Static imports only - the repo has no dynamic SDK imports (checked 2026-09-25).

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|(?:^|\n)\s*import\s*['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;

/** Does this file's static import graph reach the meter? */
export function reachesMeter(file, seen = new Map()) {
  file = resolve(file);
  if (seen.has(file)) return seen.get(file);
  seen.set(file, false);
  if (!existsSync(file)) return false;
  if (file.endsWith(join('lib', 'claude-meter.mjs'))) { seen.set(file, true); return true; }
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[1] || m[2] || m[3];
    if (reachesMeter(resolve(dirname(file), spec), seen)) { seen.set(file, true); return true; }
  }
  return false;
}

/** Script paths a workflow runs (node scripts/x.mjs, npm run <name> → package.json). */
export function scriptsRunBy(workflowText, root) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts || {};
  const out = new Set();
  const add = (s) => { for (const m of s.matchAll(/\bnode\s+(?:--[\w-]+(?:=\S+)?\s+)*((?:\.\/)?scripts\/[\w./-]+\.m?js)/g)) out.add(m[1].replace(/^\.\//, '')); };
  add(workflowText);
  for (const m of workflowText.matchAll(/\bnpm\s+run\s+([\w:-]+)/g)) if (pkg[m[1]]) add(pkg[m[1]]);
  // A shell script the workflow runs can start node too (git-push-retry.sh does).
  for (const m of workflowText.matchAll(/\bbash\s+((?:\.\/)?scripts\/[\w./-]+\.sh)/g)) {
    const sh = join(root, m[1].replace(/^\.\//, ''));
    if (existsSync(sh)) add(readFileSync(sh, 'utf8'));
  }
  return [...out];
}

/** Workflows (file names) that run at least one metered script, with the scripts. */
export function meteredWorkflows(root) {
  const dir = join(root, '.github', 'workflows');
  const seen = new Map();
  const out = {};
  for (const f of readdirSync(dir).filter((x) => /\.ya?ml$/.test(x))) {
    const text = readFileSync(join(dir, f), 'utf8');
    const hits = scriptsRunBy(text, root).filter((s) => reachesMeter(join(root, s), seen));
    if (hits.length) out[f] = hits;
  }
  return out;
}
