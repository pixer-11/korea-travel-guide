
// ⚠️ NO VISION GATE — 2026-08-01 감사 지적, 08-04 차단.
// 정규 사진 경로(generate.mjs · backfill-photos-alt.mjs · discover-events.mjs)는
// 전부 fail-closed vision 게이트를 거치지만 이 도구는 예외다. 어떤 워크플로에도
// 연결돼 있지 않은 채 남아 있어서, 수동으로 한 번 돌리면 지금까지 격리한 오사진을
// 검증 없이 되살릴 수 있었다. 의도적으로만 실행되도록 막는다.
if (process.env.I_KNOW_NO_VISION !== '1') {
  console.error('');
  console.error('⛔ 이 스크립트는 AI 시각검증 없이 대표사진을 씁니다.');
  console.error('   잘못된 사진이 그대로 발행될 수 있어 기본 차단돼 있습니다.');
  console.error('   정상 경로: 매일 04:35 alt-photos 순찰(비전 게이트 포함).');
  console.error('   그래도 실행하려면 I_KNOW_NO_VISION=1 을 붙이세요.');
  console.error('');
  process.exit(1);
}

// Give every post a REAL, ON-TOPIC, UNIQUE hero.
//   - EVENT posts: try the specific act/fighter first (namedVenue = event name →
//     keyToken anchor), then the event-TYPE image (eventTopic: MMA cage, race
//     bike, concert stage…), then city — so an event hero is never an unrelated
//     ambulance/building.
//   - Non-event posts: fix placeholders + de-dupe (keep the most place-identifying
//     post on a shared image, re-resolve the rest) using city/venue imagery.
// A site-wide `used` set (URL + photo-id) guarantees no two posts share a photo.
//
//   node --env-file=.env scripts/reresolve-images.mjs           # dry-run
//   node --env-file=.env scripts/reresolve-images.mjs --apply   # write files
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveHero, unsplashNum, eventTopic } from './lib/images.mjs';

const DIR = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const APPLY = process.argv.includes('--apply');
const KEEP_RANK = { attraction: 0, 'hidden-gem': 1, trendy: 2, restaurant: 3, event: 4 };

const eventName = (title) => String(title).split(/:\s*(?:What to Know|A Visitor|Dates, Tickets)/i)[0].trim();

const files = (await readdir(DIR)).filter((f) => f.endsWith('.md'));
const posts = [];
for (const f of files) {
  const t = await readFile(join(DIR, f), 'utf8');
  const fm = t.slice(0, t.indexOf('\n---', 3));
  const get = (k) => (fm.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1] || '').trim().replace(/^["']|["']$/g, '');
  const heroBlock = fm.split(/^heroImage:/m)[1] || '';
  const url = (heroBlock.match(/^\s+url:\s*(.+)$/m)?.[1] || '').trim();
  posts.push({ f, title: get('title'), region: get('region'), country: get('country'), category: get('category'), url, t });
}

// Seed the site-wide used set from all current images.
const used = new Set();
for (const p of posts) {
  if (!p.url || p.url.includes('placeholder')) continue;
  used.add(p.url);
  const n = unsplashNum(p.url);
  if (n) used.add(n);
}

// Targets: every event post + non-event placeholders + non-event dup extras.
// `--no-events` skips events entirely — use it to safely fix ONLY placeholder/dup
// venues without touching already-good event heroes (avoids event-image regression).
const SKIP_EVENTS = process.argv.includes('--no-events');
const targetSet = new Map();
for (const p of posts) if (p.category === 'event' && !SKIP_EVENTS) targetSet.set(p.f, p);
const groups = new Map();
for (const p of posts) {
  if (p.category === 'event') continue;
  if (!p.url || p.url.includes('placeholder')) { targetSet.set(p.f, p); continue; }
  const key = unsplashNum(p.url) || p.url;
  (groups.get(key) || groups.set(key, []).get(key)).push(p);
}
for (const [, ps] of groups) {
  if (ps.length < 2) continue;
  ps.sort((a, b) => (KEEP_RANK[a.category] ?? 9) - (KEEP_RANK[b.category] ?? 9));
  for (const p of ps.slice(1)) targetSet.set(p.f, p);
}
const targets = [...targetSet.values()];

console.log(`${targets.length} target(s) (${APPLY ? 'APPLY' : 'dry-run'})\n`);
let done = 0, failed = 0;
for (const p of targets) {
  if (p.url) { used.delete(p.url); const n = unsplashNum(p.url); if (n) used.delete(n); }
  const isEvent = p.category === 'event';
  const ev = isEvent ? eventName(p.title) : null;
  const hero = await resolveHero({
    namedVenue: isEvent ? ev : null,
    region: p.region,
    topic: isEvent ? eventTopic(ev) : null,
    country: p.country || 'South Korea',
    used, allowUnsplash: true, selfHost: false,
    preferTopic: isEvent, // event → on-topic type image over city fallback
    eventMode: isEvent,   // event → allow portrait performer/athlete photos
  });
  if (!hero?.url || hero.url.includes('placeholder')) {
    failed++; console.log(`  ✗ [${p.category}] ${p.region} (${p.f}) — none`);
    continue;
  }
  done++;
  const kind = isEvent ? `event:"${ev}"→${eventTopic(ev)}` : p.category;
  console.log(`  ✓ ${kind}\n      ${hero.url.slice(0, 76)}`);
  if (APPLY) {
    const block = `heroImage:\n  url: ${JSON.stringify(hero.url)}\n  credit: ${JSON.stringify(hero.credit)}\n  license: ${JSON.stringify(hero.license)}\n  source: ${JSON.stringify(hero.source)}`;
    const out = p.t.replace(/^heroImage:[\s\S]*?(?=\ngallery:)/m, block);
    if (out !== p.t) await writeFile(join(DIR, p.f), out, 'utf8');
  }
}
console.log(`\n${done} resolved, ${failed} failed.`);
