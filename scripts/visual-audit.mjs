#!/usr/bin/env node
// VISUAL hero-image validation — actually LOOKS at each hero with a vision model
// and judges whether it plausibly depicts the venue, instead of guessing from the
// filename. Catches what the keyword blocklist can't: an empty finished plate, a
// Dutch building for a Vietnamese café, a diving shop for a restaurant, a portrait,
// a bridge, the wrong city/country.
//
// Runs in CI (ANTHROPIC_API_KEY from secrets). RESUMABLE: verdicts are stored in
// data/visual-audit.json keyed by slug+image-url, so re-runs only check new/changed
// heroes and it converges under any rate/time limit. Prints a MISMATCH report and
// (in CI) can be wired to a Telegram warning.
//
//   node scripts/visual-audit.mjs                 # audit un-checked venue posts (resumable), cap AUDIT_LIMIT
//   node scripts/visual-audit.mjs --slugs a,b,c   # audit specific posts (ignores done-log)
//   node scripts/visual-audit.mjs --all           # re-audit everything (ignore done-log)
import './lib/env.mjs';
import { auditHeroImage } from './lib/vision-check.mjs';
import { commonsTitle, fetchCommonsMeta, judgeIdentity, loadWorld } from './lib/commons-identity.mjs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { sendTelegram } from './lib/telegram.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const POSTS_DIR = join(ROOT, 'src', 'content', 'posts');
const STORE = join(ROOT, 'data', 'visual-audit.json');
const LIMIT = Number(process.env.AUDIT_LIMIT || 0) || Infinity;
const VENUE = new Set(['restaurant', 'trendy', 'hidden-gem', 'attraction']);

const argSlugs = (() => {
  const i = process.argv.indexOf('--slugs');
  return i > -1 && process.argv[i + 1] ? new Set(process.argv[i + 1].split(',').map((s) => s.trim())) : null;
})();
const AUDIT_ALL = process.argv.includes('--all');

if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY missing'); process.exit(1); }

// key = slug + '\x01' + heroUrl → re-checks automatically when the hero changes.
const store = existsSync(STORE) ? JSON.parse(await readFile(STORE, 'utf8')) : {};

// 판정 로직은 scripts/lib/vision-check.mjs 의 auditHeroImage 하나뿐이다 —
// 순찰(backfill-photos-alt)이 재공개할 때 통과해야 하는 바로 그 기준.
// 프롬프트가 두 벌이던 시절에는 같은 사진을 한쪽은 격리하고 다른 쪽은
// 재공개해서 매일 밤 왕복했다 (2026-08-05).

const files = (await readdir(POSTS_DIR)).filter((f) => f.endsWith('.md'));
let checked = 0, mismatch = 0, weak = 0, failed = 0, quarantined = 0, vetoed = 0;
const flagged = [];
const world = await loadWorld();

// The uploader outranks the model on identity. On 2026-08-14 this audit
// quarantined SEVEN correct heroes in one night — a genuine Chamonix ice cave
// as "a Pakistani glacier", Harbin's Temple of Bliss as "a Confucius temple",
// Verona's Castel San Pietro (an 1852 Austrian barracks, so it LOOKS like an
// administrative building) — because no model looking at a glacier can say
// which country's glacier it is, yet it answers anyway. That is the exact
// lesson audit-photo-identity was built on, applied here in the QUARANTINE
// direction: before a Commons-hosted hero is pulled, ask Commons what the
// uploader said it is. 'supports' (the file's own description/categories name
// the post's city) vetoes the vision verdict; 'contradicts' quarantines with
// more confidence than vision alone ever could; 'unknown' leaves vision in
// charge, as before. Non-Commons heroes are unaffected.
async function metadataVeto(heroUrl, data) {
  const title = commonsTitle(heroUrl);
  if (!title) return null;
  try {
    const meta = (await fetchCommonsMeta([title])).get(title);
    const claim = { region: data.region, country: data.country || 'South Korea',
      venueName: data.place?.name ?? data.title };
    return judgeIdentity(meta, claim, world);
  } catch { return null; } // Commons unreachable → vision stays in charge
}

