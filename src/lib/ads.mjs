// Ad-network readiness: one data file, two outputs.
//
// The owner's goal is traffic that can carry ads (2026-10-09). AdSense and the
// ad networks after it all need the loader on the page BEFORE the application
// is reviewed, and an ads.txt at the root that names the publisher. Both are
// derived from data/ads.json so switching ads on is a one-line edit of that
// file plus the network's own dashboard, not a code change. With the file
// empty (today) nothing renders and no ads.txt is written: the site is exactly
// as it was.
//
// A publisher id is public by design (it sits in every page's source and in
// ads.txt), so it belongs in data/, not in a secret.

export const ADSENSE_CLIENT_RE = /^ca-pub-\d{10,20}$/;

/** The validated AdSense client id, or '' when ads are off or the id is malformed. */
export function adsenseClient(ads) {
  const id = String(ads?.adsense?.client ?? '').trim();
  return ADSENSE_CLIENT_RE.test(id) ? id : '';
}

/** True when any network is configured: the page may load an ad script. */
export function adsEnabled(ads) {
  return Boolean(adsenseClient(ads));
}

/**
 * Lines for /ads.txt (IAB spec: domain, publisher id, relationship, certification
 * authority id). AdSense's publisher id in ads.txt drops the "ca-" prefix.
 * Extra lines (another network, a reseller) come verbatim from ads.extraAdsTxt.
 */
export function adsTxtLines(ads) {
  const out = [];
  const client = adsenseClient(ads);
  if (client) out.push(`google.com, ${client.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0`);
  for (const line of ads?.extraAdsTxt ?? []) {
    const s = String(line).trim();
    if (s) out.push(s);
  }
  return out;
}

/** The AdSense loader URL for the page head, or '' when off. */
export function adsenseLoaderSrc(ads) {
  const client = adsenseClient(ads);
  return client ? `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}` : '';
}
