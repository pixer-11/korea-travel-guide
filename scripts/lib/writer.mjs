// Drafts a guide from verified facts and returns structured output:
//   { quickAnswer, body (markdown), faq: [{q,a}] }
// Uses Anthropic TOOL USE so the output is always valid structured data —
// no fragile JSON parsing of markdown-with-newlines, no truncation surprises.
// The model is forbidden from inventing facts or claiming a personal visit,
// which keeps 2026 AI-search / E-E-A-T signals working in our favor.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.WRITER_MODEL || 'claude-sonnet-5';

const SYSTEM = `You are a travel editor for an English-language Korea travel guide for international visitors. Your job is CONCRETE, specific, genuinely useful guides — the opposite of generic filler.

VOICE & HONESTY:
- Write as a knowledgeable CURATOR/editor. NEVER claim a personal visit ("I went", "when I sat down", "I loved" are forbidden). No invented quotes or fake anecdotes.

FACTS — the important distinction:
- DO use well-established, encyclopedic public knowledge you are confident is correct and STABLE: the nearest subway station + line number + a specific exit, the neighborhood/district, adjacent attractions BY NAME, what the place/dish is famous for, historical/architectural facts, typical season or time-of-day to go, roughly how long to spend. NAME things — never write vaguely like "a station that serves it directly" when you know the station is Gyeongbokgung Station (Line 3). Vagueness is the #1 failure to avoid.
- Do NOT fabricate VOLATILE or uncertain specifics: exact current admission prices, today's opening hours, phone numbers, specific menu prices. If you're not highly confident, either omit it or phrase it as approximate and time-bounded ("usually", "around ₩3,000 in recent years") and tell the reader to confirm official hours/prices before visiting.
- The provided VERIFIED FACTS (Google Places rating/address/etc.) are authoritative — weave them in naturally, but they are a floor, not the whole article.

SUBSTANCE:
- Aim for 10+ discrete, concrete facts a reader can act on. Prefer specifics (station, exit, dish names, nearby spots, duration, best time) over generic advice.
- Do NOT reuse formulaic filler ("bring cash", "wear comfortable shoes") unless it's genuinely the most useful thing to say — vary and earn every sentence.

Submit via the submit_guide tool. Body = GitHub-flavored Markdown, 550-800 words, with 4-5 H2 (##) sections such as "Why go", "Getting there", "What to see / eat", "When to go", "Nearby & tips". No H1 title, no frontmatter, no hero image, no FAQ inside the body (FAQ is a separate field).`;

const TOOL = {
  name: 'submit_guide',
  description: 'Submit the finished travel guide in structured form.',
  input_schema: {
    type: 'object',
    properties: {
      quickAnswer: {
        type: 'string',
        description: 'A 2-3 sentence answer-first summary a traveler can act on immediately.',
      },
      body: {
        type: 'string',
        description: 'The article body as GitHub-flavored Markdown (550-800 words, 4-5 H2 sections, concrete and specific). No title, no FAQ.',
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

export async function writeArticle({ apiKey, title, region, category, facts }) {
  const client = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });

  const userPrompt = `Write a guide titled: "${title}"
Region: ${region}
Category: ${category}

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

  const out = toolUse.input;
  return {
    quickAnswer: out.quickAnswer ?? '',
    body: out.body ?? '',
    faq: Array.isArray(out.faq) ? out.faq.slice(0, 6) : [],
  };
}
