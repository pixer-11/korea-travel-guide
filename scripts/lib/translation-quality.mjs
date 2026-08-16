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

// The model thinks before it answers, and thinking tokens are drawn from the
// SAME max_tokens budget as the reply. Born with 600, this judge spent the
// whole budget on a thinking block and returned content: [{type:'thinking'}]
// with no text at all — stop_reason 'max_tokens', zero output to parse. The
// catch below then read that as a transient error and retried the identical
// call twice more, so a text that needed a long think failed three times and
// was recorded as "judge unavailable" (2026-08-16: 93 of 4,336 translations
// were never judged at all, 52 of them zh — the hardest texts fail first, so
// the silence was biased exactly toward the pages worth catching).
//
// Budgets escalate rather than repeat: a truncated reply is not transient and
// retrying the same cap only buys the same wall. Raising the cap costs nothing
// on a successful call — billing is per token produced, not per token allowed —
// and it REMOVES the three wasted 600-token calls every hard text used to burn.
const BUDGETS = [2000, 4000, 4000];

/** Counters for the callers' summary lines. A judge that silently answers
 *  "unavailable" for a quarter of the corpus must not be able to hide again. */
export const judgeStats = { calls: 0, failed: 0, truncated: 0, lastError: '' };

/**
 * Pull the verdict out of one API message. Pure and exported so the failure
 * modes below are testable without spending a call. Throws with a reason that
 * says whether retrying bigger could help.
 */
export function parseJudgeReply(msg) {
  const text = (msg?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (!text.trim()) {
    // No text block at all. If the stop reason is max_tokens the budget was
    // eaten (by thinking, or by a runaway reply) — the caller should go bigger.
    const err = new Error(msg?.stop_reason === 'max_tokens' ? 'reply truncated before any text' : 'empty reply');
    err.truncated = msg?.stop_reason === 'max_tokens';
    throw err;
  }
  const j = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? 'null');
  if (!j || j.translationese == null) {
    // JSON that stopped mid-object is truncation too, not a malformed model.
    const err = new Error('no JSON in reply');
    err.truncated = msg?.stop_reason === 'max_tokens';
    throw err;
  }
  return {
    score: Number(j.translationese),
    registerBreak: !!j.registerBreak,
    worst: String(j.worst || '').slice(0, 120),
  };
}

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
  judgeStats.calls++;
  for (let attempt = 0; attempt < BUDGETS.length; attempt++) {
    try {
      const msg = await client.messages.create({
        model: 'claude-sonnet-5', max_tokens: BUDGETS[attempt],
        messages: [{ role: 'user', content: prompt }],
      });
      return parseJudgeReply(msg);
    } catch (e) {
      judgeStats.lastError = String(e.message).slice(0, 200);
      if (attempt === BUDGETS.length - 1) {
        judgeStats.failed++;
        if (e.truncated) judgeStats.truncated++;
        console.warn(`    judge failed after ${BUDGETS.length} attempts: ${judgeStats.lastError}`);
        return null;
      }
      // A truncated reply is answered by the next (larger) budget, immediately.
      // Anything else is transient — back off, hard on a rate limit.
      if (e.truncated) { judgeStats.truncated++; continue; }
      await new Promise((r) => setTimeout(r, /429|overloaded|rate/i.test(String(e.message)) ? 15000 * (attempt + 1) : 3000));
    }
  }
  return null;
}
