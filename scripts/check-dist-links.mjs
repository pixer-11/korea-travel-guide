#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  EVERY INTERNAL LINK IN THE BUILT SITE — resolved against dist, no server.
//
//  Why this replaced the linkinator crawl in link-check.yml (2026-11-04): the
//  crawl asked a local `serve` for every url over HTTP at 12-way concurrency,
//  and as the site grew it took 3 h → 3 h 41 m → 4 h 42 m and then hit GitHub's
//  6-hour job limit — the 11-04 run was cancelled mid-crawl and reported
//  nothing. `serve` answers 200 exactly when the file exists and 404 when it
//  does not, so asking the file system gives the same verdict in minutes.
//  It also reads every page in dist, not only those reachable from the home
//  page, and it cannot produce the status-0 / 408 "unreached" noise the
//  overloaded server used to.
//
//  Resolution follows `serve` (no --single, cleanUrls): /a/ → a/index.html;
//  /a → the file a, a.html, or a/index.html. Worker routes (/go, /api,
//  /preferences, /og/) are not in dist and are skipped, as the crawl skipped
//  them; off-site links are not checked.
//
//  Output: CSV in the crawl's shape (url,status,state,parent) so the workflow's
//  counting is unchanged — one OK row per unique url, one BROKEN row per place
//  a missing url is linked from.
//
//    node scripts/check-dist-links.mjs [distDir] > links.csv
// ─────────────────────────────────────────────────────────────
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { requireExamined } from './lib/examined.mjs';

