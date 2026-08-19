// ─────────────────────────────────────────────────────────────
//  POLITE FETCH — one retry policy for the hosts that throttle us.
//
//  Wikimedia (commons API + upload.wikimedia.org) answers 429 in bursts when a
//  publish run pulls dozens of photos in a few minutes from a shared GitHub
//  runner IP. Every caller used to treat that as "no photo" — `if (!res.ok)
//  return null` — so a two-second throttle window silently turned into a
//  one-photo page forever (in-body photo is attempted once, at publish). The
//  same photo cleared the same gate minutes later from another machine.
//
//  This retries ONLY the transient statuses (429, 502, 503, 504) and network
//  errors, honouring Retry-After when given, with a short backoff. Anything
//  else (404, 403, 200) returns immediately — the caller still decides.
// ─────────────────────────────────────────────────────────────
const TRANSIENT = new Set([429, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch() with a small, bounded retry on throttling.
 * @param {string} url
 * @param {RequestInit & { tries?: number, baseMs?: number, onRetry?: (info: {attempt:number, status?:number, waitMs:number}) => void }} [opts]
 */
export async function politeFetch(url, opts = {}) {
  const { tries = 3, baseMs = 2500, onRetry, ...init } = opts;
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    let res;
    try {
      res = await fetch(url, init);
    } catch (e) {
      lastErr = e;
      if (attempt === tries) throw e;
      const waitMs = baseMs * attempt;
      onRetry?.({ attempt, waitMs });
      await sleep(waitMs);
      continue;
    }
    if (!TRANSIENT.has(res.status) || attempt === tries) return res;
    const ra = Number(res.headers.get('retry-after'));
    const waitMs = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 20_000) : baseMs * attempt;
    onRetry?.({ attempt, status: res.status, waitMs });
    // Drain so the socket can be reused, then wait.
    try { await res.arrayBuffer(); } catch {}
    await sleep(waitMs);
  }
  throw lastErr ?? new Error('politeFetch: exhausted');
}