for (const f of files) {
  if (checked >= LIMIT) break;
  const slug = f.replace(/\.md$/, '');
  if (argSlugs && !argSlugs.has(slug)) continue;
  let data;
  try { ({ data } = matter(await readFile(join(POSTS_DIR, f), 'utf8'))); } catch { continue; }
  const hero = data.heroImage;
  if (!hero || !hero.url) continue;
  // NO SOURCE IS EXEMPT (2026-08-04). This used to skip anything licensed
  // google-places or served from /venue-photos/, on the reasoning that a photo
  // fetched by place_id must be a real photo of that place. Provenance settles
  // WHOSE venue it is; it says nothing about whether the picture is usable — the
  // Google photo set for a venue is user-uploaded and routinely holds a menu
  // card, a receipt, a parking lot, a blurred selfie. Trusting the source meant
  // the audit was structurally unable to see any of that, and the exemption
  // covered nothing today only because Google photos are billing-blocked: the
  // day that unblocks, the site's most common hero becomes its only unaudited
  // one. The verdict store already skips heroes judged before, so re-including
  // them costs a vision call once per NEW photo.
  if (!VENUE.has(data.category)) continue;
  // Quarantined posts are already off the site (draft → 301) and are the alt-photo
  // patrol's job. Auditing them burns vision calls and, worse, re-reports names the
  // owner has already been told about — which reads as "the same problems keep
  // coming back" when they are in fact already handled.
  if (data.draft === true) continue;
  const key = `${slug}\x01${hero.url}`;
  if (!AUDIT_ALL && !argSlugs && store[key]) continue; // already judged this exact hero

  try {
    const v = await auditHeroImage({
      url: hero.url, title: data.title, category: data.category,
      region: data.region, country: data.country || 'South Korea', eventMode: data.category === 'event',
    });
    // UNKNOWN = the image or the API could not be read. Storing it as a verdict
    // would let an outage read as a judgement, and remembering what was actually
    // judged is this store's whole job.
    if (v.verdict === 'UNKNOWN') { failed++; console.log(`  ⚠️  ${slug}: ${v.reason}`); continue; }
    if (v.verdict === 'MISMATCH') {
      const j = await metadataVeto(hero.url, data);
      if (j?.verdict === 'supports') {
        store[key] = { slug, verdict: 'MATCH', reason: `metadata veto: ${j.why} (vision said: ${v.reason})`, reasonKo: null, at: new Date().toISOString() };
        checked++; vetoed++;
        console.log(`  ✓ ${slug}: vision said MISMATCH (${v.reason}) — vetoed, ${j.why}`);
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
    }
    store[key] = { slug, verdict: v.verdict, reason: v.reason, reasonKo: v.reasonKo || null, at: new Date().toISOString() };
    checked++;
    // Korean only. The model's English `reason` used to be interpolated straight
    // into the Telegram message — the third time English reached the owner that
    // way. If the model skips reasonKo, the slug alone is sent rather than English.
    if (v.verdict === 'MISMATCH') {
      mismatch++; flagged.push(`  ✗ ${slug}${v.reasonKo ? ` — ${v.reasonKo}` : ''}`);
      // Quarantine NOW, not at 04:35. This audit used to only write a note and
      // leave the wrong photo live until the next night's patrol — the owner
      // opened a rooftop-club guide four hours after it was flagged and found
      // a street-stall photo still on it (2026-08-03). A KNOWN-wrong photo may
      // not stay published for a single page view; the patrol then repairs the
      // draft and republishes it, exactly as it does for its own quarantines.
      try {
        const p = join(POSTS_DIR, f);
        const { data: d2, content } = matter(await readFile(p, 'utf8'));
        if (d2.draft !== true) {
          d2.draft = true;
          await writeFile(p, `---\n${yaml.dump(d2, { lineWidth: -1, noRefs: true, sortKeys: false })}---\n${content}`, 'utf8');
          quarantined++;
          console.log(`     🚫 ${slug}: quarantined immediately`);
        }
      } catch (e) { console.log(`     ⚠️  ${slug}: quarantine failed — ${e.message}`); }
    }
    else if (v.verdict === 'WEAK') { weak++; }
    console.log(`  ${v.verdict === 'MISMATCH' ? '✗' : v.verdict === 'WEAK' ? '~' : '✓'} ${slug}: ${v.verdict} (${v.reason})`);
  } catch (e) {
    failed++;
    console.log(`  ⚠️  ${slug}: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 200)); // polite
}

await writeFile(STORE, JSON.stringify(store, null, 1) + '\n');
console.log(`\n📸 Visual audit: ${checked} checked · ${mismatch} MISMATCH · ${weak} weak · ${vetoed} vision-vetoed · ${failed} failed.`);
if (flagged.length) { console.log('\nMISMATCHES:'); console.log(flagged.join('\n')); }

// Telegram summary (Korean) when configured and something is off.
if (mismatch > 0) {
  // Say what happens NEXT. Without it the list reads as an open to-do for the
  // owner, when every flagged slug is already queued for the automatic repair
  // patrol via data/visual-audit.json.
  const text =
    `🖼️ Wander Atlas — 시각 이미지 검증\n` +
    `오매칭 ${mismatch}건 / 검사 ${checked}건 (첫 검사분만; 이미 격리된 글은 제외)\n` +
    `🚫 즉시 비공개 처리: ${quarantined}편 — 잘못된 사진이 사이트에 남아 있지 않습니다.\n` +
    `${flagged.slice(0, 15).join('\n')}\n` +
    `\n➡️ 새벽 04:35 순찰이 올바른 사진을 찾으면 자동으로 다시 공개합니다. 따로 하실 일은 없습니다.`;
  // Quarantine already happened; this is the notice that it did. Swallowing a
  // refusal here left the owner unaware that posts had gone dark.
  await sendTelegram(text, { disable_web_page_preview: true });
}
