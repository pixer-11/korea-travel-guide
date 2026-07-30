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

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.VISION_MODEL || 'claude-sonnet-5';

// Anthropic's own URL fetcher is refused by Wikimedia (and can hit >5MB
// originals) — download ourselves with a proper UA and send a ≤1024px JPEG.
async function fetchAsBase64(url) {
  const abs = url.startsWith('/') ? `https://wanderatlasguides.com${url}` : url;
  const res = await fetch(abs, { headers: { 'User-Agent': 'WanderAtlasBot/1.0 (https://wanderatlasguides.com)' } });
  if (!res.ok) throw new Error(`image fetch ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return (await sharp(buf).resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer()).toString('base64');
}

// GALLERY CHECK — a second in-body photo has TWO ways to be wrong: it can show
// the wrong place (same failure as a hero), or it can be a near-duplicate of the
// hero, which reads as filler and cheapens the page. This sends BOTH images at
// once so the model can compare them directly. Strict: reject when unsure.
export async function verifyGalleryImage({ url, heroUrl, name, category, region, country }) {
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
      `Judge ${hero ? 'IMAGE 2' : 'this image'} as an ADDITIONAL in-body photo.\n` +
      `REJECT if: it shows a different country/region (wrong-language signage, wrong architecture/landscape), ` +
      `it is a painting/illustration/diagram/logo/map/screenshot, it shows an unrelated subject, ` +
      `it contradicts the venue type, it is low quality (blurry, dark, heavily cropped), ` +
      `or it shows an identifiable person's face in close-up.\n` +
      (hero
        ? `ALSO REJECT if it is essentially the SAME view as IMAGE 1 (same angle, same subject) — a second photo must ADD something: a different room, the exterior vs the interior, the food, the surroundings.\n`
        : '') +
      `REJECT if it is only NEAR the place rather than OF it: a random building on the same street, a generic alley, a car park, a signboard, a close-up of an object that could be anywhere. Being in the right neighbourhood is NOT enough.\n` +
      `REJECT if the photo shows the place in a state a visitor will not see: under construction, scaffolded, being restored, closed off, or before it was finished. REJECT a photograph OF A SIGN, notice, plaque, map, poster, banner or screen — text about the place is not a picture of it, however clearly it names it. These pass a "is this the right subject" test and still cannot be published.\n` +
      `The bar is CERTAINTY, not plausibility. If your own reason would contain "probably", "plausibly", "likely", "appears to be" or "could be", the answer is false. A dish photographed on a plain table, a drink, a menu close-up or any framing that could have been taken at a thousand other places does NOT identify this venue, however appetising it looks — reject it unless the venue itself is visible around it (its room, its signage, its terrace, its view).\n` +
      `A post with ONE correct hero is a perfectly good outcome; a second photo is a bonus and is never worth a doubt.\n` +
      `ACCEPT only if a reader who knows this place would recognise it as THIS venue, AND the photo adds new visual information.\n` +
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

export async function verifyHeroImage({ url, name, category, region, country, eventMode = false, existing = false }) {
  // Fail CLOSED. This used to return ok:true when the key was missing or the API
  // errored, so a run with an empty secret or a rate-limited window wrote every
  // unverified candidate straight onto the posts and logged it as ✅ FIXED.
  // Approving a photo nobody looked at is the one outcome this gate exists to
  // prevent; keeping the current hero is always the safer failure.
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, reason: 'no-api-key — refusing to approve unchecked' };
  const what = eventMode
    ? `the event "${name}" (a ${category}) in ${region}, ${country}. IMPORTANT for events: a photo of the performer/athlete/team TAKEN ANYWHERE (any country, any venue, foreign signage in background is fine), or of this event type (e.g. an MMA cage, a concert stage, a race), is a CORRECT hero — do NOT require the host city to be visible`
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
      max_tokens: 200,
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
              `REJECT a photo taken FROM this place rather than OF it: if the landmark is where the camera stood and is not itself in the frame, it is the wrong picture however correctly it is captioned.\n` +
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
      `Answer ONLY JSON: {"ok": true|false, "reason": "<max 12 words>"}`,
          },
        ],
      }],
    });
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const j = JSON.parse(text.replace(/^[\s\S]*?\{/, '{').replace(/\}[\s\S]*$/, '}'));
    return { ok: !!j.ok, reason: String(j.reason || '') };
  } catch (e) {
    if (/image|fetch|url/i.test(e.message)) return { ok: false, reason: `image unusable: ${e.message.slice(0, 60)}` };
    // An overloaded/rate-limited API is NOT evidence the photo is right.
    return { ok: false, reason: `vision unavailable (${e.message.slice(0, 40)}) — not approved` };
  }
}
