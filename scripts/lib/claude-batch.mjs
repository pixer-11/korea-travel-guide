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

// How long a cancelled batch gets to finish what it already started. Workflows
// that budget their time (discover-events.yml) reserve exactly this much.
export const CANCEL_WAIT_MIN = 30;

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
    for await (const r of await client.beta.messages.batches.results(batch.id)) {
      if (r?.result?.type !== 'succeeded') continue;
      const id = byCid.get(r.custom_id);
      const msg = r.result.message;
      if (!id || !msg) continue;
      meterRecord(msg, new Date(), 0.5);
      got.set(id, msg);
    }
    log(`batch ${batch.id}: ${got.size}/${items.length} succeeded (${JSON.stringify(batch.request_counts)})`);
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
