#!/usr/bin/env node
// GOOGLE SEARCH CONSOLE → Telegram (Korean).
// The site had no query-level feedback loop: Plausible shows traffic that already
// arrived, but only GSC shows what ALMOST ranked. This pulls the last 7 days and
// surfaces the highest-leverage list for a young site — "near-miss" queries sitting
// on page 2 (position 11-20) with real impressions, i.e. pages one tweak away from
// page 1 — plus the week's totals and top queries/pages.
//
// Auth: a Google service account, signed here with node:crypto (no googleapis
// dependency). Requires the owner to add the service-account email as a user in
// Search Console once.
//
//   GSC_SERVICE_ACCOUNT_JSON  the service-account JSON key (whole file, as a secret)
//   GSC_SITE_URL              e.g. "sc-domain:wanderatlasguides.com"
import { createSign } from 'node:crypto';

const { GSC_SERVICE_ACCOUNT_JSON, GSC_SITE_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Service-account JWT → OAuth access token (RFC 7523 flow).
async function getAccessToken(sa) {
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

async function query(token, site, body) {
  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
  if (!res.ok) throw new Error(`GSC ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function telegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) { console.log(text); return; }
  const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) console.error('Telegram failed:', JSON.stringify(j).slice(0, 200));
}

const day = (offset) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

async function main() {
  if (!GSC_SERVICE_ACCOUNT_JSON || !GSC_SITE_URL) {
    console.error('GSC_SERVICE_ACCOUNT_JSON / GSC_SITE_URL missing — skipping.');
    return;
  }
  let sa;
  try { sa = JSON.parse(GSC_SERVICE_ACCOUNT_JSON); }
  catch { console.error('GSC_SERVICE_ACCOUNT_JSON is not valid JSON'); return; }

  // GSC data lags ~2 days; ask for the 7 days ending 2 days ago.
  const endDate = day(-2), startDate = day(-9);

  let token, totals, queries, pages;
  try {
    token = await getAccessToken(sa);
    [totals, queries, pages] = await Promise.all([
      query(token, GSC_SITE_URL, { startDate, endDate, dimensions: [] }),
      query(token, GSC_SITE_URL, { startDate, endDate, dimensions: ['query'], rowLimit: 200 }),
      query(token, GSC_SITE_URL, { startDate, endDate, dimensions: ['page'], rowLimit: 10 }),
    ]);
  } catch (e) {
    await telegram(`🔎 Wander Atlas — 검색 리포트 오류\n${e.message.slice(0, 300)}`);
    return;
  }

  const t = totals.rows?.[0] ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  const rows = queries.rows ?? [];

  // The actionable list: page-2 queries with real demand.
  const nearMiss = rows
    .filter((r) => r.position > 10 && r.position <= 20 && r.impressions >= 5)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 8);

  const topQ = rows.slice().sort((a, b) => b.clicks - a.clicks).filter((r) => r.clicks > 0).slice(0, 5);
  const shortPage = (u) => decodeURIComponent(String(u).replace(/^https?:\/\/[^/]+/, '')).slice(0, 48) || '/';

  const lines = [
    `🔎 Wander Atlas — 구글 검색 리포트 (${startDate} ~ ${endDate})`,
    `👆 클릭 ${t.clicks} · 👀 노출 ${t.impressions} · CTR ${(t.ctr * 100).toFixed(1)}% · 평균순위 ${t.position.toFixed(1)}위`,
  ];

  if (topQ.length) {
    lines.push('', '🏆 클릭 많은 검색어:');
    for (const r of topQ) lines.push(`  • ${r.keys[0]} — 클릭 ${r.clicks} (${r.position.toFixed(1)}위)`);
  }

  if (nearMiss.length) {
    lines.push('', '🎯 조금만 손보면 1페이지 갈 검색어 (2페이지에 있음):');
    for (const r of nearMiss) lines.push(`  • ${r.keys[0]} — ${r.position.toFixed(1)}위, 노출 ${r.impressions}`);
    lines.push('  → 이 주제의 글 제목·본문을 보강하면 1페이지 진입 가능');
  } else {
    lines.push('', '🎯 2페이지권 검색어: 아직 없음 (노출이 더 쌓이면 표시)');
  }

  if (pages.rows?.length) {
    lines.push('', '📄 검색 유입 상위 페이지:');
    for (const r of pages.rows.slice(0, 5)) lines.push(`  • ${shortPage(r.keys[0])} — 클릭 ${r.clicks}, 노출 ${r.impressions}`);
  }

  const text = lines.join('\n');
  console.log(text);
  await telegram(text);
}

main().catch((e) => console.error(e));
