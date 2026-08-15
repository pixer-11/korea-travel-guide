// ONE judge for translation naturalness — shared by the full-corpus audit
// (audit-translation-quality.mjs) and the daily publish gate
// (translation-quality-gate.mjs). The visual audit taught us what happens
// when two callers carry two copies of one judgment prompt: they drift, and
// the same text passes one and fails the other nightly (2026-08-05).
//
// The judge reads TARGET LANGUAGE ONLY — no source comparison — because
// that is exactly what the reader does. Scores: 0 native · 1 minor
// awkwardness · 2 clearly translation-flavored · 3 severe.
import Anthropic from '@anthropic-ai/sdk';

export const LANGS = { ko: '한국어', ja: '日本語', es: 'español', zh: '中文' };
const client = new Anthropic();

/**
 * Judge one translated body. Returns {score, registerBreak, worst} or null
 * after exhausted retries. `body` should be the markdown content (frontmatter
 * stripped); it is clipped to 4000 chars — enough to smell translationese,
 * cheap enough to run on every translation every day.
 */
export async function judgeTranslation(lang, body) {
  const name = LANGS[lang] ?? lang;
  const prompt = `You are a native ${name} copy editor. Read this travel-guide text (${name}).
Judge ONLY how natural it reads to a native reader — would they suspect it was translated from English?

Score:
- translationese: 0 = reads like a native wrote it; 1 = minor awkwardness; 2 = clearly translation-flavored (English word order, dangling modifiers, unnatural collocations); 3 = severe, hard to read.
- registerBreak: true if the politeness register shifts inconsistently (Korean: 합니다체 vs 한다체; Japanese: です・ます vs plain).
- worst: the single worst sentence, truncated to 90 characters (empty string if score 0).

Reply ONLY compact JSON: {"translationese":N,"registerBreak":bool,"worst":"..."}

TEXT:
${String(body).slice(0, 4000)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const msg = await client.messages.create({
        model: 'claude-sonnet-5', max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      const j = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? 'null');
      if (!j || j.translationese == null) throw new Error('no JSON in reply');
      return {
        score: Number(j.translationese),
        registerBreak: !!j.registerBreak,
        worst: String(j.worst || '').slice(0, 120),
      };
    } catch (e) {
      const backoff = /429|overloaded|rate/i.test(String(e.message)) ? 15000 * (attempt + 1) : 3000;
      if (attempt < 2) { await new Promise((r) => setTimeout(r, backoff)); continue; }
      return null;
    }
  }
  return null;
}
