// Ensures the custom fields the signup form posts (region, lang, signup_source)
// exist in MailerLite. Idempotent — creates only missing keys. Run once (and safe
// to re-run). Requires MAILERLITE_API_TOKEN in env.
import { mailerlite } from './lib/mailerlite.mjs';

const token = process.env.MAILERLITE_API_TOKEN;
if (!token) { console.error('MAILERLITE_API_TOKEN missing'); process.exit(1); }

const WANT = ['region', 'lang', 'signup_source'];
const ml = mailerlite(token);

const existing = await ml.listFields();
const haveKeys = new Set(existing.map((f) => f.key));
for (const name of WANT) {
  if (haveKeys.has(name)) { console.log(`✓ field "${name}" already exists`); continue; }
  const f = await ml.createField(name);
  console.log(`＋ created field "${name}" (key: ${f.key})`);
  if (f.key !== name) console.warn(`⚠ key "${f.key}" != "${name}" — signup form posts fields[${name}]; verify mapping`);
}
console.log('Field setup complete.');
