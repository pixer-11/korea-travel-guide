// Retries through the Message Batches API instead of direct at full price.
//
// translate-posts sent only first attempts as a batch. Everything else went
// direct at full price: a reply a gate refused and asked for again, a patch
// that fell back to a full translation, and every run under 8 jobs (the repair
// steps, a retitled post, the tail of a country backfill). On 2026-10-18..11-01
// that was $25 of $182, ~$50 a month, for requests byte-for-byte the same as
// the batched ones. The 8-job floor and "retries go direct" were set when a
// one-request batch took 74 min (2026-09-27); 46 batches measured from
// 10-08 to 11-02 came back in 1.5-10 min, small ones in 1.5-3, one timed out.
//
// So a direct call is not made in place: the caller throws Deferred, and the
// request waits for the next round, which goes out as one batch. Whatever a
// round's batch does not return goes direct, as before, so a slow batch costs
// time, never a translation.

export class Deferred extends Error {
  constructor(job) {
    super('deferred to the next batch round');
    this.job = job;
  }
}

/** Run `fn` over `items`, `concurrency` at a time. */
export async function pool(items, concurrency, fn) {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

/**
 * Settle deferred jobs in rounds until none is left.
 *  - batch(jobs) -> Map(index -> reply) for the replies it got (may be empty)
 *  - direct(job) -> reply, for a job the batch did not return
 *  - run(job, reply) settles it, or throws Deferred for one more round
 * The caller bounds the rounds: each retry raises the job's attempt, and the
 * last attempt never defers.
 * @returns {Promise<{ done: number, failed: number, rounds: number }>}
 */
export async function settleInRounds(queue, { batch, direct, run, concurrency = 4, onFail = () => {} }) {
  let done = 0, failed = 0, rounds = 0;
  let todo = queue;
  while (todo.length) {
    rounds++;
    const later = [];
    const replies = await batch(todo);
    await pool(todo, concurrency, async (job, i) => {
      try {
        await run(job, replies.get(i) || await direct(job));
        done++;
      } catch (e) {
        if (e instanceof Deferred) later.push(e.job);
        else { failed++; onFail(job, e); }
      }
    });
    todo = later;
  }
  return { done, failed, rounds };
}
