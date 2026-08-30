// ─────────────────────────────────────────────────────────────
//  VISION HERO CHECK — an AI actually LOOKS at a candidate hero image and
//  judges whether it fits the post. Token/filename matching alone has proven
//  insufficient twice (police station on a beach post; a Swedish fairy-tale
//  painting on a Krabi restaurant post; "name matches but photo doesn't fit").
//  User directive 2026-07-26: every hero must pass visual verification before
//  it is published — reject anything that merely shares a name.
//
//  verifyHeroImage() returns { ok, reason }. STRICT by design: when in doubt,
//  reject — the generator then tries another candidate venue (never publishes
//  a wrong photo, never publishes photoless).
// ─────────────────────────────────────────────────────────────
import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import { imageFetch } from './image-fetch.mjs';
import { HEAD_BOX_ASK, HEAD_BOX_JSON, focusFromReply } from './head-box.mjs';

// 2026-08-30, 픽서님: "워터마크 없는걸로 바꿔줘." 푸켓 채식축제에 붙을 뻔한
// Flickr 사진 6장이 전부 `Phuket@photographer.net`을 박고 있었다. 사진 자체는
// 정확했고 — 그래서 통과했다. 게이트가 "이 축제가 맞나"만 묻고 "대문에 걸
// 만한가"는 안 물었기 때문이다.
//
// 마지막 문장이 중요하다: 간판·현수막·티셔츠에 **원래 찍혀 있던** 글자까지
// 거르면 거리 사진이 전멸한다. 거르는 건 나중에 **덧입힌** 표식뿐이다.
export const WATERMARK_RULE =
  'REJECT a photo carrying a visible WATERMARK or overlaid credit — a photographer name, ' +
  'website or url, stock-agency logo, signature or copyright line superimposed on the picture. ' +
  'This is a paid travel guide and a stamped photo reads as borrowed. ' +
  'Judge only marks ADDED ON TOP of the photo: lettering that was really there in the scene ' +
  '(shop signs, banners, jerseys, street notices) is part of the picture and is fine.';

// 두 게이트가 실제로 프롬프트에 끼워 넣는 블록. 상수로 두는 이유는 한쪽만
// 고쳐서 갈라지는 걸 막기 위해서다(vision-check.test.mjs가 지킨다).
export const HERO_PROMPT_RULES = `${WATERMARK_RULE}\n`;
export const AUDIT_PROMPT_RULES = `${WATERMARK_RULE}\nAnswer MISMATCH for such a stamped photo.\n`;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.VISION_MODEL || 'claude-sonnet-5';

