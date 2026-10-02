// Shared by the live browser checks in scripts/live/ (2026-10-01, owner:
// "검증할 때마다 오류가 새로 생기잖아" → the checks built by hand that week now
// run on a schedule, against the live site, by live-checks.yml).
//
// - BASE: the site under test (argv[2], else LIVE_BASE, else production).
// - launch(): Chrome on the GitHub runner (preinstalled, nothing to download),
//   Edge on a Windows desk, or PW_CHANNEL. Every page it opens has the
//   analytics endpoints blocked — the checks open hundreds of pages, and
//   Plausible / GA4 / Cloudflare Web Analytics must not count them as readers
//   (the site's own visits were once 78% of its pageviews; on 10-01 these
//   checks WERE the day's "bot surge" — lib/live-analytics-block.mjs).
//   Every check must open its browser through launch(): a script that calls
//   chromium.launch() itself is counted by all three (live-scripts.test.mjs).
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAnalyticsRequest, CF_RUM_SOURCE } from '../lib/live-analytics-block.mjs';

/** The repository root, wherever it is checked out (a Windows desk or the Linux runner). */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const BASE = (process.argv[2] || process.env.LIVE_BASE || 'https://wanderatlasguides.com').replace(/\/$/, '');

const BLOCK = (url) => isAnalyticsRequest(url.href);

export async function launch() {
  const channel = process.env.PW_CHANNEL || (process.platform === 'win32' ? 'msedge' : 'chrome');
  const b = await chromium.launch({ channel });
  const newContext = b.newContext.bind(b);
  b.newContext = async (opts) => {
    const ctx = await newContext(opts);
    // Answered empty rather than aborted: an aborted request prints "Failed to
    // load resource" in the console, which the checks read as a page error
    // (first scheduled run, 10-01: two checks red for our own blocking).
    await ctx.route(BLOCK, (r) => r.fulfill({ status: 204, body: '' }));
    // GA4's snippet also honours this flag (BaseLayout), a second lock.
    await ctx.addInitScript(() => { try { localStorage.setItem('plausible_ignore', 'true'); } catch {} });
    // Cloudflare's beacon reports with sendBeacon as the page is hidden or left,
    // and the route above answered only half of those (measured 10-02). Swallow
    // that one call in the page; everything else sendBeacon/XHR does is untouched.
    await ctx.addInitScript((src) => {
      const rum = new RegExp(src);
      const isRum = (u) => { try { return rum.test(new URL(String(u), location.href).href); } catch { return false; } };
      // How many reports this page tried to send — analytics-silence.mjs reads it
      // to prove the beacon was running and was stopped, not merely absent.
      window.__waMutedBeacons = 0;
      const send = navigator.sendBeacon && navigator.sendBeacon.bind(navigator);
      if (send) navigator.sendBeacon = (u, d) => (isRum(u) ? (window.__waMutedBeacons++, true) : send(u, d));
      const open = XMLHttpRequest.prototype.open;
      const xsend = XMLHttpRequest.prototype.send;
      const muted = new WeakSet();
      XMLHttpRequest.prototype.open = function (m, u, ...rest) { if (isRum(u)) muted.add(this); return open.call(this, m, u, ...rest); };
      XMLHttpRequest.prototype.send = function (...a) { if (muted.has(this)) { window.__waMutedBeacons++; return undefined; } return xsend.apply(this, a); };
    }, CF_RUM_SOURCE);
    return ctx;
  };
  b.newPage = async (opts) => {
    const ctx = await b.newContext(opts);
    const page = await ctx.newPage();
    page.on('close', () => ctx.close().catch(() => {}));
    return page;
  };
  return b;
}

/** Mark the run failed (exit code 1) when `bad` is truthy, after printing `line`. */
export function verdict(line, bad) {
  console.log(line);
  if (bad) process.exitCode = 1;
}
