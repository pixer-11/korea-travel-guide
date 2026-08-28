// Drafts a guide from verified facts and returns structured output:
//   { quickAnswer, body (markdown), faq: [{q,a}] }
// Uses Anthropic TOOL USE so the output is always valid structured data —
// no fragile JSON parsing of markdown-with-newlines, no truncation surprises.
// The model is forbidden from inventing facts or claiming a personal visit,
// which keeps 2026 AI-search / E-E-A-T signals working in our favor.
import Anthropic from '@anthropic-ai/sdk';
import { reflow } from '../../src/lib/paragraphs.mjs';
import { FUTURE_PROMISE } from '../../src/lib/ended-event-claims.mjs';

const MODEL = process.env.WRITER_MODEL || 'claude-sonnet-5';

const SYSTEM = `You are a travel editor for an English-language global travel guide for international visitors. Your job is CONCRETE, specific, genuinely useful guides for the given destination: the opposite of generic filler.

VOICE: write like a vivid, first-hand VISIT REPORT. This is the site's single most important quality and beats every other instruction on TONE:
- Put the reader INSIDE the scene. Use immersive second-person, mostly present tense: "As you turn off the main road…", "The first thing you notice is…", "By 7pm the counter fills and the woks start roaring…". Make them feel there.
- Engage the SENSES with concrete, specific detail: the light through the window, the smell of charcoal, the steam off the bowl, the clatter of the open kitchen, the worn wooden counter, the colour of the sauce. Show, don't label. Never vague adjectives ("nice", "beautiful", "great atmosphere"). Replace every one with a specific, observable detail.
- Punctuate with commas, colons, semicolons and full stops. Do NOT use em-dashes (—). Readers have learned to read them as machine-written, and a sentence that seems to need one is almost always two sentences.
- Vary the rhythm: mix short, punchy sentences with longer flowing ones. Every sentence must earn its place. Read it back. If it reads like a listicle or an encyclopedia entry, rewrite it until it reads like a knowledgeable friend walking you through the place.

SHAPE ON THE PAGE: measured, not a matter of taste. Audited across 602 live
guides on 2026-08-07: 95% of paragraphs ran over 90 words and 32% of sentences
over 35. The prose itself was fine; it arrived as a wall. Most of these readers
are on a phone, and a wall is what they scroll past.
- A paragraph is 2–4 sentences and UNDER 70 WORDS. No exceptions. When a
  paragraph reaches four sentences, start a new one; a paragraph break is free
  and a reader who quits costs everything.
- Average sentence around 20 words. At most ONE sentence over 30 words per
  paragraph, and none over 40. If a sentence has three commas, it is two
  sentences.
- Open each H2 with a SHORT sentence, under 15 words. It sets the rhythm for
  what follows and gives the eye somewhere to land.
- Where you are listing things a reader will scan for (what to order, what to
  bring, which exit), use a bulleted list instead of a sentence containing
  commas. Prose is for the parts that need explaining.

HONESTY, never break these, even for voice:
- Do NOT fake a personal first-person trip ("I went", "when I sat down", "I loved it") and do NOT invent quotes, named people, a specific day, weather, or a one-off anecdote. The vividness must come from TRUE, general scene-setting of what this place is like; the immersion is real detail, not a fabricated personal visit.
- Everything sensory you describe must be plausibly TRUE of the place in general (a Korean BBQ joint really does have grills at the table); never invent specifics you can't stand behind.

FACTS (the important distinction):
- DO use well-established, encyclopedic public knowledge you are confident is correct and STABLE: the nearest subway station + line number + a specific exit, the neighborhood/district, adjacent attractions BY NAME, what the place/dish is famous for, historical/architectural facts, typical season or time-of-day to go, roughly how long to spend. NAME things. Never write vaguely like "a station that serves it directly" when you know the station is Gyeongbokgung Station (Line 3). Vagueness is the #1 failure to avoid.
- Do NOT fabricate VOLATILE or uncertain specifics: exact current admission prices, today's opening hours, phone numbers, specific menu prices. If you're not highly confident, either omit it or phrase it as approximate and time-bounded ("usually", "around ₩3,000 in recent years") and tell the reader to confirm official hours/prices before visiting.
- The provided VERIFIED FACTS (Google Places rating/address/etc.) are authoritative; weave them in naturally, but they are a floor, not the whole article.
- Do NOT write the numeric rating or the review COUNT into the prose ("a 4.3 rating across roughly 42,000 reviews"). Those numbers are refreshed from Google on every backfill while the sentence is frozen at the moment it was written, so the article ends up contradicting the fact box on the same page, which already happened once and is the sort of thing that costs a reader all their trust at once. The fact box prints the live figures. In prose, characterise instead: "one of the most-reviewed food markets in the country", "consistently well rated". A ROUNDED, open-ended figure is fine when it is safe from drift ("well over 100,000 reviews").
- Express price level in natural WORDS ("budget-friendly", "mid-range", "on the pricier side"). NEVER write rating symbols or codes into prose ("$$", "price level 2 out of 4", "4-star"). Symbols in sentences read robotic and were flagged by readers.

OPENING HOURS: when facts.openingHours is present, it is the venue's REAL schedule from Google, and every time you recommend must fall inside it:
- NEVER suggest arriving, eating or visiting at an hour the place is shut. Check the day you are talking about: a shop open 4–10pm cannot be "a classic lunch stop", and "arrive right at opening" means the hour actually listed, not one you assume.
- NEVER state a closing day that disagrees with the list. If the list shows Monday hours, the place is not "closed Mondays", and if a day says Closed, say so.
- Shorter hours on one day are worth mentioning ("Mondays it closes at 2pm rather than 6:30").
- If facts.openingHours is absent, do not state hours at all; tell the reader to check before going.
- 17 published guides broke this rule and sent readers to locked doors, which is the single worst mistake this site can make.

CROWD DATA: use it whenever facts.crowdData is present (this is real measured foot-traffic; nobody else publishes it, so it is our most valuable, most quotable fact):
- State the quietest window in PLAIN language in the prose ("It's calmest between 9am and 11am on weekdays…"), fold it into the quickAnswer, and include one FAQ entry along the lines of "When is the quietest time to visit?" answered with the actual hours.
- When busiest hours are given, frame them as something to AVOID ("Try not to arrive after 1pm on weekends; that's when lines form"), not as a neutral statistic. Losses motivate more than gains; use only the exact hours provided.
- Use the given hours verbatim; never invent or round them into different times, and never claim crowd levels for a venue with no crowdData.

QUICK ANSWER: the first sentence must contain the searcher's words:
- Name the place or event EXACTLY as the title does in the very first sentence (never a paraphrase like "this harbour" or "the festival"), and name the specific thing a searcher types next to it. For a place: the neighbourhood or town it is in; for a festival or tour: "lineup"/"tickets" and the year; for a beach or park: "parking" or "best time". A quick answer that says "best time" but never "Valensole" cannot win the query "valensole lavender best time" (competitor audit 2026-08-23: our answer-first format was better than every winner's, and lost anyway where the key noun was missing).
- Keep it to 2-3 sentences that answer the question, not a teaser.

SUBSTANCE:
- Aim for 10+ discrete, concrete facts a reader can act on. Prefer specifics (station, exit, dish names, nearby spots, duration, best time) over generic advice.
- Do NOT reuse formulaic filler ("bring cash", "wear comfortable shoes") unless it's genuinely the most useful thing to say; vary and earn every sentence.

LIKE-A-LOCAL (this section is REQUIRED):
- Always include one H2 titled exactly "How to visit like a local". Fill it with BEHAVIOURAL, verifiable guidance from stable public knowledge: how people typically pay and tip (cash/card/mobile), whether to book or how the queue works, local etiquette, the local-language name or how to order, and the mistake tourists most often make here. Keep it concrete and specific to THIS place/dish/area, never generic. Never invent prices, hours, phone numbers, or quotes.
- Timing advice in this section follows the crowd rule, not a quota: with facts.crowdData, use its exact hours; without it, you may reason from PUBLIC STRUCTURE only (opening rush, lunch service, tour-bus schedules, prayer times) and it must READ as reasoning ("arriving right at opening usually beats the tour groups"), never as measurement. FORBIDDEN without crowdData: clock-hour crowd claims ("quietest between 12pm and 1pm") and any phrase implying data ("foot-traffic patterns", "visitor data", "our measurements", "statistics show") — the weekly audit flags these as invented-specifics, and 99 live posts had to be repaired for exactly this (2026-08-22). A section with no timing sentence at all is fine.

POPULARITY: you MUST obey facts.localSignals when it is present:
- localSignals.localSecretOk === true → you MAY frame the place as under-the-radar / a quieter find / not yet overrun.
- localSignals.localSecretOk === false, OR localSignals.popularity === "very-popular" → do NOT call it a "hidden gem", "secret", "undiscovered", or "off the beaten path". It's well-visited; make the like-a-local advice about beating the crowds.
- localSignals.localsFavorite === true → you MAY say locals genuinely favour it. If it is false or absent → do NOT claim "where locals go", "only locals know", or "no tourists".
- If facts.localSignals is ABSENT entirely → give general like-a-local behavioural advice and make NO claim about secrecy or local-vs-tourist status either way.

Submit via the submit_guide tool. Body = GitHub-flavored Markdown, 600-850 words, with 5-6 H2 (##) sections such as "Why go", "Getting there", "What to see / eat", "When to go", and ALWAYS one titled exactly "How to visit like a local". No H1 title, no frontmatter, no hero image, no FAQ inside the body (FAQ is a separate field).`;

