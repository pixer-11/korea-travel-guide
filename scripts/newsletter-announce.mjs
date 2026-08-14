// One-off product-announcement campaign: the Tokyo 3-Day Field Guide PDF
// (growth research C1). Sends ONE email per subscriber, bucketed by language
// only — a product launch goes to the whole list, not per-region editions.
//
//   node scripts/newsletter-announce.mjs                # dry-run (needs API token)
//   node scripts/newsletter-announce.mjs --render-only  # write previews, no network
//   node scripts/newsletter-announce.mjs --live         # real send
//
// Same magazine template language as newsletter-render.mjs; same live gate
// contract as newsletter-send.mjs (live only via manual workflow_dispatch).
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mailerlite } from './lib/mailerlite.mjs';

const LIVE = process.argv.includes('--live');
const RENDER_ONLY = process.argv.includes('--render-only');
const { MAILERLITE_API_TOKEN, NEWSLETTER_FROM_EMAIL, NEWSLETTER_FROM_NAME = 'Wander Atlas' } = process.env;
const SITE = 'https://wanderatlasguides.com';
const PRODUCT_URL = 'https://wanderatlas.gumroad.com/l/tokyo-3-day-guide';
const HERO = `${SITE}/newsletter/tokyo-guide-cover.png`;
const PRICE = '$12';
const OUT_DIR = fileURLToPath(new URL('../.newsletter-preview/', import.meta.url));
const CAMPAIGN_TAG = 'announce-tokyo-guide-2026-08';

