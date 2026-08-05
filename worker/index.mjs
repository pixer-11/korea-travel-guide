// ─────────────────────────────────────────────────────────────
//  WANDER ATLAS WORKER — server endpoints beside the static site.
//  Static assets are served asset-first by Cloudflare; only non-asset
//  paths reach this code. Everything degrades gracefully when an env
//  var is missing (static site is never affected).
//
//  Routes:
//   GET/POST /preferences  — subscriber self-service (HMAC-signed links)
//   POST     /tg           — Telegram bot webhook (owner-only remote control:
//                            /현황, /미리보기, /발송 → inline-button confirm)
//
//  Env (Cloudflare → Workers → korea-travel-guide → Settings → Variables):
//   MAILERLITE_API_TOKEN   — MailerLite API token
//   NEWSLETTER_LINK_SECRET — random string; signs /preferences links
//   TELEGRAM_BOT_TOKEN     — the site's own bot (NOT the second-brain bot)
//   TELEGRAM_CHAT_ID       — owner chat id (remote-control auth)
//   GITHUB_DISPATCH_TOKEN  — fine-grained PAT, Actions read/write on the repo
// ─────────────────────────────────────────────────────────────

const ML = 'https://connect.mailerlite.com/api';
const REPO = 'pixer-11/korea-travel-guide';
const NEWSLETTER_WORKFLOW = 'newsletter-weekly.yml';

// ── crypto helpers (Web Crypto, hex output) ──────────────────
const enc = new TextEncoder();
async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const timingSafeEq = (a, b) => {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
};

