// ─────────────────────────────────────────────────────────────
//  data/visual-audit.json — ONE way to write it.
//
//  The file is the photo pipeline's memory: every vision and identity verdict,
//  keyed "slug\x01heroUrl". Since 2026-09-23 it is also what re-derives a
//  quarantine after a remote-first rebase drops one (requarantine-mismatches,
//  run after the push). If rows can vanish, that safety net has holes.
//
//  2026-09-24: twelve scripts wrote it, seven with a one-space indent and five
//  with two, some with a trailing newline and some without. Whichever ran last
//  rewrote all ~20,600 lines (the 09-23 night flipped it from two spaces to
//  one). Worse, every writer appended new rows at the END, so any two bots that
//  added verdicts on the same night both edited the file's tail — and
//  git-push-retry settles bot-vs-bot conflicts remote-first (-X ours, on
//  purpose), so the later pusher's verdicts were the ones dropped.
//
//  One serializer fixes both: a fixed format (one-space indent, the majority
//  and what HEAD had, "\n", trailing newline) so a write changes only the rows
//  it changed; and top-level keys SORTED, so a new verdict lands in its own
//  place in the alphabet and two bots adding different slugs touch different
//  hunks. Nothing reads this file by position — identityRejection scans for a
//  match and the prune only filters — so the order is free to choose.
//
//  audit-visual-store.test.mjs holds the committed file to this format, so a
//  writer that bypasses it turns the Tests workflow red instead of quietly
//  reshuffling the file.
// ─────────────────────────────────────────────────────────────
import { writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const VISUAL_AUDIT_PATH = fileURLToPath(new URL('../../data/visual-audit.json', import.meta.url));

/** The one canonical text for a verdict store. Row contents are left exactly as given. */
export function serializeAuditStore(store) {
  const sorted = {};
  for (const key of Object.keys(store ?? {}).sort()) sorted[key] = store[key];
  return JSON.stringify(sorted, null, 1) + '\n';
}

export async function writeAuditStore(store, path = VISUAL_AUDIT_PATH) {
  await writeFile(path, serializeAuditStore(store), 'utf8');
}

export function writeAuditStoreSync(store, path = VISUAL_AUDIT_PATH) {
  writeFileSync(path, serializeAuditStore(store), 'utf8');
}
