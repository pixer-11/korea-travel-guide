// Weekly private backup: active subscribers → CSV → Telegram document (owner chat
// only). Never writes the CSV to the repo. Requires MAILERLITE_API_TOKEN,
// TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID.
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mailerlite } from './lib/mailerlite.mjs';
import { sendTelegramForm } from './lib/telegram.mjs';

const { MAILERLITE_API_TOKEN } = process.env;
if (!MAILERLITE_API_TOKEN) { console.error('MAILERLITE_API_TOKEN missing'); process.exit(0); }

const ml = mailerlite(MAILERLITE_API_TOKEN);
const subs = await ml.listActiveSubscribers();
const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
const rows = [['email', 'region', 'lang'].join(',')];
for (const s of subs) rows.push([esc(s.email), esc(s.fields.region || ''), esc(s.fields.lang || '')].join(','));
const csv = rows.join('\n');
const day = new Date().toISOString().slice(0, 10);
const path = join(tmpdir(), `wander-atlas-subscribers-${day}.csv`);
writeFileSync(path, csv);

// A backup Telegram refused is a backup that does not exist. It used to print
// "Backup send failed" under a green tick; now it throws.
const sent = await sendTelegramForm('sendDocument', (form) => {
  form.append('caption', `🗂️ 구독자 백업 (${day}) — ${subs.length}명`);
  form.append('document', new Blob([csv], { type: 'text/csv' }), `wander-atlas-subscribers-${day}.csv`);
});
console.log(sent ? `Backup sent (${subs.length} subscribers).` : 'Telegram secrets missing — CSV written locally only.');