// ── MailerLite ───────────────────────────────────────────────
async function ml(env, path, opts = {}) {
  const res = await fetch(`${ML}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${env.MAILERLITE_API_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(opts.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`ML ${res.status}: ${JSON.stringify(body).slice(0, 150)}`);
  return body;
}

// ── Telegram ─────────────────────────────────────────────────
async function tg(env, method, payload) {
  return fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => r.json()).catch(() => null);
}
const say = (env, text, extra = {}) =>
  tg(env, 'sendMessage', { chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true, ...extra });

// ── GitHub workflow dispatch ─────────────────────────────────
async function dispatchNewsletter(env, live) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${NEWSLETTER_WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'wander-atlas-worker',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ ref: 'main', inputs: { live: live ? 'true' : 'false' } }),
  });
  return res.status === 204;
}

// ── /preferences ─────────────────────────────────────────────
const LANGS = { en: 'English', ko: '한국어', ja: '日本語', es: 'Español', zh: '中文' };

function prefsHtml({ email, region, lang, sig, saved = false, unsubbed = false }) {
  const opt = (val, cur, label) => `<option value="${val}"${val === cur ? ' selected' : ''}>${label}</option>`;
  const langOpts = Object.entries(LANGS).map(([v, l]) => opt(v, lang || 'en', l)).join('');
  const note = unsubbed
    ? '<p class="ok">Unsubscribed. You will not receive further emails. / 구독이 해지되었습니다.</p>'
    : saved ? '<p class="ok">Saved! / 저장되었습니다.</p>' : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Newsletter preferences · Wander Atlas</title><style>
body{font-family:system-ui,sans-serif;background:#f7f3ec;color:#201c17;margin:0;display:grid;place-items:center;min-height:100vh}
.card{background:#fff;border:1px solid #e5dfd2;border-radius:14px;padding:2rem;max-width:420px;width:calc(100% - 2rem);margin:1rem}
h1{font-size:1.3rem;margin:0 0 .35rem}p.dim{color:#6b6357;font-size:.92rem;margin:.2rem 0 1.2rem}
label{display:block;font-weight:600;margin:.9rem 0 .3rem}select,input{width:100%;padding:.55rem .7rem;border:1px solid #d8d2c4;border-radius:8px;font-size:1rem}
button{margin-top:1.2rem;width:100%;padding:.7rem;border:0;border-radius:9px;background:#c8443a;color:#fff;font-weight:700;font-size:1rem;cursor:pointer}
button.ghost{background:transparent;color:#8a2f28;border:1px solid #d8d2c4;margin-top:.6rem}
.ok{background:#eaf5ea;border:1px solid #bcd9bc;border-radius:8px;padding:.6rem .8rem}</style></head><body>
<div class="card"><h1>Newsletter preferences</h1><p class="dim">${email}</p>${note}
<form method="POST" action="/preferences">
<input type="hidden" name="e" value="${email}"><input type="hidden" name="s" value="${sig}">
<label>Region focus / 관심 지역</label><input name="region" value="${region || ''}" placeholder="e.g. seoul (blank = global picks)">
<label>Language / 언어</label><select name="lang">${langOpts}</select>
<button name="action" value="save">Save preferences</button>
<button class="ghost" name="action" value="unsubscribe">Unsubscribe / 구독 해지</button>
</form></div></body></html>`;
}

async function handlePreferences(request, env) {
  if (!env.MAILERLITE_API_TOKEN || !env.NEWSLETTER_LINK_SECRET) {
    return new Response('Preferences are not enabled yet.', { status: 503 });
  }
  const url = new URL(request.url);
  let email, sig, action = null, region = null, lang = null;
  if (request.method === 'POST') {
    const form = await request.formData();
    email = String(form.get('e') || '');
    sig = String(form.get('s') || '');
    action = String(form.get('action') || 'save');
    region = String(form.get('region') || '').trim().toLowerCase() || null;
    lang = String(form.get('lang') || 'en');
  } else {
    email = url.searchParams.get('e') || '';
    sig = url.searchParams.get('s') || '';
  }
  const want = await hmacHex(env.NEWSLETTER_LINK_SECRET, email.toLowerCase());
  if (!email || !timingSafeEq(want, sig)) return new Response('Invalid or expired link.', { status: 403 });

  if (request.method === 'POST') {
    if (action === 'unsubscribe') {
      // MailerLite: set status unsubscribed via upsert.
      await ml(env, '/subscribers', { method: 'POST', body: JSON.stringify({ email, status: 'unsubscribed' }) });
      return new Response(prefsHtml({ email, region, lang, sig, unsubbed: true }), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    await ml(env, '/subscribers', {
      method: 'POST',
      body: JSON.stringify({ email, fields: { region, lang } }),
    });
    return new Response(prefsHtml({ email, region, lang, sig, saved: true }), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  // GET — load current fields to prefill.
  let cur = {};
  try {
    const { data } = await ml(env, `/subscribers/${encodeURIComponent(email)}`);
    cur = data?.fields || {};
  } catch { /* new/unknown subscriber — empty form */ }
  return new Response(prefsHtml({ email, region: cur.region, lang: cur.lang, sig }), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// ── Telegram webhook (owner-only remote control) ─────────────
async function handleTelegram(request, env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return new Response('ok');
  // setWebhook registers secret_token = HMAC(bot_token, 'wh') — reject others.
  const want = await hmacHex(env.TELEGRAM_BOT_TOKEN, 'wh');
  const got = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
  if (!timingSafeEq(want.slice(0, 64), got)) return new Response('forbidden', { status: 403 });

  const update = await request.json().catch(() => null);
  if (!update) return new Response('ok');

  // Inline-button confirm for /발송 — stateless: callback carries a signed timestamp.
  if (update.callback_query) {
    const cq = update.callback_query;
    if (String(cq.from?.id) !== String(env.TELEGRAM_CHAT_ID)) return new Response('ok');
    const [tag, ts, sig] = String(cq.data || '').split(':');
    if (tag === 'send') {
      // Telegram caps callback_data at 64 BYTES — "send:" + 13-digit ts + ":" +
      // full 64-char HMAC is 83 and gets the whole message rejected, so both
      // sides use the first 40 hex chars (160 bits — ample for a 10-min token).
      const valid = timingSafeEq((await hmacHex(env.NEWSLETTER_LINK_SECRET || env.TELEGRAM_BOT_TOKEN, `send:${ts}`)).slice(0, 40), sig || '');
      const fresh = Date.now() - Number(ts) < 10 * 60 * 1000;
      if (!valid || !fresh) {
        await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: '만료된 버튼입니다. /발송 을 다시 입력하세요.' });
      } else if (!env.GITHUB_DISPATCH_TOKEN) {
        await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'GITHUB_DISPATCH_TOKEN 미설정' });
      } else {
        const ok = await dispatchNewsletter(env, true);
        await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: ok ? '발송 시작!' : '실패' });
        await say(env, ok
          ? '📮 뉴스레터 실제 발송을 시작했습니다. 몇 분 안에 발송 결과 알림이 옵니다.'
          : '❌ 발송 트리거 실패 — GITHUB_DISPATCH_TOKEN 권한을 확인해 주세요.');
      }
    }
    return new Response('ok');
  }

  const msg = update.message;
  if (!msg || String(msg.chat?.id) !== String(env.TELEGRAM_CHAT_ID)) return new Response('ok');
  const text = (msg.text || '').trim();

  if (text === '/현황' || text === '/status') {
    try {
      const { total } = await ml(env, '/subscribers?limit=0&page=1').then((r) => ({ total: r.meta?.total ?? r.total ?? '?' }));
      await say(env, `📊 뉴스레터 현황\n구독자: ${total}명\n다음 자동 발송: 매주 일요일 아침 (드라이런) — 실발송은 /발송 으로.`);
    } catch (e) {
      await say(env, `⚠️ 현황 조회 실패: ${e.message.slice(0, 120)}`);
    }
  } else if (text === '/미리보기' || text === '/preview') {
    if (!env.GITHUB_DISPATCH_TOKEN) { await say(env, '⚠️ GITHUB_DISPATCH_TOKEN이 아직 설정되지 않았습니다.'); return new Response('ok'); }
    const ok = await dispatchNewsletter(env, false);
    await say(env, ok
      ? '🔍 미리보기(드라이런)를 시작했습니다 — 실제 발송 없이 이번 주 내용을 만들어 몇 분 안에 알려드립니다.'
      : '❌ 미리보기 트리거 실패 — 토큰 권한을 확인해 주세요.');
  } else if (text === '/발송' || text === '/send') {
    const ts = String(Date.now());
    const sig = (await hmacHex(env.NEWSLETTER_LINK_SECRET || env.TELEGRAM_BOT_TOKEN, `send:${ts}`)).slice(0, 40);
    await say(env, '⚠️ 구독자 전원에게 실제 이메일을 보냅니다. 정말 발송할까요? (버튼은 10분간 유효)', {
      reply_markup: { inline_keyboard: [[{ text: '📮 네, 실제로 발송합니다', callback_data: `send:${ts}:${sig}` }]] },
    });
  } else if (text.startsWith('/')) {
    await say(env, '🤖 사용 가능한 명령\n/현황 — 구독자 수와 다음 발송 일정\n/미리보기 — 이번 주 뉴스레터 드라이런\n/발송 — 실제 발송 (버튼으로 한 번 더 확인)');
  }
  return new Response('ok');
}

// ── /api/subscribe ───────────────────────────────────────────
// First-party signup relay. Tracker blocklists (EasyPrivacy etc.) kill browser
// requests to assets.mailerlite.com — that was every "Network hiccup" signup
// failure — and MailerLite also 403s the form endpoint when called FROM a
// datacenter (worker) even with browser headers. So the reliable path is the
// official Connect API with our token: upsert the subscriber into the same
// "Newsletter Subscribers" group the embedded form fed. Form-endpoint forward
// stays as a best-effort fallback when the token env var is absent.
const ML_FORM = 'https://assets.mailerlite.com/jsonp/2523042/forms/193609989933237794/subscribe';
const SIGNUP_GROUP = 'Newsletter Subscribers';
let signupGroupId = null; // cached per isolate
async function handleSubscribe(request, env) {
  const form = await request.formData().catch(() => null);
  const email = String(form?.get('fields[email]') || '');
  if (!/.+@.+\..+/.test(email)) return Response.json({ success: false, error: 'invalid-email' }, { status: 400 });

  if (env.MAILERLITE_API_TOKEN) {
    const fields = {};
    // itinerary_url: set by the itinerary-page lead magnet; the welcome
    // automation uses it to link the subscriber back to the exact plan.
    for (const k of ['region', 'lang', 'signup_source', 'itinerary_url']) {
      const v = String(form.get(`fields[${k}]`) || '');
      if (v) fields[k] = v;
    }
    // itinerary_url lands as a LINK in the welcome email. The form only ever
    // sends our own itinerary paths, but the endpoint is public — a crafted
    // POST could plant an arbitrary external URL and turn our welcome mail
    // into a phishing carrier. Accept only our own /itinerary/ pages; anything
    // else is dropped (signup still proceeds, just without the deep link).
    if (fields.itinerary_url &&
        !/^https:\/\/wanderatlasguides\.com\/(?:(?:ko|ja|es|zh)\/)?itinerary\/[a-z0-9-]+\/?$/.test(fields.itinerary_url)) {
      delete fields.itinerary_url;
    }
    if (!signupGroupId) {
      try {
        const g = await ml(env, `/groups?filter[name]=${encodeURIComponent(SIGNUP_GROUP)}&limit=100`);
        signupGroupId = (g.data || []).find((x) => x.name === SIGNUP_GROUP)?.id || null;
      } catch { /* group lookup failing must not block the signup itself */ }
    }
    // Double opt-in. The Connect API defaults a created subscriber to
    // `active`, which silently skipped confirmation the moment we moved off
    // the form endpoint: every page promised a confirmation link that never
    // arrived, and anyone could sign a stranger up. Creating them as
    // `unconfirmed` hands the confirmation email back to MailerLite.
    // NEVER downgrade an existing active subscriber (they'd stop receiving
    // the newsletter) or resurrect an unsubscribed one (that ignores their
    // opt-out) — only new and still-unconfirmed records carry the status.
    let keepStatus = false;
    try {
      const cur = await ml(env, `/subscribers/${encodeURIComponent(email)}`);
      const s = cur?.data?.status;
      keepStatus = s === 'active' || s === 'unsubscribed';
    } catch { /* unknown email — a genuinely new signup */ }
    const upsert = (f) => ml(env, '/subscribers', {
      method: 'POST',
      body: JSON.stringify({
        email,
        fields: f,
        ...(signupGroupId ? { groups: [signupGroupId] } : {}),
        ...(keepStatus ? {} : { status: 'unconfirmed' }),
      }),
    });
    try {
      await upsert(fields);
      return Response.json({ success: true });
    } catch (e) {
      // A custom field that doesn't exist in MailerLite yet 422s the whole
      // upsert. Losing the signup over metadata is never acceptable — retry
      // once with only the battle-tested core fields.
      if (fields.itinerary_url) {
        const { itinerary_url, ...core } = fields;
        try {
          await upsert(core);
          return Response.json({ success: true });
        } catch { /* fall through to the real error */ }
      }
      return Response.json({ success: false, error: String(e.message).slice(0, 120) }, { status: 502 });
    }
  }

  // No API token configured on the worker — forward to the form endpoint and
  // hope this POP isn't blocked (better than dropping the signup silently).
  const res = await fetch(ML_FORM, {
    method: 'POST',
    body: form,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      Origin: 'https://wanderatlasguides.com',
      Referer: 'https://wanderatlasguides.com/',
      Accept: 'application/json',
    },
  });
  const body = await res.json().catch(() => ({ success: false }));
  return Response.json(body, { status: res.ok ? 200 : res.status });
}

