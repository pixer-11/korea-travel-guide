// Claude prices and the arithmetic of the cost ledger (data/claude-cost.jsonl).
// One table for the repo: the meter, the report and anything else that prices a
// call reads it from here.
//
// Why a ledger at all: on 2026-09-24 the writer moved to claude-opus-5-5 and the
// honest answer to "how much more does that cost?" was "nobody can say until the
// bill arrives". Two rounds of measurement had to reverse-engineer it. Now every
// call leaves a line.
//
// Prices: official table, checked 2026-09-25
// (https://platform.claude.com/docs/en/about-claude/pricing). Longer prefixes
// first, so claude-opus-5-5 is never priced as claude-opus-5. A model missing
// from the table is recorded with its tokens and usd null - never a guessed price.

export const CLAUDE_PRICES = [
  // [model prefix, input $/MTok, output $/MTok, cache-read multiplier]
  ['claude-opus-5-5', 4, 20, 0.05],
  ['claude-opus-5', 5, 25, 0.1],
  ['claude-sonnet-5', 2, 10, 0.1],
  ['claude-sonnet-4-6', 3, 15, 0.1],
  ['claude-haiku-4-5', 1, 5, 0.1],
];

// Web search is billed per search on top of tokens: $10 per 1,000 (same page).
// discover-events and six other scripts use it, so tokens alone undercount them.
export const WEB_SEARCH_USD = 0.01;

/** Dollars for one response's usage, or null when the model is not in the table. */
export function claudeUsd(model, usage = {}) {
  const row = CLAUDE_PRICES.find(([prefix]) => String(model || '').startsWith(prefix));
  if (!row) return null;
  const [, pin, pout, cacheRead] = row;
  const u = usage || {};
  return ((u.input_tokens || 0) * pin
    + (u.cache_creation_input_tokens || 0) * pin * 1.25
    + (u.cache_read_input_tokens || 0) * pin * cacheRead
    + (u.output_tokens || 0) * pout) / 1e6
    + (u.server_tool_use?.web_search_requests || 0) * WEB_SEARCH_USD;
}

/** The KST calendar day of a moment - the day the owner means by "today". */
export function kstDay(date = new Date()) {
  return new Date(date.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
}

/** Sum ledger rows: calls, usd (priced calls only), unpriced count, per-model split. */
export function sumRows(rows) {
  const out = { calls: 0, usd: 0, unpriced: 0, models: {} };
  for (const r of rows) {
    for (const [model, m] of Object.entries(r.models || {})) {
      out.calls += m.calls || 0;
      out.unpriced += m.unpriced || 0;
      out.usd += m.usd || 0;
      const t = (out.models[model] ||= { calls: 0, usd: 0 });
      t.calls += m.calls || 0;
      t.usd += m.usd || 0;
    }
  }
  return out;
}

/** One Telegram line, or '' when there were no calls. */
export function costLine(sum, head) {
  if (!sum.calls) return '';
  const models = Object.entries(sum.models)
    .sort((a, b) => b[1].usd - a[1].usd)
    .map(([k, v]) => `${k} ${v.calls}회`)
    .join(', ');
  const tail = sum.unpriced ? ` (⚠️ 가격 모름 ${sum.unpriced}회 제외)` : '';
  return `${head} $${sum.usd.toFixed(2)} · ${sum.calls}회 · ${models}${tail}`;
}
