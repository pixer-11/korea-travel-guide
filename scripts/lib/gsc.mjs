// Google Search Console access — the one home for it.
//
// gsc-report.mjs carried its own copy of the JWT signing, the query call and the
// Telegram post. audit-impression-cohort.mjs needed the same three, and a second
// copy would have drifted the moment either changed (a scope, a lag, a chat id).
// Both import from here instead.
//
// Auth: a Google service account, signed with node:crypto (no googleapis
// dependency). The owner adds the service-account email as a Search Console user
// once; nothing else is stored.
//
//   GSC_SERVICE_ACCOUNT_JSON  the service-account JSON key (whole file, as a secret)
//   GSC_SITE_URL              e.g. "sc-domain:wanderatlasguides.com"
import { createSign } from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Service-account JWT → OAuth access token (RFC 7523 flow).
export async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const sig = b64url(signer.sign(sa.private_key));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claim}.${sig}`,
    }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error(`token: ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token;
}

export async function query(token, site, body) {
  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
  if (!res.ok) throw new Error(`GSC ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export async function telegram(text) {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) { console.log(text); return; }
  const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
  });
  const j = await r.json().catch(() => ({}));
  // Throw, don't log. For the cohort watch and the verdict reminder the Telegram
  // message IS the deliverable — a job that "succeeds" after the send failed
  // means a 401 or a wrong chat id silently swallows the one alert that mattered,
  // and job-failure-alert never hears about it. Missing secrets are different and
  // are handled above: that is a not-configured-yet skip, not a delivery failure.
  if (!j.ok) throw new Error(`Telegram send failed: ${JSON.stringify(j).slice(0, 200)}`);
}

// A date offset from today, YYYY-MM-DD. GSC data lags ~2 days, so callers ask for
// windows ending at day(-2), never today.
export const day = (offset) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

// Read and parse the service-account secret. Returns null (having explained why)
// when the environment isn't configured, so a caller can skip cleanly.
export function serviceAccount() {
  const { GSC_SERVICE_ACCOUNT_JSON, GSC_SITE_URL } = process.env;
  if (!GSC_SERVICE_ACCOUNT_JSON || !GSC_SITE_URL) {
    console.error('GSC_SERVICE_ACCOUNT_JSON / GSC_SITE_URL missing — skipping.');
    return null;
  }
  try { return JSON.parse(GSC_SERVICE_ACCOUNT_JSON); }
  catch { console.error('GSC_SERVICE_ACCOUNT_JSON is not valid JSON'); return null; }
}
