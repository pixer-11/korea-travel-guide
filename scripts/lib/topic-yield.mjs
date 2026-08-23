// ─────────────────────────────────────────────────────────────
//  TOPIC YIELD — which kinds of search actually turn into posts
//
//  Every target costs one Places Text Search (~100/day, see places-budget.mjs)
//  whether or not a post comes out of it. A week of logs (2026-08-17..23, 694
//  searches) showed the outcome depends almost entirely on the TOPIC:
//
//    museum / historic site / park       54–58 %   (Wikimedia has the photo)
//    hidden gem                          47 %
//    viewpoint / art gallery / night view 13–17 %
//    local restaurant / trendy cafe       4 %      (only Foursquare has photos,
//    noodles / bakery / bar / bookshop …  0 %       and they rarely pass the
//                                                   "is this THAT venue" gate)
//
//  The queue builder deliberately starts each region with the category it has
//  fewest of — usually restaurant/cafe — so a run spent its first ten searches
//  on the 4 % topics and reached the 55 % ones only after the budget was gone
//  (2026-08-23: 111 searches, 14 posts, bulk run refused on its first query).
//  Per search, a landmark post brings ~9× the GSC clicks of a restaurant post
//  (restaurant posts earn 1.3× per post, but cost 25 searches each).
//
//  So the queue gets one more stable partition, by measured yield:
//
//    high   ≥ HIGH_YIELD                       first
//    mid    everything else, incl. unmeasured  next
//    low    < LOW_YIELD after ≥ MIN_ATTEMPTS   last — except PROBES_PER_RUN of
//                                              them kept early, so a topic whose
//                                              photo supply improves can climb
//                                              back out on its own numbers.
//
//  Nothing is hard-coded per topic: the ledger is written by the publish run
//  from what actually happened, and seeded once from the week above.
// ─────────────────────────────────────────────────────────────
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const LEDGER = fileURLToPath(new URL('../../data/topic-yield.json', import.meta.url));

export const MIN_ATTEMPTS = 10;   // below this a topic is "unmeasured" → mid tier
export const LOW_YIELD = 0.10;    // < 10 % after MIN_ATTEMPTS → low tier
export const HIGH_YIELD = 0.30;   // ≥ 30 % → high tier
export const PROBES_PER_RUN = 2;  // low-tier targets still tried early each run
export const PROBE_SLOTS = [5, 10]; // queue positions the probes are inserted at
const HALVE_AT = 200;             // keep the ledger recent: halve counts past this

export function emptyLedger() { return { topics: {}, updated: null }; }

export async function loadYield(path = LEDGER) {
  try {
    const j = JSON.parse(await readFile(path, 'utf8'));
    if (j && typeof j === 'object' && j.topics && typeof j.topics === 'object') return j;
  } catch { /* first run */ }
  return emptyLedger();
}

export async function saveYield(ledger, path = LEDGER) {
  ledger.updated = new Date().toISOString();
  await writeFile(path, JSON.stringify(ledger, null, 1) + '\n', 'utf8');
}

/** Yield of one topic: { attempts, hits, rate } — rate is null when unmeasured. */
export function yieldOf(ledger, topic) {
  const t = ledger.topics[topic];
  if (!t || !t.attempts) return { attempts: 0, hits: 0, rate: null };
  return { attempts: t.attempts, hits: t.hits, rate: t.hits / t.attempts };
}

export function tierOf(ledger, topic) {
  if (!topic) return 'mid';
  const { attempts, rate } = yieldOf(ledger, topic);
  if (attempts < MIN_ATTEMPTS || rate === null) return 'mid';
  if (rate < LOW_YIELD) return 'low';
  if (rate >= HIGH_YIELD) return 'high';
  return 'mid';
}

/**
 * Record one outcome. `hit` = a post was written from this search; a miss is
 * a search whose candidates all lacked a verifiable photo. Searches that ended
 * in "already exists" / "topic twin" / transient vision outage are NOT
 * outcomes of the topic and must not be recorded.
 */
export function recordOutcome(ledger, topic, hit) {
  if (!topic) return ledger;
  const t = (ledger.topics[topic] ||= { attempts: 0, hits: 0 });
  t.attempts += 1;
  if (hit) t.hits += 1;
  if (t.attempts > HALVE_AT) {
    t.attempts = Math.round(t.attempts / 2);
    t.hits = Math.round(t.hits / 2);
  }
  return ledger;
}

/**
 * Stable partition of a queue by tier: high, then mid, then low — with up to
 * PROBES_PER_RUN low-tier targets re-inserted at PROBE_SLOTS so the low tier
 * keeps being measured. Relative order inside each tier is untouched, so the
 * country/region fairness decided upstream survives.
 */
export function orderByYield(queue, ledger, { probes = PROBES_PER_RUN, slots = PROBE_SLOTS } = {}) {
  const high = [], mid = [], low = [];
  for (const t of queue) {
    const tier = tierOf(ledger, t.topic);
    (tier === 'high' ? high : tier === 'low' ? low : mid).push(t);
  }
  const probeList = low.slice(0, probes);
  const rest = low.slice(probes);
  const out = [...high, ...mid];
  // Insert probes at fixed positions (never past the end of what is there).
  probeList.forEach((p, i) => {
    const at = Math.min(slots[i] ?? slots[slots.length - 1] ?? 0, out.length);
    out.splice(at, 0, p);
  });
  return [...out, ...rest];
}

/** One-line summary for the run log: "high 9 · mid 11 · low 4 (noodles 0/14 …)". */
export function describeYield(ledger) {
  const rows = Object.entries(ledger.topics)
    .map(([topic, t]) => ({ topic, ...t, tier: tierOf(ledger, topic) }));
  const n = (tier) => rows.filter((r) => r.tier === tier).length;
  const lows = rows.filter((r) => r.tier === 'low')
    .sort((a, b) => a.hits / a.attempts - b.hits / b.attempts)
    .slice(0, 6)
    .map((r) => `${r.topic} ${r.hits}/${r.attempts}`)
    .join(', ');
  return `yield tiers: high ${n('high')} · mid ${n('mid')} · low ${n('low')}${lows ? ` (${lows})` : ''}`;
}
