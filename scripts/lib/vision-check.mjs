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

export async function verifyHeroImage({ url, name, category, region, country, eventMode = false }) {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: true, reason: 'no-api-key (skipped)' };
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
    // Fail-open ONLY on infrastructure errors (the image itself unreachable is a
    // reject — an unloadable hero is broken anyway).
    if (/image|fetch|url/i.test(e.message)) return { ok: false, reason: `image unusable: ${e.message.slice(0, 60)}` };
    return { ok: true, reason: `vision check unavailable (${e.message.slice(0, 40)})` };
  }
}
