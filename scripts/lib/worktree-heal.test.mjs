// A guard that only ever says "all clear" is the failure mode here: the point
// of these rules is to separate a Disk Cleanup purge (restore it) from a
// session's own deletion (leave it), and to stop a cron from committing either.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseStatusZ, purgedPaths, deletionsAmongStaged, missingPackages, lockTopLevelPackages,
} from './worktree-heal.mjs';

const z = (...entries) => `${entries.join('\0')}\0`;

test('a purge is restorable, a staged deletion is a session\'s own work', () => {
  const entries = parseStatusZ(z(' D src/pages/search.json.js', 'D  src/content/posts/retired.md', ' M src/lib/a.ts'));
  assert.deepEqual(purgedPaths(entries), ['src/pages/search.json.js']);
  // The staged deletion must NOT be healed — undoing it would revert a session.
  assert.ok(!purgedPaths(entries).includes('src/content/posts/retired.md'));
});

test('an untouched tree heals nothing', () => {
  assert.deepEqual(purgedPaths(parseStatusZ(z(' M a.ts', '?? b.ts', 'M  c.ts'))), []);
});

test('paths with spaces and unicode survive parsing', () => {
  const entries = parseStatusZ(z(' D src/pages/[lang]/events/[country].astro', ' D src/content/posts/서울 cafe.md'));
  assert.deepEqual(purgedPaths(entries), ['src/pages/[lang]/events/[country].astro', 'src/content/posts/서울 cafe.md']);
});

test('a commit that would delete content is caught before it is pushed', () => {
  const entries = parseStatusZ(z('D  src/content/posts/seoul-cafe.md', 'M  data/og-mirror.json', 'A  data/new.json'));
  assert.deepEqual(deletionsAmongStaged(entries), ['src/content/posts/seoul-cafe.md']);
});

test('an ordinary content commit is not blocked', () => {
  const entries = parseStatusZ(z('M  data/og-mirror.json', 'A  src/content/posts/new-post.md'));
  assert.deepEqual(deletionsAmongStaged(entries), []);
});

test('a gutted node_modules is detected even though the folder still exists', () => {
  const lock = { packages: { '': {}, 'node_modules/js-yaml': {}, 'node_modules/@astrojs/rss': {}, 'node_modules/astro/node_modules/vite': {} } };
  const expected = lockTopLevelPackages(lock);
  assert.deepEqual(expected.sort(), ['@astrojs/rss', 'js-yaml']);
  assert.deepEqual(missingPackages(expected, ['@astrojs/rss']), ['js-yaml']);
  assert.deepEqual(missingPackages(expected, ['js-yaml', '@astrojs/rss']), []);
});

test('other platforms\' binaries are not counted as missing', () => {
  // The first version of this check called a healthy install "74 packages
  // missing" because the lockfile lists every platform's esbuild/rollup binary.
  const lock = {
    packages: {
      'node_modules/js-yaml': {},
      'node_modules/@esbuild/android-arm': { cpu: ['arm'], os: ['android'], optional: true },
      'node_modules/@rollup/rollup-linux-x64-gnu': { cpu: ['x64'], os: ['linux'] },
      'node_modules/@rollup/rollup-win32-x64-msvc': { cpu: ['x64'], os: ['win32'] },
    },
  };
  const win = lockTopLevelPackages(lock, { platform: 'win32', arch: 'x64' });
  assert.deepEqual(win.sort(), ['@rollup/rollup-win32-x64-msvc', 'js-yaml']);
  assert.deepEqual(missingPackages(win, ['js-yaml', '@rollup/rollup-win32-x64-msvc']), []);
  // …but a genuinely gutted install is still caught.
  assert.deepEqual(missingPackages(win, ['@rollup/rollup-win32-x64-msvc']), ['js-yaml']);
});

test('heal-worktree restores purged files and leaves edits and staged deletions alone', () => {
  const repo = mkdtempSync(join(tmpdir(), 'heal-'));
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    git('init', '-q');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'purged.ts'), 'export const a = 1;\n');
    writeFileSync(join(repo, 'src', 'edited.ts'), 'export const b = 1;\n');
    writeFileSync(join(repo, 'src', 'retired.ts'), 'export const c = 1;\n');
    writeFileSync(join(repo, 'package-lock.json'), JSON.stringify({ packages: {} }));
    git('add', '-A');
    git('commit', '-qm', 'seed');

    rmSync(join(repo, 'src', 'purged.ts'));                                  // Disk Cleanup
    writeFileSync(join(repo, 'src', 'edited.ts'), 'export const b = 2;\n');  // a session mid-edit
    rmSync(join(repo, 'src', 'retired.ts'));
    git('rm', '-q', '--cached', 'src/retired.ts');                            // a deliberate removal

    const script = fileURLToPath(new URL('../heal-worktree.mjs', import.meta.url));
    const env = { ...process.env, HEAL_WORKTREE_ROOT: repo };
    let status = 0;
    try {
      execFileSync(process.execPath, [script], { cwd: repo, env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) { status = e.status; }

    assert.equal(status, 1, 'healing something must report it, not exit silently');
    assert.ok(existsSync(join(repo, 'src', 'purged.ts')), 'the purged file must come back');
    assert.equal(readFileSync(join(repo, 'src', 'edited.ts'), 'utf8'), 'export const b = 2;\n', 'an in-progress edit must survive');
    assert.ok(!existsSync(join(repo, 'src', 'retired.ts')), 'a staged deletion must stay deleted');

    // Second run: nothing left to do, and it says so with a clean exit.
    const out = execFileSync(process.execPath, [script], { cwd: repo, env, encoding: 'utf8' });
    assert.match(out, /worktree intact/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
