#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  IS THIS A PHOTO OF *THIS* EVENT?
//
//  The event vision gate asks "is this a photo of a concert/festival?" and a
//  photo of SOME other concert answers yes. That is deliberate — the owner's
//  rule (2026-09-07) is that a performer photographed in another city, or
//  another picture of the same artist, is fine, and vision cannot tell Tokyo's
//  stage from Seoul's anyway.
//
//  What vision cannot see at all is WHICH named event. On 2026-09-08 nine
//  published event guides carried a photo of something else entirely, each
//  picked because one word matched:
//
//    Ultra Japan (Tokyo)          ← 2022 Hong Kong "Drive In Ultra" fashion show
//    Hanoi Jazztival              ← Jazztival in Michoacán, Mexico
//    One Universe Festival        ← "Axe Victims Universe", Headbangers Open Air
//    LaLaLa Festival (Jakarta)    ← band "Lalala Napoli" in Brittany
//    Lee Hi world tour            ← Jackie Lee, a different person
//    F✦FOREVER world tour         ← "BOYS FOREVER", a different group
//    Tour de France finish        ← the 2024 Olympic road race
//    Vietnam Flute Festival       ← a stock photo of a flute
//    Uzbekistan Independence Day  ← a US Independence Day reception
//
//  audit-event-heroes had judged one of these MATCH the same morning.
//
//  The filename is what gives them away, and there is no rule that separates
//  them mechanically: some name a foreign place, some name nothing at all. So
//  this does not judge. It RATCHETS. Every event hero whose filename shares at
//  most one meaningful word with the post's title was read by a person on
//  2026-09-08 and its verdict written to the baseline below. A hero that turns
//  up later in that same weak-overlap state, and is not in the baseline, is
//  new and unreviewed — and that is what this fails on.
//
//    node scripts/audit-event-hero-identity.mjs
//    node scripts/audit-event-hero-identity.mjs --list   # show the whole reviewed set
// ─────────────────────────────────────────────────────────────
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { requireExamined } from './lib/examined.mjs';

const DIR = 'src/content/posts';
const BASELINE = 'data/event-hero-identity-reviewed.json';
const LIST = process.argv.includes('--list');

// Words that say nothing about WHICH event this is. Leaving them in made
// "World Tour" or "Live Concert" look like evidence of a match.
const STOP = new Set(['the', 'of', 'in', 'at', 'and', 'an', 'guide', 'travel', 'jpg', 'jpeg',
  'png', 'file', 'commons', 'wikipedia', 'thumb', 'live', 'concert', 'tour', 'world', 'festival',
  'tickets', 'dates', 'venue', 'city', 'show', 'music', 'performing', 'during', 'stage', 'know',
  'what', 'fest']);

const toks = (s) => decodeURIComponent(String(s))
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
  .filter((t) => t.length > 3 && !STOP.has(t) && !/^\d+$/.test(t));

const reviewed = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};