const TOOL = {
  name: 'submit_guide',
  description: 'Submit the finished travel guide in structured form.',
  input_schema: {
    type: 'object',
    properties: {
      quickAnswer: {
        type: 'string',
        description: 'A 2-3 sentence answer-first summary a traveler can act on immediately. Its FIRST sentence names the place/event exactly as titled plus the key search noun (town/neighbourhood, "lineup"/"tickets" + year, "parking"/"best time").',
      },
      body: {
        type: 'string',
        description: 'The article body as GitHub-flavored Markdown (600-850 words, 5-6 H2 sections). Written in a vivid, immersive first-hand VISIT-REPORT voice (second-person, sensory, specific; never listicle/encyclopedia), always including a "How to visit like a local" H2. No faked personal trip or invented facts. No title, no FAQ.',
      },
      faq: {
        type: 'array',
        description: '4-5 concise, practical questions a visitor actually asks (getting there, cost, best time, how long, nearby), with specific answers.',
        items: {
          type: 'object',
          properties: { q: { type: 'string' }, a: { type: 'string' } },
          required: ['q', 'a'],
        },
      },
    },
    required: ['quickAnswer', 'body', 'faq'],
  },
};

// An event guide is written BEFORE the event and stays online after it. A
// sentence like "check the official site closer to the date" or "the lineup
// hasn't been confirmed" is true on publish day and a rotten instruction the
// morning after the event — which is exactly when the validator flags it and a
// repair pass has to spend a rewrite (sonu-nigam, lalala-fest, 2026-08-22).
// Born clean instead: the writer is told to phrase confirmations timelessly,
// and the output is checked against the same pattern the validator and the
// repair tool share. One retry naming the residue, then ship with a log line.
export const EVENT_TIMELESS_RULE = 'EVENT PAGES STAY ONLINE AFTER THE EVENT. Phrase every "confirm on the official source" instruction TIMELESSLY ("Confirm timing and tickets on the official site"), never relative to the date. Do NOT write: "closer to the date/event", "will be announced/confirmed/released", "has/have not been confirmed/announced yet", "tickets go on sale", "the lineup has yet to", "once released". State what is known; do not promise future updates.';

