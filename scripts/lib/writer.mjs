// Drafts a guide from verified facts and returns structured output:
//   { quickAnswer, body (markdown), faq: [{q,a}] }
// Uses Anthropic TOOL USE so the output is always valid structured data —
// no fragile JSON parsing of markdown-with-newlines, no truncation surprises.
// The model is forbidden from inventing facts or claiming a personal visit,
// which keeps 2026 AI-search / E-E-A-T signals working in our favor.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.WRITER_MODEL || 'claude-sonnet-5';

const SYSTEM = `You are a travel editor for an English-language Korea travel guide for international visitors.

STRICT RULES:
- Write as a knowledgeable CURATOR. NEVER claim you personally visited ("I went", "when I sat down" are forbidden). Informative editorial voice.
- Use ONLY the facts provided. Do NOT invent hours, prices, phone numbers, menu items, or history you weren't given. General, widely-true travel context (how the subway works, bring cash) is fine; venue-specific specifics must come from the facts.
- Be genuinely USEFUL and specific — the reader should be able to act on it.
- Submit your work by calling the submit_guide tool. The body must be GitHub-flavored Markdown, 350-550 words, using H2 (##) sections like "What to know", "How to get there", "Tips". No H1 title, no frontmatter, no hero image, no FAQ section inside the body (the FAQ is a separate field).`;

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
        description: 'The article body as GitHub-flavored Markdown (350-550 words, H2 sections). No title, no FAQ.',
      },
      faq: {
        type: 'array',
        description: '4 concise, practical questions a visitor would ask, with answers.',
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
    max_tokens: 4000,
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
