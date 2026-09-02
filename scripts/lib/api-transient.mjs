// Is this API failure the kind that a second try can fix? Rate limits,
// overload, 5xx and dropped connections are; a 400 (bad request, or the
// account's usage limit — see memory: anthropic-api-usage-limit) and a 401 are
// not, and retrying those only burns the wait. Shared by translate-topics and
// translate-static so the two decide the same way.
export function isTransientApiError(e) {
  const status = Number(e?.status ?? e?.statusCode ?? 0);
  if (status === 408 || status === 409 || status === 429 || status >= 500) return true;
  if (status >= 400) return false;
  const msg = `${e?.name || ''} ${e?.message || ''}`;
  return /overloaded|rate.?limit|connection error|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|APIConnection|timed? ?out/i.test(msg);
}

// How long to wait before that second try: hard on a rate limit or overload
// (the same 15 s × attempt translation-quality.mjs uses), short otherwise.
export function transientBackoffMs(e, attempt) {
  const status = Number(e?.status ?? e?.statusCode ?? 0);
  const hard = status === 429 || status === 529 || /overloaded|rate.?limit/i.test(String(e?.message || ''));
  return hard ? 15000 * attempt : 3000 * attempt;
}