// ── Klook click relay ────────────────────────────────────────
// Klook attribution lives in ONE field: aid=api|13694|<click-token>-754088|…
// Travelpayouts mints that token per click. Until 2026-07-29 its Drive script
// did it in the browser; dropping that script (26 of every page's 38 requests,
// pulling doubleclick and googlesyndication along with it) left every Klook link
// on the site with an EMPTY token slot — `api|13694|-754088|pid|754088`. The
// links still reach Klook, so nothing looked broken, but no booking made through
// them can be credited. Hotels were genuinely unaffected: their marker sits in
// the URL itself, which is the case the removal commit checked.
//
// A Travelpayouts short link mints a real token but always lands on Klook's
// homepage, and appending `?k_site=` to it is ignored (verified 2026-08-06). So:
// ask the short link for its redirect, take the token it just issued, and
// re-point k_site at the page the reader actually asked for. One extra hop,
// server-side, and no third-party script back on the page.
//
// Fails OPEN: any error still sends the reader to Klook. A missed commission is
// bad; a dead "Where to stay" button on every guide is worse.
const TP_KLOOK_SHORTLINK = 'https://klook.tpx.lv/2NXPH8MA';

async function handleKlookGo(request) {
  const to = new URL(request.url).searchParams.get('to');
  const dest = to && /^https:\/\/(www\.)?klook\.com\//.test(to) ? to : 'https://www.klook.com/';
  const fallback = `https://affiliate.klook.com/redirect?aid=api%7C13694%7C-754088%7Cpid%7C754088&k_site=${encodeURIComponent(dest)}`;
  try {
    const res = await fetch(TP_KLOOK_SHORTLINK, { redirect: 'manual' });
    const loc = res.headers.get('location') || '';
    const aid = new URL(loc).searchParams.get('aid');
    // A token-bearing aid looks like api|13694|<hex>-754088|pid|754088. An empty
    // middle segment means we gained nothing — take the fallback rather than
    // dress it up as tracked.
    if (!aid || !/\|13694\|[0-9a-f]{8,}-/.test(aid)) return Response.redirect(fallback, 302);
    return Response.redirect(
      `https://affiliate.klook.com/redirect?aid=${encodeURIComponent(aid)}&k_site=${encodeURIComponent(dest)}`, 302);
  } catch {
    return Response.redirect(fallback, 302);
  }
}

