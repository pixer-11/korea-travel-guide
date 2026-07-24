// Offline preview: renders the newsletter for one or more audiences from the
// site's REAL posts, writes .html files you can open in a browser, and prints a
// report. Sends nothing and does not touch the sent-log. No MailerLite token.
//
//   node scripts/newsletter-dry-run.mjs --region "Dubai" --langs en,ko
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { slugify } from './lib/slugify.mjs';
import { loadPosts, audienceKey, sentSetFor, pickSingleRegionEdition } from './lib/newsletter-content.mjs';
import { renderSingleRegion } from './lib/newsletter-render.mjs';
import { LANGS } from './lib/newsletter-copy.mjs';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};

const POSTS_DIR = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const LOG_PATH = fileURLToPath(new URL('../data/newsletter-sent-log.json', import.meta.url));
const OUT_DIR = fileURLToPath(new URL('../.newsletter-preview/', import.meta.url));

const region = arg('region', 'Dubai');
const langs = arg('langs', 'en').split(',').filter((l) => LANGS.includes(l));
const posts = loadPosts(POSTS_DIR);
const log = existsSync(LOG_PATH) ? JSON.parse(readFileSync(LOG_PATH, 'utf8')) : {};
const now = new Date();

// Infer the country from any post in the region (falls back to the region name).
const sample = posts.find((p) => String(p.data.region).toLowerCase() === region.toLowerCase());
const country = sample ? sample.data.country : region;

mkdirSync(OUT_DIR, { recursive: true });
const site = 'https://wanderatlasguides.com';
console.log(`Dry-run · region="${region}" country="${country}" · ${posts.length} posts loaded\n`);

for (const lang of langs) {
  const key = audienceKey(slugify(region), lang);
  const edition = pickSingleRegionEdition({ posts, region, country, sent: sentSetFor(log, key), now, minStories: 3 });
  if (!edition) { console.log(`  [${key}] SKIP — no clean content this run`); continue; }
  const links = {
    cta: `${site}/regions/${slugify(region)}`,
    unsubscribe: `${site}/unsubscribe`,
    prefs: `${site}/preferences`,
    story: (s) => `${site}/${s}`,
    event: (s) => `${site}/${s}`,
  };
  const { subject, html } = renderSingleRegion({ edition, region, lang, links });
  const file = `${OUT_DIR}${slugify(region)}-${lang}.html`;
  writeFileSync(file, html);
  console.log(`  [${key}] "${subject}" — hero:${edition.hero.slug} stories:${edition.stories.length} events:${edition.events.length} → ${file}`);
}
console.log('\nOpen the .newsletter-preview/*.html files in a browser to review.');
