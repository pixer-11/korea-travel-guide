// One-off/idempotent: convert every post's national-format phone to the
// international +country-code form, WITHOUT any API calls. The fact box's tel:
// link dials exactly this field, and the site's core reader taps it from a
// foreign SIM — "054-853-0109" fails abroad, "+82 54-853-0109" connects.
// (places.mjs now prefers Google's internationalPhoneNumber for new posts;
// this converts the 236-post backlog. Place Details is capped at ~100/day, so
// deriving locally — country + trunk-prefix rule — beats a 3-day refetch.)
//
// Per-country rules, verified against the numbers actually in the catalogue:
// the trunk '0' is dropped everywhere it is a dialing prefix, and KEPT for
// Italy, where the leading 0 is part of the subscriber number. A country with
// no rule here is skipped and reported — never guessed.
//
//   node scripts/repair-phone-international.mjs           # dry-run
//   node scripts/repair-phone-international.mjs --apply   # write changes
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const DIR = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const APPLY = process.argv.includes('--apply');

// code = E.164 country code; trunkZero = a leading 0 is a domestic dialing
// prefix and must be dropped after +code (false: the 0 is part of the number,
// or the plan has no trunk prefix at all).
const RULES = {
  'South Korea': { code: 82, trunkZero: true },
  Japan: { code: 81, trunkZero: true },
  China: { code: 86, trunkZero: true },
  Taiwan: { code: 886, trunkZero: true },
  Thailand: { code: 66, trunkZero: true },
  Vietnam: { code: 84, trunkZero: true },
  Indonesia: { code: 62, trunkZero: true },
  Malaysia: { code: 60, trunkZero: true },
  Singapore: { code: 65, trunkZero: false },
  Philippines: { code: 63, trunkZero: true },
  India: { code: 91, trunkZero: true },
  'United Arab Emirates': { code: 971, trunkZero: true },
  Turkey: { code: 90, trunkZero: true },
  Italy: { code: 39, trunkZero: false }, // leading 0 is part of the number
  France: { code: 33, trunkZero: true },
  Spain: { code: 34, trunkZero: false },
  'United States': { code: 1, trunkZero: false },
};

/** "054-853-0109" + South Korea → "+82 54-853-0109"; null = leave untouched. */
export function toInternational(phone, country) {
  const rule = RULES[country];
  if (!rule) return { skip: `no rule for country "${country}"` };
  let s = String(phone).trim();
  if (s.startsWith('+')) return null; // already international
  // Extension survives verbatim ("03 822 7121#147").
  const hash = s.indexOf('#');
  const ext = hash === -1 ? '' : s.slice(hash);
  s = (hash === -1 ? s : s.slice(0, hash)).trim();
  if (/[^\d\s().-]/.test(s)) return { skip: `unexpected characters in "${phone}"` };
  s = s.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (rule.trunkZero && /^0\d/.test(s)) s = s.slice(1).replace(/^[\s.-]+/, '');
  const digits = (String(rule.code) + s).replace(/\D/g, '');
  // E.164 is 8–15 digits; outside that the source value is suspect, not fixable.
  if (digits.length < 8 || digits.length > 15) return { skip: `${digits.length} digits after +${rule.code} — out of E.164 range` };
  return { value: `+${rule.code} ${s}${ext}` };
}

if (process.argv[1] && process.argv[1].endsWith('repair-phone-international.mjs')) {
  const files = (await readdir(DIR)).filter((f) => f.endsWith('.md'));
  let converted = 0, already = 0, noPhone = 0, skipped = 0;

  for (const f of files) {
    const p = join(DIR, f);
    const raw = await readFile(p, 'utf8');
    let fm;
    try { fm = yaml.load(raw.slice(4, raw.indexOf('\n---', 3))); } catch { continue; }
    const phone = fm?.place?.phone;
    if (!phone) { noPhone++; continue; }
    const res = toInternational(phone, fm.country || '');
    if (res === null) { already++; continue; }
    if (res.skip) { skipped++; console.log(`  ⚠ ${f}: ${res.skip}`); continue; }
    converted++;
    console.log(`  ✓ ${f}: "${phone}" → "${res.value}"`);
    if (APPLY) {
      const line = new RegExp(String.raw`^([ ]{2})phone:[ \t]*[^\r\n]*`, 'm');
      const out = raw.replace(line, `  phone: '${res.value.replace(/'/g, "''")}'`);
      if (out !== raw) await writeFile(p, out, 'utf8');
      else { console.log(`  ⚠ ${f}: phone line not found in raw text — NOT written`); converted--; skipped++; }
    }
  }

  console.log(
    `\n${converted} converted, ${already} already international, ${skipped} skipped (need review), ` +
    `${noPhone} without a phone (${APPLY ? 'APPLIED' : 'dry-run'}).`
  );
}