// ── router ───────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    try {
      // Both spellings: the build's trailing-slash pass rewrites every in-page
      // href, so what actually ships is /go/klook/?to=… — matching only the
      // slashless form would have sent all 8,706 affiliate links to the 404
      // handler (caught in the build, 2026-08-06).
      if (pathname === '/go/klook' || pathname === '/go/klook/') return await handleKlookGo(request);
      if (pathname === '/preferences' || pathname === '/preferences/') return await handlePreferences(request, env);
      if (pathname === '/tg' && request.method === 'POST') return await handleTelegram(request, env);
      if (pathname === '/api/subscribe' && request.method === 'POST') return await handleSubscribe(request, env);
    } catch (e) {
      return new Response(`error: ${e.message}`, { status: 500 });
    }
    // Anything else (incl. the site's own 404 page) — serve static assets.
    const res = await env.ASSETS.fetch(request);
    // Slash-less URLs of REDIRECTED posts 404ed: the assets layer auto-corrects
    // trailing slashes only for pages that exist, and _redirects entries match
    // exact paths — so /posts/<retired-slug> (no slash) fell straight to 404
    // while /posts/<retired-slug>/ 301ed properly (live-render audit,
    // 2026-08-03). On a would-be 404 with no slash and no file extension, send
    // the browser to the slashed path once; its next request hits _redirects.
    // The slashed variant of a truly-missing page still 404s normally, so no
    // loop is possible.
    if (res.status === 404 && request.method === 'GET') {
      const url = new URL(request.url);
      if (!url.pathname.endsWith('/') && !/\.[a-z0-9]+$/i.test(url.pathname)) {
        url.pathname += '/';
        return Response.redirect(url.toString(), 301);
      }
    }
    return res;
  },
};
