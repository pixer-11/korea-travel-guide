// ─────────────────────────────────────────────────────────────
//  SOCIAL INSIGHTS — what the daily Threads/Instagram post actually did.
//
//  Since 2026-08-27 a carousel has gone out every morning and nothing has
//  ever measured it (full review, 2026-10-09): the keep-or-kill question for
//  the channel had no number to answer with. This reads each post's lifetime
//  metrics ONCE, seven days after it went out, and stores them beside the
//  post in the same state file the workflow already commits.
//
//  Rules:
//  · Never throws, never fails the job. A measurement that cannot be taken is
//    recorded as an error string on the post and retried the next morning.
//  · One GET per channel per post, at most MAX_PER_RUN posts per run, so a
//    backlog (a week of outages) drains over a few mornings without a burst.
//  · Metric lists are tried from richest to plainest: Meta rejects the WHOLE
//    call when one metric is unknown for that media type, and the supported
//    set differs between a single image and a carousel and shifts between
//    API versions. The fallback keeps the number that matters (views/reach)
//    even when a richer one is refused.
// ─────────────────────────────────────────────────────────────

const IG_GRAPH = 'https://graph.instagram.com/v23.0';
const TH_GRAPH = 'https://graph.threads.net/v1.0';

export const MEASURE_AFTER_DAYS = 7;
export const MAX_PER_RUN = 6;
export const HISTORY_CAP = 90;

const TH_METRICS = [['views', 'likes', 'replies', 'reposts', 'quotes'], ['views', 'likes'], ['views']];
const IG_METRICS = [['reach', 'saved', 'likes', 'comments', 'shares', 'views'], ['reach', 'saved', 'likes', 'comments'], ['reach', 'saved'], ['reach']];

/** Append today's successful publish to the history that insights read later. */
export function recordPublished(social, { day, slug, thId, igId }) {
  social.history ||= [];
  const existing = social.history.find((h) => h.day === day && h.slug === slug);
  if (existing) {
    if (thId) existing.thId = thId;
    if (igId) existing.igId = igId;
  } else {
    const h = { day, slug };
    if (thId) h.thId = thId;
    if (igId) h.igId = igId;
    social.history.push(h);
  }
  if (social.history.length > HISTORY_CAP) social.history = social.history.slice(-HISTORY_CAP);
  return social.history;
}

/**
 * Meta's insights answer, flattened to { metric: number }. Lifetime metrics
 * arrive as `values: [{ value }]`; some arrive as `total_value: { value }`.
 * Anything else is ignored rather than guessed.
 */
export function parseInsights(body) {
  const out = {};
  for (const m of body?.data ?? []) {
    if (!m?.name) continue;
    let v;
    if (Array.isArray(m.values) && m.values.length) v = m.values[m.values.length - 1]?.value;
    else if (m.total_value && typeof m.total_value.value !== 'undefined') v = m.total_value.value;
    if (typeof v === 'number' && Number.isFinite(v)) out[m.name] = v;
  }
  return out;
}

/** Posts old enough to measure and not yet measured, oldest first, capped. */
export function dueForMeasurement(history = [], today, { after = MEASURE_AFTER_DAYS, max = MAX_PER_RUN } = {}) {
  const cutoff = new Date(`${today}T00:00:00Z`).getTime() - after * 86400e3;
  return history
    .filter((h) => (h.thId || h.igId) && !h.insights && new Date(`${h.day}T00:00:00Z`).getTime() <= cutoff)
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(0, max);
}

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`${res.status}: ${JSON.stringify(body.error || body).slice(0, 200)}`);
    err.code = body?.error?.code;
    throw err;
  }
  return body;
}

async function readMetrics(base, id, token, lists, fetchImpl) {
  let lastErr = null;
  for (const metrics of lists) {
    const qs = new URLSearchParams({ metric: metrics.join(','), access_token: token }).toString();
    try {
      const parsed = parseInsights(await getJson(`${base}/${id}/insights?${qs}`, fetchImpl));
      if (Object.keys(parsed).length) return parsed;
      lastErr = new Error('empty insights');
    } catch (e) {
      lastErr = e;
      // A dead token is not a metric problem: stop asking.
      if (e.code === 190) break;
    }
  }
  return { error: String(lastErr?.message ?? 'no data').slice(0, 160) };
}

/**
 * Measure every due post. Mutates `social.history[i].insights` and returns the
 * entries measured this run (for the Telegram line). Never throws.
 */
export async function collectSocialInsights(social, tokens, { today, fetchImpl = fetch, log = console.log } = {}) {
  const measured = [];
  try {
    const due = dueForMeasurement(social?.history, today);
    for (const h of due) {
      const ins = { at: today };
      if (h.thId && tokens?.th?.token) ins.th = await readMetrics(TH_GRAPH, h.thId, tokens.th.token, TH_METRICS, fetchImpl);
      if (h.igId && tokens?.ig?.token) ins.ig = await readMetrics(IG_GRAPH, h.igId, tokens.ig.token, IG_METRICS, fetchImpl);
      // Both channels unreadable: leave it unmeasured so tomorrow retries,
      // but keep the error text where a person can see it.
      const anyNumber = ['th', 'ig'].some((k) => ins[k] && !ins[k].error);
      if (anyNumber) { h.insights = ins; measured.push(h); }
      else { h.lastInsightsError = [ins.th?.error, ins.ig?.error].filter(Boolean).join(' / ').slice(0, 200); }
      log(`social insights ${h.day} ${h.slug}: ${JSON.stringify(ins).slice(0, 200)}`);
    }
  } catch (e) {
    log(`social insights: skipped (${String(e.message).slice(0, 120)})`);
  }
  return measured;
}

/** One Korean line per measured post for the morning Telegram summary. */
export function insightsLines(measured) {
  return measured.map((h) => {
    const th = h.insights?.th, ig = h.insights?.ig;
    const parts = [];
    if (th && !th.error) parts.push(`스레드 조회 ${th.views ?? '?'} · 좋아요 ${th.likes ?? '?'}` + (th.replies != null ? ` · 답글 ${th.replies}` : ''));
    if (ig && !ig.error) parts.push(`인스타 도달 ${ig.reach ?? '?'} · 저장 ${ig.saved ?? '?'}` + (ig.likes != null ? ` · 좋아요 ${ig.likes}` : ''));
    return `📊 ${h.day} ${h.slug} 7일 성과 — ${parts.join(' / ') || '측정 불가'}`;
  });
}

/** Totals over every measured post, for a weekly glance. */
export function summarizeInsights(history = []) {
  const s = { posts: 0, thViews: 0, thLikes: 0, igReach: 0, igSaved: 0 };
  for (const h of history) {
    if (!h.insights) continue;
    s.posts++;
    s.thViews += h.insights.th?.views ?? 0;
    s.thLikes += h.insights.th?.likes ?? 0;
    s.igReach += h.insights.ig?.reach ?? 0;
    s.igSaved += h.insights.ig?.saved ?? 0;
  }
  return s;
}