const P = { paper: '#f7f3ec', tint: '#f1ebe0', ink: '#201c17', soft: '#4a443c', acc: '#c8443a', accd: '#a5352c', gold: '#b8862f' };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const COPY = {
  en: {
    subject: 'Our first field guide is here — Tokyo in 3 days (PDF)',
    preheader: 'A map QR for every stop, verified hours, and a rain plan — trip planning that works without signal.',
    kicker: 'New · Field Guide',
    title: 'Tokyo in three days — now in your pocket',
    intro: "The worst travel moment I know: losing signal mid-trip. The map won't load — and neither will that itinerary page you had open.",
    body: 'So we made something for that. The Tokyo 3-Day Field Guide — our Tokyo itinerary rebuilt from scratch as an 8-page PDF you can actually carry.',
    featuresLabel: "What's inside",
    features: [
      'A scan-and-go Google Maps QR code for all 9 stops — works even from a printed page',
      'Verified hours, ratings and addresses, plus the quiet window for every major sight',
      'An indoor rain plan for each day',
      'A booking timeline and packing checklist (including the one clothing rule for teamLab)',
    ],
    free: 'The itinerary on our site stays free, as always. The PDF is for travelers who want it in their pocket, no signal needed.',
    cta: `Get the Tokyo Field Guide — ${PRICE}`,
    ps: 'P.S. Hit reply and tell me which city we should build next — I read every answer.',
    sign: '— Pixer, Wander Atlas',
    prefs: 'Preferences', unsubscribe: 'Unsubscribe',
  },
  ko: {
    subject: '첫 필드 가이드가 나왔어요 — 도쿄 3일 (PDF)',
    preheader: '정류장마다 지도 QR, 검증된 영업시간, 우천 플랜까지 — 인터넷 없이 쓰는 여행 계획.',
    kicker: 'New · Field Guide',
    title: '도쿄 3일, 이제 주머니 속에',
    intro: '여행 중에 제일 곤란한 순간은 길 위에서 데이터가 끊길 때더라고요. 지도가 안 열리고, 아까 봤던 그 일정 페이지도 안 열리고요.',
    body: '그래서 만들었습니다. 도쿄 3일 필드 가이드 — 저희 도쿄 일정을 여행 당일 들고 다닐 수 있게 처음부터 다시 설계한 8페이지 PDF예요.',
    featuresLabel: '이런 게 들어 있어요',
    features: [
      '정류장 9곳마다 구글맵 바로가기 QR 코드 — 인쇄물에서도 스캔하면 길찾기가 열려요',
      '검증된 영업시간·평점·주소, 그리고 명소마다 한산한 시간대',
      '비 오는 날을 위한 하루별 실내 대체 플랜',
      '예약 타임라인과 짐 체크리스트 (teamLab의 복장 규칙 하나 포함)',
    ],
    free: '웹사이트의 일정은 지금처럼 계속 무료입니다. 이 PDF는 오프라인으로, 손에 들고 다니고 싶은 분을 위한 버전이에요.',
    cta: `도쿄 필드 가이드 받기 — ${PRICE}`,
    ps: 'P.S. 다음 도시로 어디를 만들면 좋을지, 답장으로 알려주세요. 진짜로 읽습니다.',
    sign: '— Pixer, Wander Atlas',
    prefs: '수신 설정', unsubscribe: '수신 거부',
  },
  ja: {
    subject: '初のフィールドガイドができました — 東京3日間（PDF）',
    preheader: '各スポットの地図QR、確認済み営業時間、雨の日プランまで — 通信なしで使える旅行プラン。',
    kicker: 'New · Field Guide',
    title: '東京3日間を、ポケットの中に',
    intro: '旅行中いちばん困るのは、移動中に通信が切れる瞬間ではないでしょうか。地図も開かず、さっき見ていた旅程ページも開かない。',
    body: 'そこで作りました。東京3日間フィールドガイド — 当サイトの東京旅程を、旅先で持ち歩けるよう一から設計し直した8ページのPDFです。',
    featuresLabel: '内容',
    features: [
      '9つの全スポットにGoogleマップQRコード — 印刷したページからでもスキャンでルート案内が開きます',
      '確認済みの営業時間・評価・住所、そして主要スポットの空いている時間帯',
      '日ごとの屋内雨天代替プラン',
      '予約タイムラインと持ち物チェックリスト（teamLabの服装ルールも）',
    ],
    free: 'サイト上の旅程はこれまでどおり無料のままです。このPDFは、オフラインで手元に置きたい方のための版です。',
    cta: `東京フィールドガイドを入手 — ${PRICE}`,
    ps: 'P.S. 次はどの都市のガイドが欲しいか、返信で教えてください。すべて読んでいます。',
    sign: '— Pixer, Wander Atlas',
    prefs: '設定', unsubscribe: '配信停止',
  },
  es: {
    subject: 'Nuestra primera guía de campo — Tokio en 3 días (PDF)',
    preheader: 'Un QR de mapa por parada, horarios verificados y plan de lluvia — planificación que funciona sin señal.',
    kicker: 'New · Field Guide',
    title: 'Tokio en tres días — ahora en tu bolsillo',
    intro: 'El peor momento de un viaje: quedarse sin señal a mitad de camino. El mapa no carga — y tampoco esa página del itinerario que tenías abierta.',
    body: 'Así que hicimos algo para eso. La Guía de Campo de Tokio en 3 días — nuestro itinerario de Tokio rediseñado desde cero como un PDF de 8 páginas que puedes llevar contigo.',
    featuresLabel: 'Qué incluye',
    features: [
      'Un código QR de Google Maps para las 9 paradas — funciona incluso desde una página impresa',
      'Horarios, valoraciones y direcciones verificados, más la franja tranquila de cada lugar',
      'Un plan de interior para días de lluvia, para cada día',
      'Cronograma de reservas y lista de equipaje (incluida la regla de vestimenta de teamLab)',
    ],
    free: 'El itinerario de nuestra web sigue siendo gratis, como siempre. El PDF es para quien lo quiere en el bolsillo, sin necesidad de señal.',
    cta: `Conseguir la guía de Tokio — ${PRICE}`,
    ps: 'P.D. Responde y dime qué ciudad deberíamos hacer después — leo todas las respuestas.',
    sign: '— Pixer, Wander Atlas',
    prefs: 'Preferencias', unsubscribe: 'Darse de baja',
  },
  zh: {
    subject: '我们的第一本实用指南来了 — 东京3日（PDF）',
    preheader: '每个站点都有地图二维码、核实过的营业时间和雨天方案 — 没有网络也能用的行程。',
    kicker: 'New · Field Guide',
    title: '东京3日，装进口袋',
    intro: '旅行中最尴尬的时刻：走到半路没了网络。地图打不开，刚才看的行程页面也打不开。',
    body: '所以我们做了这个。东京3日实用指南 — 把我们的东京行程从头重新设计成一份可以随身携带的8页PDF。',
    featuresLabel: '内含',
    features: [
      '9个站点都配有谷歌地图二维码 — 打印出来也能扫码导航',
      '核实过的营业时间、评分和地址，以及每个景点的人少时段',
      '每天都有室内雨天备选方案',
      '预订时间线和行李清单（包括teamLab的着装规则）',
    ],
    free: '网站上的行程一如既往免费。这份PDF是为想离线随身携带的旅行者准备的。',
    cta: `获取东京指南 — ${PRICE}`,
    ps: 'P.S. 直接回复告诉我下一个想要哪座城市 — 每条回复我都会看。',
    sign: '— Pixer, Wander Atlas',
    prefs: '偏好设置', unsubscribe: '退订',
  },
};

