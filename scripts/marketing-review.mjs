#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  WEEKLY MARKETING REVIEW — the user's standing directive made automatic:
//  "꾸준히 주기적으로 더 나은 마케팅 방법과 노출·유입 최적화를 고민해서 알려줘".
//  Gathers REAL current data (search near-misses, traffic snapshot, coverage,
//  channel states) → a Claude marketing-strategist pass → 3-5 prioritized,
//  concrete suggestions in Korean → owner Telegram.
//  Env: ANTHROPIC_API_KEY (required), GSC_SERVICE_ACCOUNT_JSON + GSC_SITE_URL
//  (optional — adds search data), TELEGRAM_* (send).
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import { readFile, readdir } from 'node:fs/promises';
import { createSign } from 'node:crypto';
import matter from 'gray-matter';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.WRITER_MODEL || 'claude-sonnet-5';

// ── GSC (same JWT flow as gsc-report.mjs, read-only) ─────────
async function gscData() {
  const { GSC_SERVICE_ACCOUNT_JSON, GSC_SITE_URL } = process.env;
  if (!GSC_SERVICE_ACCOUNT_JSON || !GSC_SITE_URL) return null;
  try {
    const sa = JSON.parse(GSC_SERVICE_ACCOUNT_JSON);
    const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/webmasters.readonly', aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now }));
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${claim}`);
    const assertion = `${header}.${claim}.${b64url(signer.sign(sa.private_key))}`;
    const tok = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    }).then((r) => r.json());
    if (!tok.access_token) return null;
    const day = (o) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + o); return d.toISOString().slice(0, 10); };
    const q = (body) => fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(process.env.GSC_SITE_URL)}/searchAnalytics/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then((r) => r.json());
    const queries = await q({ startDate: day(-8), endDate: day(-1), dimensions: ['query'], rowLimit: 25 });
    return { topQueries: (queries.rows ?? []).map((r) => ({ q: r.keys[0], clicks: r.clicks, imp: r.impressions, pos: Math.round(r.position * 10) / 10 })) };
  } catch { return null; }
}

async function main() {
  // Coverage: posts per country/category.
  const byCountry = {};
  let events = 0, total = 0;
  for (const f of (await readdir('src/content/posts')).filter((f) => f.endsWith('.md'))) {
    try {
      const { data } = matter(await readFile(`src/content/posts/${f}`, 'utf8'));
      if (data.draft) continue;
      total++;
      const c = data.country ?? 'South Korea';
      byCountry[c] = (byCountry[c] || 0) + 1;
      if (data.category === 'event') events++;
    } catch {}
  }
  let perf = null;
  try { perf = JSON.parse(await readFile('data/performance-log.json', 'utf8')).slice(-1)[0]; } catch {}
  const gsc = await gscData();

  const facts = {
    posts_live: total,
    events_posts: events,
    posts_by_country: byCountry,
    latest_week_traffic: perf,
    gsc_last7d: gsc,
    // Keep this block current. It was frozen at its July wording until
    // 2026-09-01, by which point every line of it was false — and the review
    // spent that week asking the owner to switch on Pinterest and the
    // newsletter, both of which had been live for over a month. A weekly
    // report that assigns finished work is worse than no report.
    channels: {
      pinterest: 'LIVE since 2026-08-08 — auto-pins posting daily (ramping 2→8/day), weekly scorecard to Telegram Mondays',
      newsletter: 'LIVE since 2026-07-26 — MailerLite sending, welcome flow + itinerary lead magnet live since 08-02; subscriber growth is the open problem, not the plumbing',
      social: 'Instagram @wander_atlas_guides + Threads LIVE since 2026-08-27 — Threads daily, Instagram carousels Mon/Wed/Fri, all automated',
      seo: 'sitemap/hreflang/schema/llms.txt done; GSC weekly report live. THE bottleneck is backlinks — domain authority is the reason good pages sit on page 8',
    },
    constraints: 'INDEXATION FROZEN since 2026-07-25 — Google is accepting no new pages, so publishing is throttled to ~25/day (was 330) and new posts are not a growth lever right now; accuracy-first: real photos only (vision-gated); non-technical solo owner, minimal manual work preferred. Do NOT propose work already listed as LIVE above.',
  };

  // max_tokens has to clear the REASONING as well as the answer. sonnet-5
  // reasons by default, and that reasoning is spent BEFORE the first word of
  // the reply: on 2026-09-01 this call came back stop_reason=max_tokens with
  // thinking_tokens=1400 of output_tokens=1400 and not one text block — an
  // empty Telegram message, and the job still exited 0. A thinking budget is
  // not the lever here (budget_tokens is rejected outright on sonnet-5); the
  // levers are a roomier ceiling and `effort`. Strategy is exactly the kind of
  // work reasoning earns its keep on, so it stays on, held to medium.
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    output_config: { effort: 'medium' },
    messages: [{
      role: 'user',
      content:
        `You are a growth strategist for wanderatlasguides.com (automated multilingual travel guide, accuracy-first). ` +
        `Given this REAL current data, propose the 3-5 highest-leverage actions for the coming week to grow exposure and visitor inflow. ` +
        `Rules: concrete and immediately actionable (name the page/feature/query), respect the constraints, prefer automation the site can do itself, ` +
        `mark any owner-required step with (오너 5분) style time estimates, no generic advice ("post on social media" without specifics is banned). ` +
        `If search data shows near-page-1 queries (position 5-20 with impressions), lead with those. ` +
        `Answer in KOREAN, as a numbered list, each item: 제목 — 왜 지금 — 무엇을 (1-2 sentences each). Start with the line "📣 주간 마케팅 제안".\n\n` +
        `DATA:\n${JSON.stringify(facts, null, 1).slice(0, 6000)}`,
    }],
  });
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  // An empty answer used to leave through the front door: console.log(''),
  // a Telegram send Telegram rejects for an empty body, and a green tick on
  // the job. Fail loudly instead, so the failure alert fires and the week's
  // review is not silently skipped.
  if (!text) {
    throw new Error(`empty review — stop_reason=${msg.stop_reason}, output_tokens=${msg.usage?.output_tokens}, thinking_tokens=${msg.usage?.output_tokens_details?.thinking_tokens}, blocks=[${msg.content.map((b) => b.type).join(',')}]`);
  }
  console.log(text);

  const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    // Nobody was reading Telegram's answer, so the week the body went out
    // empty, Telegram's rejection went out with it — unseen. The send is this
    // job's entire product; if it fails, the job failed.
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4000), disable_web_page_preview: true }),
    });
    if (!res.ok) throw new Error(`telegram send failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