// Anthropic's own URL fetcher is refused by Wikimedia (and can hit >5MB
// originals) — download ourselves with a proper UA and send a ≤1024px JPEG.
async function fetchAsBase64(url) {
  const abs = url.startsWith('/') ? `https://wanderatlasguides.com${url}` : url;
  // upload.wikimedia.org throttles publish-time bursts with 429; one such
  // answer used to fail the candidate outright ("candidate unusable"), which
  // is how a correct photo became a missing photo. Retry the transient codes.
  // imageFetch adds the UA ladder on top of that retry: a host that answers
  // our honest name with 502 (Flickr does, ~5 times in 6) gets one more try
  // under a browser UA. Without it a good photo reads as "image unusable".
  const res = await imageFetch(abs, { tries: 3, baseMs: 2500 });
  if (!res.ok) throw new Error(`image fetch ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return (await sharp(buf).resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer()).toString('base64');
}

// GALLERY CHECK — a second in-body photo has TWO ways to be wrong: it can show
// the wrong place (same failure as a hero), or it can be a near-duplicate of the
// hero, which reads as filler and cheapens the page. This sends BOTH images at
// once so the model can compare them directly. Strict: reject when unsure.
export async function verifyGalleryImage({ url, heroUrl, name, category, region, country, eventMode = false }) {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, reason: 'no-api-key (gallery needs verification)' };
  let candidate, hero;
  try {
    candidate = await fetchAsBase64(url);
  } catch (e) {
    return { ok: false, reason: `candidate unusable: ${e.message.slice(0, 50)}` };
  }
  try {
    hero = await fetchAsBase64(heroUrl);
  } catch {
    hero = null; // hero unreadable → fall back to accuracy-only judging
  }
  const content = [];
  if (hero) {
    content.push({ type: 'text', text: 'IMAGE 1 — the photo already used at the top of the article:' });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: hero } });
    content.push({ type: 'text', text: 'IMAGE 2 — the candidate for a SECOND photo inside the article:' });
  }
  content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: candidate } });
  content.push({
    type: 'text',
    text:
      `You are a photo editor for a travel guide where accuracy is the #1 rule. The article is about ` +
      `"${name}" — a ${category} in ${region}, ${country}.\n` +
      // Events flip the identity rule, exactly as the hero check does: the
      // right photo is the rider, the band, the race — taken at ANY venue, any
      // year. Requiring the host town to be recognisable is how a MotoGP round
      // with hundreds of free photos went out as a two-slide set.
      (eventMode
        ? `THIS IS AN EVENT ARTICLE: a photo of the performer/athlete/team taken anywhere, or of this event type in action (the race, the stage, the ring), IS CORRECT — do NOT require this specific venue or town to be visible. Still reject: unrelated people, logos/posters/screens, a different sport or act.\n`
        : '') +
      `Judge ${hero ? 'IMAGE 2' : 'this image'} as an ADDITIONAL in-body photo.\n` +
      `REJECT if: it shows a different country/region (wrong-language signage, wrong architecture/landscape), ` +
      `it is a painting/illustration/diagram/logo/map/screenshot, it shows an unrelated subject, ` +
      `it contradicts the venue type, it is low quality (blurry, dark, heavily cropped), ` +
      `or it shows an identifiable person's face in close-up.\n` +
      (hero
        ? `ALSO REJECT if it is essentially the SAME view as IMAGE 1 (same angle, same subject) — a second photo must ADD something: a different room, the exterior vs the interior, the food, the surroundings.\n`
        : '') +
      // The identity bar depends on WHAT the subject is. "Vieux Lyon" is a
      // district: its ordinary lanes ARE the subject, and demanding that a
      // lane be "identifiable as Vieux Lyon specifically" rejected all eight
      // real, geotagged, correctly-titled photos of it — the owner got a
      // one-photo carousel for one of Europe's most photographed quarters.
      // Candidates arrive here already anchored by metadata (file title names
      // the subject, geotag within 30km — see commons.mjs), so for an AREA the
      // vision job is CONSISTENCY, not identification.
      (eventMode ? '' :
        `FIRST decide what kind of subject "${name}" is, then apply the matching bar:\n` +
        `- SINGLE VENUE OR LANDMARK (a shop, cafe, temple, tower, one specific building): REJECT if the photo is only NEAR it rather than OF it — a random building on the same street, a generic alley, a car park, a close-up of an object that could be anywhere. Being in the right neighbourhood is NOT enough. The bar is CERTAINTY, not plausibility: if your reason would contain "probably", "plausibly", "likely", "appears to be" or "could be", answer false. A dish on a plain table, a drink or a menu close-up does NOT identify a venue — reject unless the venue itself is visible around it (its room, its signage, its terrace, its view). ACCEPT only if a reader who knows this place would recognise it as THIS venue.\n` +
        `- AREA (a district, old town, quarter, neighbourhood, island, beach, harbour, market street, promenade): its ordinary streets, squares, waterfronts and building ensembles ARE the subject — do NOT reject a scene within it as "generic" or "not specifically identifiable". Instead verify CONSISTENCY: architecture, geography, signage language and vegetation must match ${region}, ${country}${hero ? ' and be plausibly the same locale as IMAGE 1' : ''} — REJECT on any mismatch, or if the scene could not be this area.\n` +
        `- VIEWPOINT or observation deck: the panorama SEEN FROM it is what visitors come for — a skyline or landscape photo taken from it is CORRECT; judge it for consistency with ${region}, ${country} like an area.\n`) +
      `REJECT if the photo shows the place in a state a visitor will not see: under construction, scaffolded, being restored, closed off, or before it was finished. REJECT a photograph OF A SIGN, notice, plaque, map, poster, banner or screen — text about the place is not a picture of it, however clearly it names it. These pass a "is this the right subject" test and still cannot be published.\n` +
      `A post with ONE correct hero is a perfectly good outcome; a second photo is a bonus and is never worth a doubt.\n` +
      (eventMode
        ? `ACCEPT if it clearly shows this event's sport/act or its performers, AND adds new visual information.\n`
        : `ACCEPT when the matching bar above is met AND the photo adds new visual information.\n`) +
      `Answer ONLY JSON: {"ok": true|false, "reason": "<max 12 words>"}`,
  });
  // One retry: a truncated/preamble-wrapped reply is a transport hiccup, not a
  // verdict — without this we silently drop photos that would have passed.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const msg = await client.messages.create({ model: MODEL, max_tokens: 400, messages: [{ role: 'user', content }] });
      const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('no JSON in reply');
      const j = JSON.parse(m[0]);
      return { ok: !!j.ok, reason: String(j.reason || '') };
    } catch (e) {
      if (attempt === 1) {
        // Unlike heroes, a gallery photo is optional — never fail open.
        return { ok: false, reason: `vision check failed (${e.message.slice(0, 40)})` };
      }
    }
  }
  return { ok: false, reason: 'vision check failed' };
}