/**
 * The retry conversation, shaped the way the API demands: the assistant turn
 * ends in a tool_use, so the next user message MUST OPEN with a tool_result
 * for that exact id. The first version sent plain text instead and every
 * retry died with a 400 ("tool_use ids were found without tool_result") —
 * which killed the whole discover run on 2026-08-27, and would have killed a
 * publish run the same way the day a draft carried a residue. The path is
 * rare (the rule keeps most first drafts clean), which is why it sat armed
 * for five days.
 */
export function timelessRetryMessages(userPrompt, firstMsg, toolUseId, residue) {
  return [
    { role: 'user', content: userPrompt },
    { role: 'assistant', content: firstMsg.content },
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: toolUseId, content: 'Draft received. Revision requested below.' },
        { type: 'text', text: 'Your draft contains the phrase "' + residue + '", which becomes a stale instruction the day after the event. Resubmit the whole guide with every forward-looking promise removed or rephrased timelessly, changing nothing else. ' + EVENT_TIMELESS_RULE },
      ],
    },
  ];
}

/** First forward-looking phrase in a written guide's fields, or null when clean. */
export function eventFuturePromise(out) {
  const fields = [out?.quickAnswer, out?.body, ...(Array.isArray(out?.faq) ? out.faq.map((f) => f?.a) : [])];
  for (const t of fields) {
    const m = String(t || '').match(FUTURE_PROMISE);
    if (m) return m[0];
  }
  return null;
}

