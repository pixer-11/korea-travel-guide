// Run many independent Claude requests through the Message Batches API — the
// same requests, the same model, billed at half price — and hand back whatever
// came back. The caller keeps its own direct path for everything this does not
// return, so a slow or failed batch can only cost the old price, never a page.
//
// Why (2026-09-27): translation is ~70% of the automation's Claude bill, and
// none of it has a person waiting on it. The publish run already takes 40+
// minutes; batches usually finish well inside an hour, but "usually" is the
// point — the wait is capped, and past the cap the batch is cancelled and the
// caller translates the rest directly, exactly as before this file existed.
//
// Rules:
//  - It never throws. Any failure returns an empty Map and the caller goes direct.
//  - It returns only `succeeded` results. errored / canceled / expired requests
//    are simply absent, and the caller retries those directly.
//  - Every returned message is booked into the cost ledger at batch price.
//  - It prints one Korean-free status line per stage; workflows copy stdout into
//    logs, not into Telegram.
import { meterRecord } from './claude-meter.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

import { REPLACEMENT_CHAR } from './replacement-char.mjs';
export { REPLACEMENT_CHAR };

// The batch results file, decoded as ONE piece of text.
//
// The SDK's own iterator (client.beta.messages.batches.results, @anthropic-ai/sdk
// 0.30.1) decodes every network chunk on its own with Buffer.toString() —
// internal/decoders/line.js decodeText — so a Hangul, kana, hanzi or accented
// letter whose bytes straddle a chunk boundary comes out as U+FFFD. From the
// first batch run (2026-09-27) to 10-05 that wrote 775 broken lines into 523
// translations, about 100 files a day, and they shipped: 「嘉義旧監��」 in a
// Japanese <title>, 「돌��오나요?」 in a Korean FAQ and its JSON-LD. Reading the
// whole body with res.text() decodes it once, so no letter can be cut.
// A client without a key (the unit tests' fake) still uses the SDK iterator;
// runBatch drops any message that carries U+FFFD either way.
async function* batchResults(client, batch) {
  if (batch.results_url && client.apiKey) {
    const res = await fetch(batch.results_url, {
      headers: {
        'x-api-key': client.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'message-batches-2024-09-24',
      },
    });
    if (!res.ok) throw new Error(`batch results ${res.status}`);
    for (const line of (await res.text()).split('\n')) {
      if (line.trim()) yield JSON.parse(line);
    }
    return;
  }
  yield* await client.beta.messages.batches.results(batch.id);
}

// How long a cancelled batch gets to finish what it already started. Workflows
// that budget their time (discover-events.yml) reserve exactly this much.
export const CANCEL_WAIT_MIN = 30;

/**
 * Minutes a caller may wait on a batch: its own cap, but never so long that a
 * batch cancelled at the end (CANCEL_WAIT_MIN) plus `reserveMin` of direct work
 * and the steps after it would outrun the GitHub job — 360 min from JOB_T0
 * (epoch seconds, set by publish.yml and discover-events.yml). 0 = skip the
 * batch and go direct. No JOB_T0 (a local run) = the cap.
 * Every batching caller added on 2026-10-10 shares this, so a writer or intro
 * batch late in a job cannot push the content commit past the runner's limit
 * (Codex review: two 20-minute intro batches after a slow translation step).
 */
export function batchWaitMin(capMin, { reserveMin = 70, now = Date.now(), env = process.env } = {}) {
  if (!env.JOB_T0) return capMin;
  const left = 360 - (now / 1000 - Number(env.JOB_T0)) / 60 - CANCEL_WAIT_MIN - reserveMin;
  const w = Math.min(capMin, Math.floor(left));
  return w >= 5 ? w : 0;
}

/**
 * @param {any} client  an Anthropic SDK client
 * @param {Array<{ id: string, params: object }>} items  id must be unique
 * @param {{ waitMin?: number, cancelWaitMin?: number, pollSec?: number, log?: (s: string) => void }} [opts]
 * @returns {Promise<Map<string, object>>} id -> Claude message, for succeeded requests only
 */
export async function runBatch(client, items, opts = {}) {
  const got = new Map();
  const log = opts.log || ((s) => console.log(s));
  const waitMs = (opts.waitMin ?? 90) * 60e3;
  const pollMs = (opts.pollSec ?? 30) * 1e3;
  if (!items.length) return got;
  // custom_id is limited to [A-Za-z0-9_-]{1,64}; slugs can be longer, so the
  // batch sees positions and the caller keeps its own ids.
  const byCid = new Map(items.map((it, i) => [`r${i}`, it.id]));
  let batch;
  try {
    batch = await client.beta.messages.batches.create({
      requests: items.map((it, i) => ({ custom_id: `r${i}`, params: it.params })),
    });
    log(`batch ${batch.id}: ${items.length} request(s) submitted — waiting up to ${Math.round(waitMs / 60e3)} min`);
    const t0 = Date.now();
    while (batch.processing_status !== 'ended' && Date.now() - t0 < waitMs) {
      await sleep(pollMs);
      batch = await client.beta.messages.batches.retrieve(batch.id);
    }
    if (batch.processing_status !== 'ended') {
      log(`batch ${batch.id}: not finished after ${Math.round(waitMs / 60e3)} min — cancelling, the rest goes direct`);
      await client.beta.messages.batches.cancel(batch.id);
      // What already succeeded is still billed, so collect it rather than
      // paying for it twice. Cancelling is NOT quick: requests already being
      // processed finish first. On 2026-10-01 a 216-request event batch was
      // cancelled at 120 min, this wait was 5 min, it gave up without a word
      // and all 216 went direct at full price (~$19) on top of whatever the
      // cancelled batch had already billed.
      const cancelWaitMs = (opts.cancelWaitMin ?? CANCEL_WAIT_MIN) * 60e3;
      const t1 = Date.now();
      while (batch.processing_status !== 'ended' && Date.now() - t1 < cancelWaitMs) {
        await sleep(Math.min(pollMs, 15e3));
        batch = await client.beta.messages.batches.retrieve(batch.id);
      }
      if (batch.processing_status !== 'ended') {
        log(`batch ${batch.id}: still ${batch.processing_status} ${Math.round(cancelWaitMs / 60e3)} min after cancel — giving up; its succeeded requests are billed but unused (${JSON.stringify(batch.request_counts)})`);
        return got;
      }
    }
    let garbled = 0;
    for await (const r of batchResults(client, batch)) {
      if (r?.result?.type !== 'succeeded') continue;
      const id = byCid.get(r.custom_id);
      const msg = r.result.message;
      if (!id || !msg) continue;
      meterRecord(msg, new Date(), 0.5);
      // Paid for, but not used: a reply with a broken letter goes direct like
      // any request the batch did not return.
      if (JSON.stringify(msg.content).includes(REPLACEMENT_CHAR)) { garbled++; continue; }
      got.set(id, msg);
    }
    log(`batch ${batch.id}: ${got.size}/${items.length} succeeded (${JSON.stringify(batch.request_counts)})${garbled ? ` — ${garbled} dropped for a broken letter (U+FFFD), going direct` : ''}`);
  } catch (e) {
    log(`batch failed (${String(e?.message || e).slice(0, 160)}) — ${got.size} usable, the rest goes direct`);
    // The caller is about to pay for all of it directly; a batch left running
    // would bill the same work a second time (Codex review, 2026-09-27).
    if (batch?.id && batch.processing_status !== 'ended') {
      try { await client.beta.messages.batches.cancel(batch.id); } catch { /* best effort */ }
    }
  }
  return got;
}