export async function verifyHeroImage({ url, name, category, region, country, eventMode = false, existing = false, venue = '' }) {
  // Fail CLOSED. This used to return ok:true when the key was missing or the API
  // errored, so a run with an empty secret or a rate-limited window wrote every
  // unverified candidate straight onto the posts and logged it as ✅ FIXED.
  // Approving a photo nobody looked at is the one outcome this gate exists to
  // prevent; keeping the current hero is always the safer failure.
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, reason: 'no-api-key — refusing to approve unchecked' };
  const what = eventMode
    ? `the event "${name}" (a ${category}) in ${region}, ${country}. IMPORTANT for events: a photo of the performer/athlete/team TAKEN ANYWHERE (any country, any venue, foreign signage in background is fine), or of this event type (e.g. an MMA cage, a concert stage, a race)${venue ? `, or of its VENUE "${venue}" (the stadium, arena, circuit, park or hall itself — empty or in use)` : ''}, is a CORRECT hero — do NOT require the host city to be visible. A photo from a PAST edition of this event, in any year and in whatever city hosted it then (Hangzhou 2023 for Nagoya 2026), is a CORRECT hero — an event guide is illustrated with archive photos by design; never reject for the year, edition or host city`
    : `"${name}" — a ${category} in ${region}, ${country}`;
  let data;
  try {
    data = await fetchAsBase64(url);
  } catch (e) {
    return { ok: false, reason: `image unusable: ${e.message.slice(0, 60)}` };
  }
  try {
    const msg = await client.messages.create({
      model: MODEL,
      // 200 was enough for the JSON and not for the preamble the model writes
      // before it on an ambiguous event photo: the same Asian Games and Xi'an
      // Grand Prix files came back "Unexpected end of JSON input" on three
      // runs (2026-08-23) — truncation, read as an outage, and the posts
      // stayed photoless. Same class as the translation judge's 600 (08-16).
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
          {
            type: 'text',
            text:
              `You are a photo editor for a travel guide where accuracy is the #1 rule. ` +
              `Would this image be an HONEST hero photo for an article about ${what}?\n` +
              `REJECT if: it clearly shows a different country/region (wrong-language signage, wrong architecture/landscape), ` +
              `it is a painting/illustration/diagram/logo/map, it shows an unrelated subject (an animal, a portrait of a person for a venue article, ` +
              `a vehicle, an unrelated building type), or it obviously contradicts the venue type (e.g. a church for a cafe).\n` +
              `For restaurants/cafes ALSO REJECT: isolated product-style food shots (studio lighting, plain/white background, packshot look) — ` +
              `the hero should show the actual PLACE (exterior, interior, or a dish clearly photographed inside a real venue setting).\n` +
              `ACCEPT if: it plausibly shows this venue or this exact kind of place in this locale. When unsure, REJECT.\n` +
              `A HERO must be REPRESENTATIVE — the view a visitor would recognise this place by. Reject an incidental fragment (one house on a coastal-village page, a doorway, a wall, a parked car, a close-up of an object) even when it was taken at the right address.\n` +
              // These three clauses were on the GALLERY prompt and not on this one,
              // so the optional second photo was judged more strictly than the
              // image at the top of the article. A Cloud Gate carousel shipped
              // with a crane over the unfinished sculpture and a blurred closure
              // notice, and its hero was the skyline photographed from under the
              // sculpture — all three passed a gate that only asked "is this
              // about the right place?", which they were.
              `REJECT a photo taken FROM this place rather than OF it: if the landmark is where the camera stood and is not itself in the frame, it is the wrong picture however correctly it is captioned. ` +
              // A VIEWPOINT inverts that rule: nobody photographs the platform,
              // they photograph the view — the very photos this clause was
              // rejecting nightly for Khao Rang until the post faced retirement
              // over a subject with plenty of real pictures.
              `EXCEPTION: if the subject IS a viewpoint, observation deck or scenic overlook, the panorama seen FROM it is what visitors come for — a photo of that view, consistent with this locale, is a CORRECT hero.\n` +
              `REJECT the place in a state a visitor will not see: under construction, scaffolded, being restored, closed off, or before it was finished.\n` +
              `REJECT a photograph OF A SIGN, notice, plaque, map, poster, banner or screen — text about the place is not a picture of it, however clearly it names it.\n` +
              // Re-audit is the OPPOSITE bar. "When unsure, REJECT" is right for
              // choosing a new photo and wrong for judging one that already
              // passed: the night the selection rules got stricter, the patrol
              // re-ran them against live heroes and unpublished 29 posts —
              // Positano, the Grand Palace, Florence's cathedral — over photos
              // that were real, correct, and merely unglamorous.
              (existing
                ? `THIS PHOTO IS ALREADY PUBLISHED on this article and passed review before. You are re-auditing, not selecting. Answer ok:false ONLY if it is CLEARLY wrong: a different place or business, construction, signage, an unrelated subject. A stylistically weak but genuine photo of the right place (a rooftop detail, an interior, a quiet corner) must be KEPT — unpublishing a real page over taste is worse than an unglamorous photo. When unsure, KEEP (ok:true).\n`
                : '') +
              // The gate approved a perfect portrait of The Weeknd and a
              // perfect Post Malone stage shot; the 16:9 hero frame then
              // cropped centre-on and both pages showed a chin and a torso
              // (owner, 2026-08-15: "시각검증이 겨우 이따위냐"). Correctness
              // was never the problem — the gate had simply never been asked
              // where the subject IS. Now it says, and the page crops toward
              // it (heroImage.focus → object-position). Every photo, every
              // caller — this is the one function all hero paths pass through.
              // A single point sat 8–17% below the face on every portrait
              // measured (2026-08-23); the HEAD BOX (hair → chin) replaces it.
              // Wording and parser live in lib/head-box.mjs — one for every
              // prompt that produces a focus.
              HERO_PROMPT_RULES +
              `${HEAD_BOX_ASK}\n` +
      `Answer ONLY JSON: {"ok": true|false, "reason": "<max 12 words>", ${HEAD_BOX_JSON}}`,
          },
        ],
      }],
    });
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    // Name truncation for what it is, so the log can tell it from an outage.
    if (msg.stop_reason === 'max_tokens' && !/\}\s*$/.test(text.trim())) throw new Error('reply truncated at max_tokens');
    const j = JSON.parse(text.replace(/^[\s\S]*?\{/, '{').replace(/\}[\s\S]*$/, '}'));
    const focus = focusFromReply(j);
    return { ok: !!j.ok, reason: String(j.reason || ''), ...(focus ? { focus } : {}) };
  } catch (e) {
    if (/image|fetch|url/i.test(e.message)) return { ok: false, reason: `image unusable: ${e.message.slice(0, 60)}` };
    // An overloaded/rate-limited API is NOT evidence the photo is right.
    return { ok: false, reason: `vision unavailable (${e.message.slice(0, 40)}) — not approved` };
  }
}

