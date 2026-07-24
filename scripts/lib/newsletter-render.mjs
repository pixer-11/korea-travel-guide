import { copyFor, fill } from './newsletter-copy.mjs';

const P = { paper: '#f7f3ec', tint: '#f1ebe0', ink: '#201c17', soft: '#4a443c', acc: '#c8443a', accd: '#a5352c', gold: '#b8862f' };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const img = (i) => (i && i.url ? esc(i.url) : '');

function storyCard(s, c, links) {
  return `
  <tr><td style="padding:16px 40px;">
    <img src="${img(s.image)}" width="520" alt="${esc(s.title)}" style="width:100%;max-width:520px;height:auto;border-radius:6px;display:block;" />
    <div style="font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:${P.acc};font-weight:700;margin-top:14px;">${esc(s.category)}</div>
    <h3 style="margin:6px 0 0;font-size:22px;font-weight:400;line-height:1.2;color:${P.ink};">${esc(s.title)}</h3>
    ${s.dek ? `<p style="font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#4a443c;margin:9px 0 0;">${esc(s.dek)}</p>` : ''}
    <a href="${esc(links.story(s.slug))}" style="font-family:Helvetica,Arial,sans-serif;display:inline-block;margin-top:12px;font-size:12px;font-weight:700;color:${P.accd};text-decoration:none;border-bottom:1px solid #d8b6b2;padding-bottom:2px;">${esc(c.read)}</a>
  </td></tr>
  <tr><td style="padding:0 40px;"><div style="height:1px;background:${P.gold};opacity:.5;"></div></td></tr>`;
}

function eventsBlock(events, c, links) {
  if (!events.length) return '';
  const rows = events.map((e) => {
    const d = new Date(e.date);
    const when = isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `<a href="${esc(links.event(e.slug))}" style="display:block;font-size:16px;color:${P.ink};text-decoration:none;margin-top:12px;border-bottom:1px solid #e0d8c8;padding-bottom:10px;">${esc(e.title)} <span style="color:${P.gold};float:right;">${esc(when)} →</span></a>`;
  }).join('');
  return `
  <tr><td style="background:${P.tint};padding:22px 40px;">
    <div style="font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#7a736a;font-weight:700;">${esc(c.eventsLabel)}</div>
    ${rows}
  </td></tr>`;
}

export function renderSingleRegion({ edition, region, lang, links }) {
  const c = copyFor(lang);
  const v = { region, country: edition.country };
  const subject = fill(c.subjectSingle, v);
  const preheader = fill(c.preheaderSingle, v);
  const cards = [edition.hero, ...edition.stories].map((s) => storyCard(s, c, links)).join('');

  const html = `<!DOCTYPE html><html lang="${esc(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#e7e0d4;font-family:Georgia,'Times New Roman',serif;color:${P.ink};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e7e0d4;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:${P.paper};border-radius:4px;overflow:hidden;">
  <tr><td style="background:${P.ink};text-align:center;padding:15px;">
    <div style="font-family:Helvetica,Arial,sans-serif;letter-spacing:.28em;text-transform:uppercase;font-size:12px;font-weight:700;color:#e9dfce;">Wander Atlas</div>
    <div style="font-family:Helvetica,Arial,sans-serif;letter-spacing:.16em;text-transform:uppercase;font-size:8px;color:${P.gold};margin-top:5px;">${esc(c.weeklyEdit)} · ${esc(region)}</div>
  </td></tr>
  <tr><td><img src="${img(edition.hero.image)}" width="600" alt="${esc(region)}" style="width:100%;height:auto;display:block;" /></td></tr>
  <tr><td style="padding:26px 40px 4px;">
    <h1 style="margin:0;font-size:32px;font-weight:400;line-height:1.1;color:${P.ink};">${esc(fill(c.subjectSingle, v))}</h1>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:${P.soft};font-style:italic;margin:14px 0 0;">${esc(fill(c.editorNote, v))}</p>
  </td></tr>
  <tr><td style="font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:${P.gold};font-weight:700;padding:24px 40px 0;">${esc(c.sectionLabel)}</td></tr>
  ${cards}
  ${eventsBlock(edition.events, c, links)}
  <tr><td style="text-align:center;padding:34px 40px;"><a href="${esc(links.cta)}" style="font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;letter-spacing:.04em;text-decoration:none;color:${P.accd};border:1.5px solid ${P.accd};border-radius:8px;padding:14px 30px;display:inline-block;">${esc(fill(c.ctaSingle, v))}</a></td></tr>
  <tr><td style="background:${P.ink};color:#a79e8f;font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:1.8;text-align:center;padding:26px 40px;">
    <a href="${esc(links.prefs)}" style="color:#d6ab5c;text-decoration:none;">${esc(c.regionChange)}</a> ·
    <a href="${esc(links.prefs)}" style="color:#d6ab5c;text-decoration:none;">${esc(c.langLabel)}</a> ·
    <a href="${esc(links.unsubscribe)}" style="color:#d6ab5c;text-decoration:none;">${esc(c.unsubscribe)}</a>
    <div style="color:#6a635a;font-size:10px;margin-top:12px;">Wander Atlas · wanderatlasguides.com</div>
  </td></tr>
</table>
</td></tr></table></body></html>`;

  return { subject, preheader, html };
}
