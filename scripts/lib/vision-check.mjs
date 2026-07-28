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
      `ACCEPT only if it plausibly shows THIS venue (or unmistakably this exact place) AND adds new visual information.\n` +
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

export async function verifyHeroImage({ url, name, category, region, country, eventMode = false }) {
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
