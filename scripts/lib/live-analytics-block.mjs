// Which requests the live browser checks (scripts/live/) must never let out.
//
// The checks open hundreds of pages of the real site twice a day. Until
// 2026-10-02 they silenced Plausible and GA4 and nothing else — and the daily
// report for 10-01 read "2,688 visits, bot surge": four runner runs (United
// States, 475 page loads each) plus the same checks run from the owner's desk
// (Vietnam) had all been counted by Cloudflare Web Analytics, whose beacon,
// unlike Plausible's script, does not skip an automated browser. The report's
// "top countries" and "popular pages" that day were our own checks.
//
// Cloudflare is silenced at the SEND, not at the script:
//   · the beacon tag Cloudflare injects carries integrity="sha512-…" and
//     type="module", so answering the script with an empty body fails the
//     integrity check and prints a console error — which the checks count as a
//     page failure (the first scheduled run went red exactly that way when the
//     other analytics were aborted instead of answered);
//   · what the beacon sends goes to /cdn-cgi/rum on the site's own origin
//     (cloudflareinsights.com/cdn-cgi/rum on older snippets). Answering that
//     with an empty 204 is what Cloudflare itself answers.
//
// And it takes two locks, measured 10-02 with the real tag served from
// localhost: the beacon reports with navigator.sendBeacon as the page is hidden
// or left, and a route answered only 2 of the 4 reports — a beacon fired while
// the page is going away is not reliably handed to the route. So launch() also
// swallows that one call inside the page (CF_RUM_SOURCE below).

/** Third-party analytics hosts: every request to them is answered empty. */
const HOSTS = /^https?:\/\/([^/]+\.)?(plausible\.io|googletagmanager\.com|google-analytics\.com|doubleclick\.net)\//;
/** Cloudflare Web Analytics' report endpoint, on any host. */
const CF_RUM = /^https?:\/\/[^/]+\/cdn-cgi\/rum(?:[/?#]|$)/;
/** The same pattern as text, for the in-page lock (an init script cannot close over a RegExp). */
export const CF_RUM_SOURCE = CF_RUM.source;

/** @param {string|URL} url */
export function isAnalyticsRequest(url) {
  const s = String(url);
  return HOSTS.test(s) || CF_RUM.test(s);
}