const weak = [];
// A post whose frontmatter will not parse was not examined; say so rather than
// counting it as clean.
const unreadable = [];
// 이 실행이 실제로 몇 편의 행사 글을 열어봤는가. 기준선이 차 있다는 것은
// 과거의 증거일 뿐, 이번 실행이 무언가를 봤다는 증거가 아니다.
let examined = 0;
for (const f of readdirSync(DIR).filter((f) => f.endsWith('.md'))) {
  const raw = readFileSync(join(DIR, f), 'utf8');
  const slug = f.replace(/\.md$/, '');

  // Parse FIRST, then decide. Filtering with patterns before parsing was the
  // third regex mistake in this file: `"category": event` is valid YAML that
  // `/^category:/` misses, and a body code sample containing an unindented
  // `draft: true` made a live post look like a draft. Either way the post was
  // dropped before the parser ever saw it, and a malformed one never reached
  // `unreadable` — so the audit could print its tick over files it had skipped.
  let fm;
  try { fm = matter(raw).data; } catch { unreadable.push(slug); continue; }
  if (fm?.draft === true) continue;
  if (!/^event/.test(String(fm?.category ?? ''))) continue;
  examined++;

  // Read the frontmatter with a YAML parser, not a pattern. Two regexes have
  // already been wrong here: the first took the event's ticket link as the hero
  // url, and its replacement returned the literal ">-" for the 23 live event
  // heroes that write the url as a block scalar —
  //
  //   heroImage:
  //     url: >-
  //       https://upload.wikimedia.org/...
  //
  // so those 23 were skipped as "not a Wikimedia hero" and the audit reported
  // success over photos it had never looked at (found 2026-09-08 by Codex).
  // A parser reads every spelling YAML allows, including quoted keys and inline
  // mappings.
  const url = String(fm?.heroImage?.url ?? '');
  if (!/wikimedia\.org/.test(url)) continue;   // thumb.wikimedia.org counts too

  const title = String(fm?.title ?? '');
  // A filename can be undecodable ("Bad%ZZ.jpg") or contain a literal percent
  // ("100%25_concert.jpg", which throws when decoded twice). Neither is a
  // reason to abandon the audit half way through the posts.
  const rawName = url.split('/').pop() || '';
  let name;
  try { name = decodeURIComponent(rawName); } catch { name = rawName; }
  name = name.replace(/^\d+px-/, '');
  const fileToks = new Set(toks(name));
  // Deduplicated: "Hanoi Jazztival 2026 in Hanoi" against Hanoi_traffic.jpg
  // scored two hits for one word and walked past review.
  const hit = [...new Set(toks(title).filter((t) => fileToks.has(t)))];
  if (hit.length >= 2) continue;   // the filename names this event; nothing to review

  // The baseline stores the full URL. Storing the width-stripped filename made
  // an original Commons file called 800px-Portrait.jpg indistinguishable from a
  // different file called Portrait.jpg, and the second inherited the first's
  // approval.
  weak.push({ slug, title, name, url, hit, known: reviewed[slug] === url });
}

const fresh = weak.filter((w) => !w.known);

console.log(`${weak.length} event hero(es) whose filename barely names the event; ${fresh.length} of them unreviewed`);
for (const u of unreadable) console.log(`EVENT-HERO-IDENTITY: ${u} — frontmatter does not parse, so its hero was not examined`);
for (const w of (LIST ? weak : fresh)) {
  console.log(`${w.known ? '·' : 'EVENT-HERO-IDENTITY:'} ${w.slug}`);
  console.log(`    post : ${w.title}`);
  console.log(`    photo: ${w.name.slice(0, 90)}`);
  console.log(`    shared word(s): ${w.hit.join(', ') || 'none'}`);
}

// --record writes the CURRENT unreviewed set into the baseline. The seeding
// logic lives here, not in a second script: the first attempt kept them apart
// and the copy inherited a bug this file had already fixed, so the baseline
// recorded 26 of 39 and silently blessed the wrong ones.
//
// Only run this after reading the list. It means "a person has looked at every
// one of these and each photo really is this event or this artist".
if (process.argv.includes('--record')) {
  // 읽지 못한 글이 있으면 기준선을 쓰지 않는다. --record 만 이 검사를 건너뛰어
  // 일반 실행·--list 는 실패하는 입력에도 성공으로 끝났다.
  if (unreadable.length) {
    console.log('\nRefusing to record a baseline while posts cannot be read. Fix those first.');
    process.exit(1);
  }
  for (const w of weak) reviewed[w.slug] = w.url;
  mkdirSync('data', { recursive: true });
  writeFileSync(BASELINE, JSON.stringify(reviewed, null, 1) + '\n', 'utf8');
  console.log(`\nrecorded ${weak.length} reviewed hero(es) to ${BASELINE}`);
  process.exit(0);
}

if (fresh.length || unreadable.length) {
  console.log('\nA person has to read these: does the FILENAME describe this event, this artist?');
  console.log(`If it does, record it with --record (after reading, not before).`);
  console.log('If it does not, strip the heroImage block; an event may publish photoless.');
  process.exit(1);
}
// 기준선이 차 있어도 소용없다. 빈 posts 디렉터리 + 과거 기준선이면 0편을 보고도
// "사람이 다 읽었다"를 출력했다. 이번 실행이 연 파일 수로 판단한다.
requireExamined(examined, '발행된 이벤트 글',
  '콘텐츠 경로나 category 필드가 바뀌었나 — 기준선이 차 있어도 이번 실행이 연 파일이 0이면 판정이 아니다');
console.log('✓ every weakly-matched event hero has been read by a person.');