export const ORIGIN = 'https://wanderatlasguides.com';
const SKIP = /^\/(?:(?:go|api|preferences)(?:\/|$)|og\/)/;
// Read as an HTML parser reads it: tag by tag, each tag's attributes in order,
// so a quoted value is consumed whole. Scanning the page text for `src=` instead
// read the embed-code box (value="<iframe src=&quot;…&quot;>") as 4,865 links.
const TAG = /<([a-zA-Z][^\s>\/]*)((?:\s*(?:[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?|\/))*)\s*>/g;
const ATTRS = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
// The url-bearing attributes linkinator reads, quoted or not (Codex, 11-04).
const URL_ATTRS = new Set(['href', 'src', 'srcset', 'poster', 'cite', 'data', 'longdesc', 'background']);

/** Every tag as { name, attrs } with lower-cased attribute names. */
function* tags(html) {
  for (const t of html.matchAll(TAG)) {
    const attrs = {};
    for (const a of t[2].matchAll(ATTRS)) {
      const k = a[1].toLowerCase();
      if (!(k in attrs)) attrs[k] = a[2] ?? a[3] ?? a[4] ?? '';
    }
    yield { name: t[1].toLowerCase(), attrs };
  }
}

/** srcset candidates by the spec's rule: a url runs to whitespace; trailing commas end it. */
function srcsetUrls(value) {
  const out = [];
  let i = 0;
  while (i < value.length) {
    while (i < value.length && /[\s,]/.test(value[i])) i++;
    let j = i;
    while (j < value.length && !/\s/.test(value[j])) j++;
    let url = value.slice(i, j);
    const ended = /,+$/.test(url);
    url = url.replace(/,+$/, '');
    if (url) out.push(url);
    i = j;
    if (!ended) { while (i < value.length && value[i] !== ',') i++; }
  }
  return out;
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** The site path a built html file is served at. */
export function pageUrl(rel) {
  const p = '/' + rel.split(sep).join('/');
  if (p.endsWith('/index.html')) return p.slice(0, -'index.html'.length);
  return p.replace(/\.html$/, '');
}

/** Internal site paths an attribute value points at (srcset may hold several). */
export function internalPaths(raw, base, srcset = false) {
  const value = raw.replace(/&amp;/g, '&').trim();
  const parts = srcset ? srcsetUrls(value) : [value];
  const out = [];
  for (const v of parts) {
    if (!v || v.startsWith('#') || /^(?:mailto|tel|javascript|data|sms):/i.test(v)) continue;
    let u;
    try { u = new URL(v, ORIGIN + base); } catch { continue; }
    if (u.origin !== ORIGIN) continue;
    let path;
    try { path = decodeURIComponent(u.pathname); } catch { path = u.pathname; }
    if (SKIP.test(path)) continue;
    out.push(path);
  }
  return out;
}

/** Does `serve dist` answer 200 for this path? One deliberate difference: a
 *  folder with no index.html got serve's directory LISTING (200), and is broken
 *  here — production answers it with the 404 page. */
export function resolves(path, files) {
  const p = path.replace(/^\/+/, '');
  if (p === '') return files.has('index.html');
  if (path.endsWith('/')) return files.has(p + 'index.html') || files.has(p.slice(0, -1) + '.html');
  return files.has(p) || files.has(p + '.html') || files.has(p + '/index.html');
}

export function checkDist(dist) {
  const all = walk(dist).map((f) => relative(dist, f).split(sep).join('/'));
  const files = new Set(all);
  const pages = all.filter((f) => f.endsWith('.html'));
  const seen = new Map(); // path -> { ok, parents: [] }
  for (const rel of pages) {
    const page = pageUrl(rel);
    // Markup only, as the crawl's HTML parser saw it: a template literal inside
    // a <script> (`href="${t.dataset.checklist}"`) is code, not a link — read
    // as one, it was 14,644 "broken" urls on the first run.
    const html = readFileSync(join(dist, rel), 'utf8')
      // The opening tag stays: <script src="/_astro/…js"> is a link (Codex, 11-04).
      .replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi, '$1')
      .replace(/<style\b[\s\S]*?<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');
    const all = [...tags(html)];
    // Relative links resolve against <base href> when a page declares one.
    let base = page;
    const b = all.find((t) => t.name === 'base' && t.attrs.href);
    if (b) { try { base = new URL(b.attrs.href.replace(/&amp;/g, '&'), ORIGIN + page).pathname; } catch {} }
    const found = [];
    for (const t of all) {
      // <base href> sets where links resolve; it is not a link itself.
      if (t.name !== 'base') for (const [k, v] of Object.entries(t.attrs)) {
        if (URL_ATTRS.has(k)) found.push(...internalPaths(v, base, k === 'srcset'));
      }
      // <meta http-equiv="refresh" content="0; url=/moved/">
      if (t.name === 'meta' && /^refresh$/i.test(t.attrs['http-equiv'] || '')) {
        const r = /^\s*\d+\s*[;,]\s*url\s*=\s*['"]?([^'"\s]+)/i.exec(t.attrs.content || '');
        if (r) found.push(...internalPaths(r[1], base));
      }
    }
    for (const path of found) {
      let s = seen.get(path);
      if (!s) seen.set(path, (s = { ok: resolves(path, files), parents: [] }));
      if (!s.ok || s.parents.length === 0) s.parents.push(page);
    }
  }
  return { pages: pages.length, seen, files };
}

const csvUrl = (p) => (ORIGIN + encodeURI(p)).replace(/,/g, '%2C');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dist = process.argv[2] || 'dist';
  const { pages, seen, files } = checkDist(dist);
  requireExamined(pages, 'dist 의 html 페이지', `${dist} 가 비어 있나? 빌드가 안 됐나?`);
  // The crawl's canary, kept: a resolver that calls everything present can only
  // ever report "clean". Prove it can say missing before trusting what it says.
  if (resolves('/__linkcheck-canary-404__/', files) || !resolves('/', files)) {
    console.error('::error::link resolver failed its canary — it cannot tell a missing page from a present one');
    process.exit(1);
  }
  const rows = ['url,status,state,parent'];
  let broken = 0;
  for (const [path, s] of seen) {
    if (s.ok) rows.push(`${csvUrl(path)},200,OK,${csvUrl(s.parents[0])}`);
    else { broken++; for (const parent of s.parents) rows.push(`${csvUrl(path)},404,BROKEN,${csvUrl(parent)}`); }
  }
  process.stdout.write(rows.join('\n') + '\n');
  console.error(`DIST_LINKS pages=${pages} urls=${seen.size} broken=${broken}`);
}
