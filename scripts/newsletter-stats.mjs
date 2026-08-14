// Subscriber-list X-ray: counts by status and language, and lists unconfirmed
// signups (the double-opt-in leak the 2026-08-14 growth research flagged —
// people who filled the form but never clicked the confirmation email).
// Read-only; prints no full addresses (masked local part) so logs stay clean.
//
//   node scripts/newsletter-stats.mjs
const { MAILERLITE_API_TOKEN } = process.env;
if (!MAILERLITE_API_TOKEN) { console.error('MAILERLITE_API_TOKEN missing'); process.exit(1); }

const BASE = 'https://connect.mailerlite.com/api';
const mask = (email) => {
  const [local, domain] = String(email).split('@');
  return `${local.slice(0, 2)}***@${domain}`;
};

async function listByStatus(status) {
  const out = [];
  let cursor = null;
  do {
    const qs = `limit=100&filter[status]=${status}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await fetch(`${BASE}/subscribers?${qs}`, {
      headers: { Authorization: `Bearer ${MAILERLITE_API_TOKEN}`, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`${status} → ${res.status}`);
    const page = await res.json();
    for (const s of page.data || []) {
      out.push({ email: s.email, lang: s.fields?.lang || '?', source: s.fields?.signup_source || '?', created: (s.created_at || '').slice(0, 10) });
    }
    cursor = page.meta?.next_cursor ?? null;
  } while (cursor);
  return out;
}

const statuses = ['active', 'unconfirmed', 'unsubscribed', 'bounced', 'junk'];
for (const status of statuses) {
  const subs = await listByStatus(status).catch((e) => { console.error(e.message); return []; });
  const byLang = {};
  for (const s of subs) byLang[s.lang] = (byLang[s.lang] || 0) + 1;
  console.log(`\n${status.toUpperCase()}: ${subs.length}  ${Object.entries(byLang).map(([l, n]) => `${l}:${n}`).join(' ')}`);
  // Unconfirmed is the leak we're diagnosing — show each one so we can see
  // WHERE they signed up (source) and in which language the confirmation
  // email failed them.
  if (status === 'unconfirmed') {
    for (const s of subs) console.log(`  ${s.created}  ${mask(s.email)}  lang=${s.lang}  source=${s.source}`);
  }
}
console.log('\ndone.');
