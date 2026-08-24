#!/usr/bin/env node
// FEEDS MUST NOT OFFER SELF-NOINDEXED PAGES TO CRAWLERS.
//
// A page that carries <meta robots="noindex"> and is simultaneously listed in a
// sitemap or feed sends Google two contradicting instructions. Google resolves
// it the expensive way: it fetches the URL, reads the noindex, and drops it —
// crawl budget spent to be told to go away. With this site's crawl already
// stretched thin (10k URLs, sampled pages last crawled 9–30 days ago, audit
// 2026-08-25) that waste is not free.
//
// The main sitemap has filtered these since 2026-08-06 (astro.config.mjs →
// noindexSlugs). image-sitemap.xml and rss.xml did not, and quietly offered 16
// past one-off events for weeks. The filter now lives in ONE place
// (src/lib/eventStatus.ts → isNoindexedPost) and this audit is what stops a
// fourth feed from re-introducing the gap.
//
// BIDIRECTIONAL on purpose. Checking only "is the bad thing gone?" would pass a
// filter that strips everything — so this also asserts that past RECURRING
// events (annual festivals, which stay indexed to win "when is X <next year>")
// are still PRESENT. A filter that drops those has over-corrected.
//
//   node scripts/audit-feed-noindex.mjs [--dist dist]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { isRecurringEvent } from '../src/lib/eventRecurrence.mjs';

const DIST = process.argv.includes('--dist') ? process.argv[process.argv.indexOf('--dist') + 1] : 'dist';
const POSTS = 'src/content/posts';
const today = new Date().toISOString().slice(0, 10);

// Frontmatter reader kept deliberately dumb and dependency-free — the same
// shape astro.config.mjs uses, so this audit can run before/without a build of
// the content layer.
const fm = (raw) => {
  const end = raw.indexOf('\n---', 3);
  return end === -1 ? '' : raw.slice(4, end);
};
const field = (block, key) => {
  const line = block.split('\n').find((l) => l.trimStart().startsWith(key + ':'));
  return line ? line.trimStart().slice(key.length + 1).trim().replace(/^["']|["']$/g, '') : '';
};

// Classify every post exactly as the page template does.
const noindexed = new Set();
const pastRecurring = new Set();
const withHero = new Set();
for (const f of readdirSync(POSTS)) {
  if (!f.endsWith('.md')) continue;
  const block = fm(readFileSync(join(POSTS, f), 'utf8'));
  const slug = f.replace(/\.md$/, '');
  // An image sitemap legitimately carries only pages that HAVE an image, so the
  // reverse check has to know which those are or it reports a photo-less post
  // as over-correction (false alarm caught on first run, 2026-08-25).
  if (/\n\s*url:\s*\S/.test(block.slice(block.indexOf('heroImage:')))) withHero.add(slug);
  if (field(block, 'category') !== 'event') continue;
  if (field(block, 'draft') === 'true') continue;
  const end = (field(block, 'eventEndDate') || field(block, 'eventStartDate')).slice(0, 10);
  if (!end || end >= today) continue; // not past → never noindexed
  const stored = field(block, 'eventRecurring');
  const recurring = isRecurringEvent({
    category: 'event',
    title: field(block, 'title'),
    ...(stored === 'true' || stored === 'false' ? { eventRecurring: stored === 'true' } : {}),
  });
  (recurring ? pastRecurring : noindexed).add(slug);
}

// Feeds that hand URLs to a crawler. search.json is intentionally absent: it
// powers the site's OWN search box, where a noindex page is still a legitimate
// result for a visitor already on the site.
// `heroOnly` marks a feed whose membership has a second, legitimate condition.
const FEEDS = [
  { name: 'image-sitemap.xml', heroOnly: true },
  { name: 'rss.xml', heroOnly: false },
  { name: 'sitemap-0.xml', heroOnly: false },
];

let failures = 0;
let overreach = 0;
console.log(`검사 기준일 ${today} · 종료된 일회성 이벤트 ${noindexed.size}편 · 종료됐지만 연례 ${pastRecurring.size}편\n`);

for (const { name, heroOnly } of FEEDS) {
  const path = join(DIST, name);
  if (!existsSync(path)) {
    console.log(`⏭  ${name} — 산출물 없음 (빌드 후 실행할 것)`);
    continue;
  }
  const xml = readFileSync(path, 'utf8');
  const has = (slug) => xml.includes(`/posts/${slug}/`) || xml.includes(`/posts/${slug}<`);

  const leaked = [...noindexed].filter(has);
  const eligible = heroOnly ? [...pastRecurring].filter((s) => withHero.has(s)) : [...pastRecurring];
  const dropped = eligible.filter((s) => !has(s));

  if (leaked.length) {
    failures += leaked.length;
    console.log(`❌ ${name} — noindex 페이지 ${leaked.length}편이 크롤러에게 제출되고 있다`);
    for (const s of leaked.slice(0, 8)) console.log(`     ${s}`);
    if (leaked.length > 8) console.log(`     … 외 ${leaked.length - 8}편`);
  } else {
    console.log(`✅ ${name} — noindex 누출 없음`);
  }

  // Reverse check: the filter must not have swept the recurring ones away too.
  if (dropped.length) {
    overreach += dropped.length;
    console.log(`⚠️  ${name} — 연례 이벤트 ${dropped.length}편이 빠졌다 (색인 유지 대상인데 제외됨)`);
    for (const s of dropped.slice(0, 5)) console.log(`     ${s}`);
  }
}

if (failures || overreach) {
  console.log(`\n실패: 누출 ${failures}건, 과잉제외 ${overreach}건`);
  process.exit(1);
}
console.log('\n모든 피드가 페이지의 robots 지시와 일치한다.');
