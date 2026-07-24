// Weekly newsletter sender. DEFAULT = dry-run (renders previews + prints a plan,
// sends nothing). --live actually sends via MailerLite and updates the sent-log.
// Live is intended to run ONLY from a manual workflow_dispatch with live=true.
//
//   node scripts/newsletter-send.mjs            # dry-run
//   node scripts/newsletter-send.mjs --live     # real send
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { slugify } from './lib/slugify.mjs';
import { loadPosts, audienceKey, sentSetFor, pickSingleRegionEdition, pickGlobalEdition, pickMultiRegionEdition } from './lib/newsletter-content.mjs';
import { renderSingleRegion, renderGlobal, renderMultiRegion } from './lib/newsletter-render.mjs';
import { bucketSubscribers } from './lib/audience.mjs';
import { mailerlite } from './lib/mailerlite.mjs';

const LIVE = process.argv.includes('--live');
const { MAILERLITE_API_TOKEN, NEWSLETTER_FROM_EMAIL, NEWSLETTER_FROM_NAME = 'Wander Atlas' } = process.env;
const SITE = 'https://wanderatlasguides.com';
const POSTS_DIR = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const LOG_PATH = fileURLToPath(new URL('../data/newsletter-sent-log.json', import.meta.url));
const OUT_DIR = fileURLToPath(new URL('../.newsletter-preview/', import.meta.url));

if (!MAILERLITE_API_TOKEN) { console.error('MAILERLITE_API_TOKEN missing'); process.exit(1); }
if (LIVE && !NEWSLETTER_FROM_EMAIL) { console.error('NEWSLETTER_FROM_EMAIL required for --live (verified MailerLite sender)'); process.exit(1); }

const posts = loadPosts(POSTS_DIR);
const log = existsSync(LOG_PATH) ? JSON.parse(readFileSync(LOG_PATH, 'utf8')) : {};
const now = new Date();
const ml = mailerlite(MAILERLITE_API_TOKEN);

// region label + country lookups from the corpus (region field is a display name).
const countryByRegion = {};
const labelBySlug = {};
for (const p of posts) {
  countryByRegion[p.data.region] = p.data.country;
  labelBySlug[slugify(p.data.region)] = p.data.region;
}
const links = { cta: `${SITE}`, unsubscribe: `${SITE}/unsubscribe`, prefs: `${SITE}/preferences`, story: (s) => `${SITE}/posts/${s}`, event: (s) => `${SITE}/posts/${s}` };

let subscribers = [];
try { subscribers = await ml.listActiveSubscribers(); }
catch (e) { console.error('subscriber fetch failed:', e.message); process.exit(1); }
const buckets = bucketSubscribers(subscribers);
console.log(`${LIVE ? 'LIVE' : 'DRY-RUN'} · ${subscribers.length} subscribers · ${buckets.length} audiences · ${posts.length} posts\n`);

mkdirSync(OUT_DIR, { recursive: true });
let sentCount = 0;

for (const b of buckets) {
  const key = b.key; // matches audienceKey(slug, lang) form
  const sent = sentSetFor(log, key);
  let rendered = null, used = null;

  if (b.type === 'global') {
    const ed = pickGlobalEdition({ posts, sent, now });
    if (ed) { rendered = renderGlobal({ edition: ed, lang: b.lang, links }); used = ed; }
  } else if (b.type === 'single') {
    const region = labelBySlug[b.regions[0]] || b.regions[0];
    const ed = pickSingleRegionEdition({ posts, region, country: countryByRegion[region] || region, sent, now, minStories: 3 });
    if (ed) { rendered = renderSingleRegion({ edition: ed, region, lang: b.lang, links }); used = ed; }
  } else {
    const regionLabels = b.regions.map((s) => labelBySlug[s] || s);
    const ed = pickMultiRegionEdition({ posts, regions: regionLabels, countryByRegion, sent, now, perRegion: 2 });
    if (ed) { rendered = renderMultiRegion({ edition: ed, regions: regionLabels, lang: b.lang, links }); used = ed; }
  }

  if (!rendered) { console.log(`  [${key}] SKIP — no new content (${b.subscriberIds.length} subs)`); continue; }

  if (!LIVE) {
    writeFileSync(`${OUT_DIR}${key.replace(/[^a-z0-9]+/gi, '_')}.html`, rendered.html);
    console.log(`  [${key}] would send "${rendered.subject}" to ${b.subscriberIds.length} subs → preview written`);
    continue;
  }

  try {
    const group = await ml.ensureGroup(`auto:${key}`);
    for (const id of b.subscriberIds) await ml.setSubscriberGroup(id, group.id);
    const camp = await ml.createCampaign({
      name: `WA ${key} ${now.toISOString().slice(0, 10)}`,
      subject: rendered.subject, fromName: NEWSLETTER_FROM_NAME, from: NEWSLETTER_FROM_EMAIL,
      html: rendered.html, groupId: group.id,
    });
    await ml.sendCampaign(camp.id);
    log[key] = log[key] || { posts: [], events: [] };
    log[key].posts = [...new Set([...(log[key].posts || []), ...used.usedPostSlugs])];
    log[key].events = [...new Set([...(log[key].events || []), ...used.usedEventSlugs])];
    sentCount++;
    console.log(`  [${key}] SENT "${rendered.subject}" to ${b.subscriberIds.length} subs`);
  } catch (e) {
    console.error(`  [${key}] SEND FAILED: ${e.message}`);
  }
}

if (LIVE && sentCount > 0) {
  writeFileSync(LOG_PATH, JSON.stringify(log, null, 2) + '\n');
  try {
    execSync('git config user.name "Korea Travel Guide" && git config user.email "bot@wanderatlasguides.com"');
    execSync(`git add ${LOG_PATH}`);
    execSync(`git commit -m "chore: newsletter sent-log ${now.toISOString().slice(0, 10)} (${sentCount} audiences)"`);
    execSync('git push');
    console.log(`sent-log committed (${sentCount} audiences).`);
  } catch (e) { console.error('sent-log commit failed:', e.message); }
}
console.log(`\n${LIVE ? `Done — sent ${sentCount} audiences.` : 'Dry-run complete — open .newsletter-preview/*.html'}`);
