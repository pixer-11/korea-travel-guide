#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  DECLARED-DEPENDENCY LINT
//
//  34 files imported `js-yaml` directly while package.json never declared it —
//  it was present only as a transitive dependency of gray-matter. That works
//  until the day gray-matter drops it or moves a major version, and then every
//  one of those 34 files dies at once, on a fresh `npm ci`, in CI, at 3am.
//  (Found 2026-08-06 while chasing three identical "tests failed" alerts.)
//
//  This walks every hand-written source file and asserts that each bare import
//  specifier is declared in package.json. Node builtins and relative paths are
//  ignored; so is anything under node_modules or dist.
//
//   node scripts/lint-deps.mjs
// ─────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { builtinModules } from 'node:module';

// `import { execSync } from 'child_process'` — no node: prefix — is still a
// builtin, not a missing package. Checking the real list beats maintaining one.
const BUILTIN = new Set(builtinModules);

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const declared = new Set([
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
]);

const ROOTS = ['scripts', 'src', 'worker'];
const EXT = /\.(mjs|js|ts|astro)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.astro']);

/** `@scope/name/sub` → `@scope/name`; `name/sub` → `name`. */
const packageOf = (spec) =>
  spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];

const files = [];
const walk = (dir) => {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (EXT.test(e.name) && statSync(p).size < 2e6) files.push(p);
  }
};
for (const r of ROOTS) walk(r);

const missing = new Map();   // package → files that import it
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const specs = [
    ...[...src.matchAll(/^\s*import\s[^'"]*from\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]),
    ...[...src.matchAll(/\bawait\s+import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
    ...[...src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]),
  ];
  for (const spec of specs) {
    if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) continue;
    if (spec.startsWith('astro:')) continue;          // Astro virtual modules
    if (BUILTIN.has(packageOf(spec))) continue;       // node builtin without the node: prefix
    const name = packageOf(spec);
    if (declared.has(name)) continue;
    (missing.get(name) ?? missing.set(name, []).get(name)).push(f);
  }
}

for (const [name, where] of missing) {
  console.log(`❌ ${name} — imported by ${where.length} file(s) but not in package.json`);
  for (const w of where.slice(0, 4)) console.log(`     ${w}`);
  if (where.length > 4) console.log(`     … and ${where.length - 4} more`);
}
console.log(missing.size
  ? `\n${missing.size} undeclared package(s). A fresh npm ci can lose these without warning.`
  : `✓ ${files.length} file(s) scanned — every imported package is declared.`);
process.exit(missing.size ? 1 : 0);