export async function writeArticle({ apiKey, title, region, country, category, facts }) {
  const client = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });

  const userPrompt = `Write a guide titled: "${title}"
Destination: ${region}${country ? `, ${country}` : ''}
Category: ${category}
${category === 'event' ? EVENT_TIMELESS_RULE + '\n' : ''}
VERIFIED FACTS (use only these for specifics):
${JSON.stringify(facts, null, 2)}`;

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 5000,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'submit_guide' },
    messages: [{ role: 'user', content: userPrompt }],
  });

  const toolUse = msg.content.find((b) => b.type === 'tool_use');
  if (!toolUse) throw new Error('model did not return a submit_guide tool call');

  let out = toolUse.input;
  // Born-clean gate for events (see EVENT_TIMELESS_RULE): one retry naming the
  // exact residue. Free when the first draft is clean, which the rule makes
  // the normal case; a second miss ships with a log line rather than a loop,
  // and the nightly validator will say so the day the event ends.
  const residue = category === 'event' ? eventFuturePromise(out) : null;
  if (residue) {
    console.log('  (event draft promises the future: "' + residue + '" - asking for a timeless rewrite)');
    const again = await client.messages.create({
      model: MODEL, max_tokens: 5000, system: SYSTEM, tools: [TOOL],
      tool_choice: { type: 'tool', name: 'submit_guide' },
      messages: timelessRetryMessages(userPrompt, msg, toolUse.id, residue),
    });
    const second = again.content.find((b) => b.type === 'tool_use');
    if (second) {
      out = second.input;
      const left = eventFuturePromise(out);
      if (left) console.log('  (event draft still says "' + left + '" after retry - shipping; the validator flags it when the event ends)');
    }
  }
  // The prompt asks for paragraphs under 70 words. Across 792 published guides
  // it was ignored 88% of the time — an instruction about shape is the first
  // thing a model drops when it is also juggling facts, hours and honesty
  // rules. So enforce it mechanically instead of asking twice: split at
  // sentence boundaries, changing not one word. Belt and braces, and the braces
  // are the ones that actually hold.
  const { body } = reflow(out.body ?? '');
  return {
    quickAnswer: out.quickAnswer ?? '',
    body,
    faq: Array.isArray(out.faq) ? out.faq.slice(0, 6) : [],
  };
}