// ─────────────────────────────────────────────────────────────
//  AUDIT VERDICT — the SECOND opinion, and the one that quarantines.
//
//  This prompt lived inside visual-audit.mjs while backfill-photos-alt.mjs used
//  verifyHeroImage() above, so the site ran two independent judges with
//  different wording and different thresholds. On 2026-08-05 that produced a
//  loop the owner saw as "the same problems keep coming back": the audit
//  quarantined five posts as MISMATCH overnight, the patrol re-approved the very
//  same image URLs hours later, reported "교체 완료 · 전부 시각 검증 통과" — and
//  the photos had not changed at all. Re-judged here, all five failed again.
//
//  One picture cannot have two truths. The patrol must clear the SAME bar that
//  quarantined the post before it may republish, so this is exported and both
//  callers use it.
export async function auditHeroImage({ url, title, category, region, country, eventMode = false, venue = '' }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { verdict: 'UNKNOWN', reason: 'no-api-key', reasonKo: '' };
  }
  let data;
  try {
    data = await fetchAsBase64(url);
  } catch (e) {
    return { verdict: 'UNKNOWN', reason: `image unusable: ${e.message.slice(0, 50)}`, reasonKo: '' };
  }
  const prompt = `You are validating the hero image of a travel guide. The post is:
Title: "${title}"
Venue type: ${category}
Place: ${region}, ${country}

${eventMode ? `This post is about an EVENT. A photo of the same act/team/sport, of this event type, or of its venue${venue ? ` — the venue is "${venue}" (a photo of that building, hall, stadium, circuit or resort, inside or outside, is a MATCH)` : ''} from ANY year or edition is a MATCH — an event guide is illustrated with archive photos by design. A close-up or PORTRAIT of a performer — on stage or off, with or without venue context — is a MATCH when the person could plausibly be this event's act: you cannot recognize faces, and the act's identity is verified separately from the file's metadata (the "random person's portrait" rule below is for venues, not events; it cost this pipeline six event posts their genuine performer photos, 2026-08-20~29). Answer MISMATCH for a portrait ONLY when the person visibly belongs to a DIFFERENT domain than this event — an athlete in uniform for a concert, a musician for a sports match (that rule caught a baseball player offered as a rapper's hero, 2026-08-24 — keep catching those). For a multi-sport Games (Asian Games, Olympics, SEA Games) a photo of ANY sport or ceremony at a past edition is a MATCH. A past edition may have been held in a DIFFERENT city or country — that is still a MATCH; do not answer MISMATCH for the city, the country, or the year. NEVER answer MISMATCH because the photo shows a different year or edition; judge only whether it shows the wrong act, sport or place.
` : ''}Look at the image. Does it plausibly depict THIS venue, its food, its interior/exterior, or its immediate street/setting?
Answer MISMATCH if the image is clearly wrong — e.g. an empty/finished plate with only scraps, a building whose architecture is from the wrong country, the wrong city/country, or an unrelated subject (a grocery/convenience store for a café, an insect specimen, a museum statue/object, a random person's portrait, diving equipment, a vehicle/landscape/bridge for a restaurant, unrelated stock).
${AUDIT_PROMPT_RULES}Answer WEAK if it's the right place/country but generic and only loosely related.
Answer MATCH if it plausibly fits.
Reply with ONLY a compact JSON object: {"verdict":"MATCH|WEAK|MISMATCH","reason":"<8 words max>","reasonKo":"<같은 내용을 한국어로, 12자 이내>"}
reasonKo must be written in Korean — it is sent to the site owner, who reads Korean, and an English reason has reached him twice before.`;
  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
          { type: 'text', text: prompt },
        ],
      }],
    });
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const m = text.match(/\{[\s\S]*\}/);
    const j = m ? JSON.parse(m[0]) : null;
    if (!j) return { verdict: 'UNKNOWN', reason: 'unparseable', reasonKo: '' };
    const ko = String(j.reasonKo || '').slice(0, 40);
    return {
      verdict: String(j.verdict || 'UNKNOWN').toUpperCase(),
      reason: String(j.reason || '').slice(0, 60),
      // Keep reasonKo only when it actually contains Hangul — a model answering
      // in English regardless would otherwise put English back into the owner's
      // chat through the very field added to prevent it.
      reasonKo: /[가-힣]/.test(ko) ? ko : '',
    };
  } catch (e) {
    // UNKNOWN, never MATCH: an outage must not read as approval.
    return { verdict: 'UNKNOWN', reason: `vision unavailable (${e.message.slice(0, 40)})`, reasonKo: '' };
  }
}

// ─────────────────────────────────────────────────────────────
//  VERDICT RECORDING — data/visual-audit.json is the single truth
//  validate-content reads to decide UNVERIFIED-PHOTO. Every pipeline that
//  ADOPTS a hero after verifyHeroImage approval must record that verdict
//  here, or the next validate run reports a freshly-verified photo as
//  never-checked (2026-08-08: the dawn patrol replaced 9 heroes, all
//  vision-approved, and the evening report flagged them as unverified —
//  same hole the event gate had). Call AFTER the hero is actually written
//  to the post, with the exact URL that was written.
// ─────────────────────────────────────────────────────────────
import { readFile as _rf, writeFile as _wf } from 'node:fs/promises';
const VERDICT_STORE = new URL('../../data/visual-audit.json', import.meta.url);

export async function recordHeroVerdict(slug, url, verdict, reason) {
  let store = {};
  try { store = JSON.parse(await _rf(VERDICT_STORE, 'utf8')); } catch { /* first write */ }
  store[`${slug}\x01${url}`] = { slug, verdict, reason: String(reason || '').slice(0, 200), at: new Date().toISOString() };
  await _wf(VERDICT_STORE, JSON.stringify(store, null, 2), 'utf8');
}
