// Counts every Claude call a node process makes and appends a line per KST day
// to the cost ledger when the process exits.
//
// Every file that imports @anthropic-ai/sdk also imports this one; a test
// (claude-cost.test.mjs) fails the build when a new file forgets. It is not
// preloaded through NODE_OPTIONS: GitHub refuses NODE_OPTIONS in $GITHUB_ENV
// ("restricted from GITHUB_ENV", runner 2.309.0), which is how the first
// version of this meter was going to be switched on - it would never have run.
// All SDK instances share Messages.prototype.create (checked on 0.30.1), so one
// wrap covers every client, whichever file made it.
//
// Rules, each for a reason:
//  - It never throws. A meter that can stop a publish run is worse than none.
//  - It never changes what the caller gets. It counts when the caller takes the
//    result (then / withResponse) instead of reading the response itself, so
//    `.asResponse()` still gets an unread body (an eager read broke it).
//  - It writes only when CLAUDE_COST_LEDGER names a file (read at exit), so a
//    developer machine or a test never touches the real ledger by accident.
//  - It prints nothing: workflows turn some scripts' output into Telegram text.
//  - Each call is booked to the KST day it happened, not the day the process
//    ended, so a run that crosses midnight splits correctly.

import { appendFileSync } from 'node:fs';
import { basename } from 'node:path';
import { claudeUsd, kstDay } from './claude-cost.mjs';

const tally = new Map(); // `${day}\u0000${model}` -> counts

/** Count one response. Anything that is not a Claude message is ignored. */
export function meterRecord(res, at = new Date()) {
  try {
    if (!res || res.type !== 'message' || !res.usage) return;
    const model = res.model || '?';
    const key = `${kstDay(at)}\u0000${model}`;
    const u = res.usage;
    const t = tally.get(key) || { calls: 0, in: 0, out: 0, cache_w: 0, cache_r: 0, searches: 0, usd: 0, unpriced: 0 };
    t.calls += 1;
    t.in += u.input_tokens || 0;
    t.out += u.output_tokens || 0;
    t.cache_w += u.cache_creation_input_tokens || 0;
    t.cache_r += u.cache_read_input_tokens || 0;
    t.searches += u.server_tool_use?.web_search_requests || 0;
    const usd = claudeUsd(model, u);
    if (usd === null) t.unpriced += 1;
    else t.usd += usd;
    tally.set(key, t);
  } catch { /* never let accounting break a caller */ }
}

/** What this process has counted so far, by model (all days summed; tests read it). */
export function meterTally() {
  const out = {};
  for (const [key, t] of tally) {
    const model = key.split('\u0000')[1];
    const o = (out[model] ||= { calls: 0, in: 0, out: 0, cache_w: 0, cache_r: 0, searches: 0, usd: 0, unpriced: 0 });
    for (const k of Object.keys(o)) o[k] += t[k];
  }
  return out;
}

/** Append this process's lines (one per KST day) to the ledger. True when written. */
export function flushMeter() {
  try {
    const path = process.env.CLAUDE_COST_LEDGER;
    if (!path || !tally.size) return false;
    const byDay = new Map();
    for (const [key, t] of tally) {
      const [day, model] = key.split('\u0000');
      const models = byDay.get(day) || {};
      models[model] = { ...t, usd: Math.round(t.usd * 1e6) / 1e6 };
      byDay.set(day, models);
    }
    let text = '';
    for (const [day, models] of byDay) {
      text += JSON.stringify({
        ts: new Date().toISOString(),
        day,
        run: process.env.GITHUB_RUN_ID || null,
        // A re-run keeps its run id; without the attempt, attempt 2 would report
        // attempt 1's spend as its own.
        attempt: process.env.GITHUB_RUN_ATTEMPT || null,
        workflow: process.env.GITHUB_WORKFLOW || null,
        script: basename(process.argv[1] || '?'),
        models,
      }) + '\n';
    }
    appendFileSync(path, text);
    tally.clear();
    return true;
  } catch {
    return false;
  }
}

/** Wrap one SDK promise so the result is counted when the caller takes it. */
function watch(p) {
  try {
    let counted = false;
    const count = (v) => { if (!counted) { counted = true; meterRecord(v); } };
    // A plain Promise: `await` skips an own `then` on it and reads the internal
    // state directly, so chaining is the only way to see the value. Nothing is
    // lost - a plain Promise has no withResponse/asResponse to preserve.
    if (p && p.constructor === Promise) return p.then((v) => { count(v); return v; });
    // The SDK's APIPromise (a Promise subclass): `await` does call its `then`, so
    // wrap that and keep the instance, with withResponse/asResponse intact.
    const then = p.then;
    if (typeof then === 'function') {
      p.then = function (onFulfilled, onRejected) {
        return then.call(this, (v) => { count(v); return onFulfilled ? onFulfilled(v) : v; }, onRejected);
      };
    }
    const withResponse = p.withResponse;
    if (typeof withResponse === 'function') {
      p.withResponse = function (...args) {
        return withResponse.apply(this, args).then((r) => { count(r && r.data); return r; });
      };
    }
    // The SDK's catch/finally go straight to its internal parse(), skipping then,
    // so `await create(...).catch(f)` would go uncounted. Route them through the
    // wrapped then by hand - not via Promise.prototype.finally, which builds its
    // result with the APIPromise constructor and fails ("resolve or reject
    // function is not callable"; the constructor does not take an executor).
    p.catch = function (onRejected) { return this.then(undefined, onRejected); };
    p.finally = function (onFinally) {
      const run = () => Promise.resolve(typeof onFinally === 'function' ? onFinally() : undefined);
      return this.then((v) => run().then(() => v), (e) => run().then(() => { throw e; }));
    };
  } catch { /* leave the promise exactly as the SDK made it */ }
  return p;
}

try {
  const mod = await import('@anthropic-ai/sdk');
  const proto = (mod.default || mod).Messages?.prototype;
  if (proto && typeof proto.create === 'function' && !proto.create.__claudeMeter) {
    const original = proto.create;
    const metered = function (...args) { return watch(original.apply(this, args)); };
    metered.__claudeMeter = true;
    proto.create = metered;
  }
} catch {
  // SDK missing - meter nothing, break nothing.
}

process.on('exit', flushMeter);
