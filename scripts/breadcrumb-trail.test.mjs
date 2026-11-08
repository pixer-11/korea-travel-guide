// The trail at the top of a page looks the same on every template (2026-11-08):
// five said "Home / Japan", fourteen "Home · Japan", and the when-to-go pages
// dropped Home on screen while their BreadcrumbList kept it. Each template
// writes its own trail, so this reads them all.
//   node --test scripts/breadcrumb-trail.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../src/components/', import.meta.url));

function trailsIn(source) {
  return [...source.matchAll(/<(nav|p) class="[^"]*crumb[^"]*"[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => m[2]);
}

function trailProblems(body) {
  const problems = [];
  if (/>\s*\/\s*</.test(body)) problems.push('slash separator');
  if (!body.includes('·')) problems.push('no middle dot');
  // EventsHero is handed its items; EventsCountryHub and EventsIndex are read below.
  const first = body.match(/<a\s+href=\{([^}]+)\}/)?.[1] ?? '';
  const isHome = /localizePath\('\/', lang\)|^P\('\/'\)|lang === 'en' \? '\/'/.test(first);
  if (!body.includes('crumbs.map') && !isHome) problems.push(`first link is not home: ${first}`);
  return problems;
}

function astroFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((f) => {
    const p = path.join(dir, f.name);
    return f.isDirectory() ? astroFiles(p) : f.name.endsWith('.astro') ? [p] : [];
  });
}

test('the check catches each way a trail went wrong', () => {
  assert.deepEqual(trailProblems(`<a href={localizePath('/', lang)}>Home</a> <span>/</span> <span>X</span>`), ['slash separator', 'no middle dot']);
  assert.match(trailProblems(`<a href={localizePath('/tools/when-to-go', lang)}>When</a><span aria-hidden="true">·</span><span>Japan</span>`)[0], /first link is not home/);
});

test('it leaves the forms the site really writes alone', () => {
  assert.deepEqual(trailProblems(`<a href={localizePath('/', lang)}>{t('post.home')}</a><span aria-hidden="true">·</span><b>X</b>`), []);
  assert.deepEqual(trailProblems(`<a href={P('/')}>{crumbHome}</a> <span aria-hidden="true">·</span> <span aria-current="page">X</span>`), []);
  assert.deepEqual(trailProblems("<a href={lang === 'en' ? '/' : `/${lang}/`}>{t('post.home')}</a> <span>·</span>"), []);
  // An eSIM-style trail with bare dots between the links.
  assert.deepEqual(trailProblems(`<a href={localizePath('/', lang)}>Home</a> · <span>Japan</span>`), []);
});

test('every template uses the middle dot and starts at Home', () => {
  const found = astroFiles(ROOT).flatMap((f) => trailsIn(readFileSync(f, 'utf8')).map((body) => [path.basename(f), body]));
  assert.ok(found.length >= 19, `only ${found.length} trails found: the pattern stopped matching`);
  const bad = found.flatMap(([f, body]) => trailProblems(body).map((p) => `${f}: ${p}`));
  assert.deepEqual(bad, []);
});

test('the events hub hands its trail a Home first', () => {
  for (const f of ['EventsCountryHub.astro', 'EventsIndex.astro']) {
    assert.match(readFileSync(path.join(ROOT, f), 'utf8'), /crumbs=\{\[\{ label: t\('post\.home'\), href: localizePath\('\/', lang\) \}/, f);
  }
});
