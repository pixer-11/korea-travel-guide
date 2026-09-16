// A `closed` hold had no way back out.
//
// The gate quarantines a post whose venue Google reports as anything but
// OPERATIONAL, and writes `heldReason: closed`. Nothing ever read that field
// again for a DRAFT, so the repair patrol answered "closed 사유는 초안을
// 재검사할 도구가 없음" every night — the same "no way back out" that
// repair-held-posts.mjs was written to end, reopened for one more reason.
//
// The refreshed truth is already on disk: refresh.mjs re-reads businessStatus
// for every post carrying a place.id, drafts included, on its 12-week rotation
// (its auto-unpublish is the part that skips drafts, not its reading). This
// audit turns that stored field into a verdict the patrol can act on, and it
// spends no quota doing it — it reads what refresh already paid for.
//
// Published posts are scanned too, deliberately: refresh unpublishes a venue
// the moment it stops being OPERATIONAL, so a finding among them means that
// path failed and a closed venue is being recommended on the live site.
//
//   node scripts/audit-closed-venues.mjs            (published only)
//   node scripts/audit-closed-venues.mjs --drafts   (used by repair-held-posts.mjs)
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { requireExamined } from './lib/examined.mjs';

const DIR = 'src/content/posts';
const includeDrafts = process.argv.includes('--drafts');
const NL = String.fromCharCode(10);

// Deliberately not a YAML parse: this runs inside the repair patrol, which
// must not fail because some other post's frontmatter is momentarily unreadable.
// `businessStatus` is nested under `place`, so the key is matched on the
// trimmed line — which is exactly the nesting we want to read.
const field = (head, key) => {
  for (const line of head.split(NL)) {
    const t = line.trim();
    if (t.startsWith(key + ':')) return t.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return '';
};

// Exterior-only heritage landmarks: Google's status describes a BUSINESS, and
// some of these addresses have no business to describe. 37 Kerbau Road is the
// last Chinese villa in Little India — a painted facade you photograph from the
// street, never enter — and Google files it CLOSED_TEMPORARILY because the
// shophouse tenant behind the facade is between occupants. The building is
// there, the street is public, and the visit is unchanged; holding the guide
// tells a reader a landmark has shut when it has not (2026-09-16).
//
// Keyed by place.id, never by slug, so a place record swapped underneath us
// falls back out of the exemption. Each entry needs a dated reason: this list
// is the one way a non-OPERATIONAL venue reaches readers, so it stays short and
// covers only places whose VISIT does not depend on a business being open.
const ALWAYS_VISITABLE = new Map([
  ['ChIJX0z5sbgZ2jERbP7t9-0hs_E', '2026-09-16: Former House of Tan Teng Niah — exterior-only heritage facade on a public street; Google tracks the tenancy behind it'],
]);

const files = readdirSync(DIR).filter((f) => f.endsWith('.md'));
const found = [];
for (const f of files) {
  const raw = readFileSync(join(DIR, f), 'utf8');
  const end = raw.indexOf(NL + '---', 3);
  if (end < 0) continue;
  const head = raw.slice(0, end);
  const isDraft = field(head, 'draft') === 'true';
  if (isDraft && !includeDrafts) continue;
  const status = field(head, 'businessStatus');
  if (!status || status === 'OPERATIONAL') continue;
  if (ALWAYS_VISITABLE.has(field(head, 'id'))) continue;
  found.push({ f, status, isDraft });
}

for (const i of found) {
  console.log(`NON-OPERATIONAL-VENUE: ${i.f} — ${i.status}${i.isDraft ? ' (격리된 초안)' : ' (라이브)'}`);
}
requireExamined(files.length, '글', 'src/content/posts 가 비어 있나?');
console.log(found.length
  ? `${NL}❌ ${found.length} post(s) whose stored businessStatus is not OPERATIONAL.`
  : `${NL}✓ ${files.length} post(s) — every stored businessStatus reads OPERATIONAL.`);
process.exit(found.length ? 1 : 0);