function render(lang) {
  const c = COPY[lang];
  const featureRows = c.features.map((f) => `
      <tr><td style="padding:0 0 10px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td valign="top" style="font-family:Helvetica,Arial,sans-serif;color:${P.gold};font-size:14px;font-weight:700;padding-right:10px;">✓</td>
          <td style="font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:${P.soft};">${esc(f)}</td>
        </tr></table>
      </td></tr>`).join('');

  const html = `<!DOCTYPE html><html lang="${esc(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.subject)}</title></head>
<body style="margin:0;background:#e7e0d4;font-family:Georgia,'Times New Roman',serif;color:${P.ink};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(c.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e7e0d4;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:${P.paper};border-radius:4px;overflow:hidden;">
  <tr><td style="background:${P.ink};text-align:center;padding:15px;">
    <div style="font-family:Helvetica,Arial,sans-serif;letter-spacing:.28em;text-transform:uppercase;font-size:12px;font-weight:700;color:#e9dfce;">Wander Atlas</div>
    <div style="font-family:Helvetica,Arial,sans-serif;letter-spacing:.16em;text-transform:uppercase;font-size:8px;color:${P.gold};margin-top:5px;">${esc(c.kicker)}</div>
  </td></tr>
  <tr><td><a href="${esc(PRODUCT_URL)}" style="text-decoration:none;"><img src="${esc(HERO)}" width="600" alt="Tokyo — The 3-Day Field Guide" style="width:100%;height:auto;display:block;" /></a></td></tr>
  <tr><td style="padding:26px 40px 4px;">
    <h1 style="margin:0;font-size:30px;font-weight:400;line-height:1.15;color:${P.ink};">${esc(c.title)}</h1>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:${P.soft};font-style:italic;margin:14px 0 0;">${esc(c.intro)}</p>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.7;color:${P.soft};margin:14px 0 0;">${esc(c.body)}</p>
  </td></tr>
  <tr><td style="padding:22px 40px 0;">
    <div style="font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:${P.gold};font-weight:700;padding-bottom:12px;">${esc(c.featuresLabel)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${featureRows}</table>
  </td></tr>
  <tr><td style="padding:14px 40px 0;">
    <div style="background:${P.tint};border-radius:6px;padding:14px 18px;font-family:Helvetica,Arial,sans-serif;font-size:12.5px;line-height:1.6;color:${P.soft};">${esc(c.free)}</div>
  </td></tr>
  <tr><td style="text-align:center;padding:30px 40px 8px;">
    <a href="${esc(PRODUCT_URL)}" style="font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;letter-spacing:.03em;text-decoration:none;color:#ffffff;background:${P.accd};border-radius:8px;padding:15px 34px;display:inline-block;">${esc(c.cta)}</a>
  </td></tr>
  <tr><td style="padding:18px 40px 30px;">
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:12.5px;line-height:1.6;color:#7a736a;margin:0;">${esc(c.ps)}</p>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:12.5px;color:${P.soft};margin:10px 0 0;">${esc(c.sign)}</p>
  </td></tr>
  <tr><td style="background:${P.ink};color:#a79e8f;font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:1.8;text-align:center;padding:26px 40px;">
    <a href="${esc(`${SITE}/preferences`)}" style="color:#d6ab5c;text-decoration:none;">${esc(c.prefs)}</a> ·
    <a href="${esc(`${SITE}/unsubscribe`)}" style="color:#d6ab5c;text-decoration:none;">${esc(c.unsubscribe)}</a>
    <div style="color:#6a635a;font-size:10px;margin-top:12px;">Wander Atlas · wanderatlasguides.com</div>
  </td></tr>
</table>
</td></tr></table></body></html>`;
  return { subject: c.subject, html };
}

mkdirSync(OUT_DIR, { recursive: true });

if (RENDER_ONLY) {
  for (const lang of Object.keys(COPY)) {
    const { html } = render(lang);
    writeFileSync(`${OUT_DIR}announce_${lang}.html`, html);
  }
  console.log(`render-only: wrote ${Object.keys(COPY).length} previews to .newsletter-preview/`);
  process.exit(0);
}

if (!MAILERLITE_API_TOKEN) { console.error('MAILERLITE_API_TOKEN missing'); process.exit(1); }
if (LIVE && !NEWSLETTER_FROM_EMAIL) { console.error('NEWSLETTER_FROM_EMAIL required for --live'); process.exit(1); }

const ml = mailerlite(MAILERLITE_API_TOKEN);
const subscribers = await ml.listActiveSubscribers();
const LANGS = new Set(Object.keys(COPY));
const byLang = new Map();
for (const s of subscribers) {
  const lang = LANGS.has(s.fields?.lang) ? s.fields.lang : 'en';
  if (!byLang.has(lang)) byLang.set(lang, []);
  byLang.get(lang).push(s.id);
}
console.log(`${LIVE ? 'LIVE' : 'DRY-RUN'} · ${subscribers.length} subscribers · langs: ${[...byLang.entries()].map(([l, ids]) => `${l}:${ids.length}`).join(' ')}\n`);

for (const [lang, ids] of byLang) {
  const { subject, html } = render(lang);
  if (!LIVE) {
    writeFileSync(`${OUT_DIR}announce_${lang}.html`, html);
    console.log(`  [${lang}] would send "${subject}" to ${ids.length} subs → preview written`);
    continue;
  }
  try {
    const group = await ml.ensureGroup(`auto:${CAMPAIGN_TAG}:${lang}`);
    for (const id of ids) await ml.setSubscriberGroup(id, group.id);
    const camp = await ml.createCampaign({
      name: `WA ${CAMPAIGN_TAG} ${lang}`,
      subject, fromName: NEWSLETTER_FROM_NAME, from: NEWSLETTER_FROM_EMAIL,
      html, groupId: group.id,
    });
    await ml.sendCampaign(camp.id);
    console.log(`  [${lang}] SENT "${subject}" to ${ids.length} subs`);
  } catch (e) {
    console.error(`  [${lang}] SEND FAILED: ${e.message}`);
  }
}
console.log('\ndone.');
