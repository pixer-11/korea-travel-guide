#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  PRE-PUBLISH IDENTITY & FITNESS AUDIT — one pass over the run's NEW posts,
//  every defect class the week of 2026-08-11…16 taught us, BEFORE the commit.
//
//  Owner (2026-08-16): "제발 처음 발행될 때 한번에 제대로 발행이 되도록 —
//  매번 검수하고 다시 수정하면 비용이 훨씬 많이 든다." Every check below
//  already existed somewhere as an AFTER-publish audit or patrol; each of
//  them caught real defects this week, and each caught them a day late. This
//  file moves the same judgments in front of the publish gate so the post is
//  held (draft) instead of shipped-then-repaired.
//
//  Emits one line per finding, `<CODE> <file.md> — <why>`; the gate picks
//  the file up and quarantines it. Exit 1 when anything was found (the gate
//  treats that as "findings", not "died"), 0 when clean, >1 when broken.
//
//    node scripts/audit-new-post-identity.mjs --since=HEAD   # new/changed posts only (what the gate uses)
//    node scripts/audit-new-post-identity.mjs --slugs=a,b    # named posts
//    node scripts/audit-new-post-identity.mjs               # every live post (slow: Commons calls)
// ─────────────────────────────────────────────────────────────
import { readdirSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import matter from 'gray-matter';
import { commonsTitle, fetchCommonsMeta, judgeIdentity, judgeFoursquareCredit, loadWorld } from './lib/commons-identity.mjs';
import { archiveYearProblem } from './lib/commons.mjs';

const DIR = 'src/content/posts';
const since = (process.argv.find((a) => a.startsWith('--since=')) || '').slice(8);
const slugsArg = (process.argv.find((a) => a.startsWith('--slugs=')) || '').slice(8);
const VENUE = new Set(['restaurant', 'trendy', 'hidden-gem', 'attraction']);
// A title that names a CATEGORY in a CITY, not a place. "Local Restaurant in
// Gangneung" published in July with no venue behind it, then wore whatever
// photo the patrol found for "restaurant, Gangneung" — a soap shop.
const GENERIC_TITLE = /^(local|best|top|hidden|popular|trendy|famous|traditional|good|great|nice)\s+(restaurant|cafe|coffee|market|spot|gem|food|place|attraction|sight|bar|shop|store)s?\s+in\s+/i;

let files;
if (slugsArg) files = slugsArg.split(',').map((s) => `${s.trim()}.md`);
else if (since) {
  const out = execSync(`git status --porcelain -- ${DIR}`, { encoding: 'utf8' });
  const untracked = out.split('\n').map((l) => l.slice(3).trim().replace(/^"|"$/g, '')).filter((p) => p.endsWith('.md')).map((p) => p.split('/').pop());
  const tracked = since === 'HEAD' ? [] : execSync(`git diff --name-only --diff-filter=A ${since} -- ${DIR}`, { encoding: 'utf8' }).split('\n').map((l) => l.trim().split('/').pop()).filter((f) => f?.endsWith('.md'));
  files = [...new Set([...untracked, ...tracked])];
} else files = readdirSync(DIR).filter((f) => f.endsWith('.md'));

const world = await loadWorld();
const findings = [];
const say = (code, f, why) => { findings.push(`${code} ${f} — ${why}`); };

// Batch the Commons lookups: one request per 40 files, not one per post.
const commonsWanted = new Map(); // title -> [{f, data}]
const posts = [];
for (const f of files) {
  let raw; try { raw = readFileSync(`${DIR}/${f}`, 'utf8'); } catch { continue; }
  let data; try { ({ data } = matter(raw)); } catch { continue; }
  if (data.draft === true) continue;
  posts.push({ f, data });

  const isVenue = VENUE.has(data.category);
  const isEvent = data.category === 'event';
  const title = String(data.title || '').split(':')[0].trim();

  // 1) A venue post must be ABOUT a venue.
  if (isVenue && GENERIC_TITLE.test(title)) say('GENERIC-TITLE', f, `제목이 특정 장소가 아닌 범주("${title}")`);

  const hero = data.heroImage;
  if (!hero?.url) continue; // photoless is the photoless policy's business, not identity's

  // 2) Foursquare credit names the venue the photo belongs to. Compare.
  if (/foursquare/i.test(String(hero.credit)) || hero.license === 'foursquare') {
    const j = judgeFoursquareCredit(hero.credit, data.place?.name || title);
    // judgeFoursquareCredit reports spelling variants as contradictions
    // ("Boullion"/"Bouillon", "Naga"/"Nagan") — the memory rule says FSQ credit
    // is report-only for that reason. Block only when the two names share NO
    // leading 4-char stem, i.e. genuinely different words (Le Bon Burger vs
    // Jo's Burger; Love Concept Cafe vs Love Sushi share 'love' → report only).
    if (j.verdict === 'contradicts') {
      const stem = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '').slice(0, 4);
      const credName = (String(hero.credit).match(/\(([^)]+)\)/) || [])[1] || '';
      const a = stem(credName), b = stem(data.place?.name || title);
      const shares = a && b && (a === b || credName.toLowerCase().includes(b) || String(data.place?.name || title).toLowerCase().includes(a));
      // Even the stem test lets translations and native names through as
      // "different" (花城广场/Huacheng Square, Tháp Bà/Po Nagar, "Fast Food 22"
      // as a short form). Live sweep 2026-08-16: every remaining hit was the
      // same place under another spelling, zero real mismatches. So this is
      // REPORT-ONLY (the gate's pick ignores it); the real other-venue cases
      // (Le Bon Burger on Jo's Burger) are the daily identity audit's job,
      // which reads the same credit but with a human on the 🏷️ list.
      if (!shares) console.log(`ℹ PHOTO-CREDIT-DIFFERS ${f} — ${j.why} (report only)`);
    }
  }

  // 3) Event heroes: an archive-dated file is the wrong decade.
  if (isEvent) {
    const name = decodeURIComponent(String(hero.url).split('/').pop() || '');
    const a = archiveYearProblem(name);
    // Recurring festivals look the same every year — Palio, Awa Odori,
    // Tomatina — and an older photo of the same festival is the right one.
    const recurring = /festival|matsuri|palio|tomatina|carnival|parade|fireworks|basho|odori|fair/i.test(String(data.title));
    if (a && !recurring) say('ARCHIVE-PHOTO', f, `이벤트 대표사진이 ${a.replace('archive-', '')}년 사진`);
  }

  // 4) Commons: ask the uploader where this photo is. Queue for batch fetch.
  const t = commonsTitle(hero.url);
  if (t) (commonsWanted.get(t) ?? commonsWanted.set(t, []).get(t)).push({ f, data });

  // 5) Portrait hero with no stored focal point ships with a centre crop that
  //    beheads people (The Weeknd's chin). The gate that approved the photo
  //    now returns focus; a hero without one did not go through that gate.
  if (!hero.focus && (isEvent || isVenue)) {
    // Only when we can tell it's a portrait cheaply: Commons thumb URLs carry
    // width; height is unknown here. Flag events specifically — performers.
    if (isEvent) say('NO-FOCUS', f, '이벤트 대표사진에 초점 좌표가 없음 (인물 크롭 위험) — 검증 게이트를 거치지 않은 사진');
  }
}

const titles = [...commonsWanted.keys()];
for (let i = 0; i < titles.length; i += 40) {
  const chunk = titles.slice(i, i + 40);
  let meta;
  try { meta = await fetchCommonsMeta(chunk); } catch (e) { console.error(`commons fetch failed: ${e.message}`); process.exit(2); }
  for (const t of chunk) {
    for (const { f, data } of commonsWanted.get(t)) {
      if (data.category === 'event') continue; // performers are photographed anywhere
      const j = judgeIdentity(meta.get(t), { region: data.region, country: data.country, venueName: data.place?.name ?? data.title }, world);
      if (j.verdict === 'contradicts') say('PHOTO-WRONG-PLACE', f, j.why);
    }
  }
}

if (findings.length) {
  for (const l of findings) console.log(l);
  console.log(`\n❌ ${findings.length} identity/fitness finding(s) across ${posts.length} post(s)`);
  process.exit(1);
}
console.log(`✓ ${posts.length} post(s) — identity and fitness clean`);
