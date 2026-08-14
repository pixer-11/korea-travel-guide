// One-off/idempotent: add reservation `phone` + `openingHours` to EXISTING venue
// posts that predate those fields. New posts get them inline from generate.mjs;
// this backfills the rest with ONE Details call per post (real Google Places
// data — never invented). Posts without a place.id, or already carrying phone
// AND hours, are skipped. Leaves prose untouched.
//
//   node scripts/backfill-place-details.mjs                 # dry-run (still calls the API to preview)
//   node scripts/backfill-place-details.mjs --apply         # write changes
//   node scripts/backfill-place-details.mjs --limit 10      # cap posts processed (quota-safe trial)
//   node scripts/backfill-place-details.mjs --slugs=a,b,c   # only these post ids (filename minus .md),
//                                                            # in the given order, ignoring alphabetical
//                                                            # scan order; --limit still applies after
//                                                            # this filter. Everything else unchanged.
//
// When --slugs is NOT given, candidates used as a stop or rain-swap by any
// src/content/itineraries/*.md are processed first (alphabetical within that
// group), then everything else alphabetically — those venues power the
// itinerary pages' closed-day warning chips, so they matter more than an
// arbitrary A-Z sweep reaching them eventually. Only the ORDER changes: skip
// rules, --limit, and the quota-streak stop are untouched.
import './lib/env.mjs'; // MUST be first — loads .env before places.mjs reads the API key
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { fetchPlaceReviewSignals } from './lib/places.mjs';
import { clampBusynessInRaw } from './lib/busyness-clamp.mjs';

const DIR = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const ITINERARIES_DIR = fileURLToPath(new URL('../src/content/itineraries/', import.meta.url));
const APPLY = process.argv.includes('--apply');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i !== -1 ? Number(process.argv[i + 1]) : Infinity;
})();
// Draw from the shared daily Places ledger rather than trusting --limit
// alone. The workflow passes 80 while the whole day's Details cap is 100, and
// with publish + quality + refresh also drawing, the four together were asking
// for 111+ (found 2026-08-05). The declared limit still applies — this only ever
// lowers it.
const { claim: claimPlaces, record: recordPlaces, describe: describePlaces } = await import('./lib/places-budget.mjs');
const placesBudget = await claimPlaces('backfill');
const EFFECTIVE_LIMIT = Math.min(LIMIT, placesBudget.allowance);
console.log(describePlaces('backfill', placesBudget));

const SLUGS = (() => {
  const arg = process.argv.find((a) => a.startsWith('--slugs='));
  if (!arg) return null;
  return arg
    .slice('--slugs='.length)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
})();

// YAML single-quote a scalar (only ' needs escaping, as '').
const yq = (s) => `'${String(s).replace(/'/g, "''")}'`;

// Pure ordering helper (unit-tested): moves any file whose slug is in
// prioritySet to the front (sorted alphabetically within that group),
// leaving everyone else in their existing relative order. An empty/missing
// prioritySet is a no-op — the input order comes back untouched.
export function orderCandidates(files, prioritySet) {
  if (!prioritySet || prioritySet.size === 0) return files;
  const isPriority = (f) => prioritySet.has(f.replace(/\.md$/, ''));
  const priority = files.filter(isPriority).sort((a, b) => a.localeCompare(b));
  const rest = files.filter((f) => !isPriority(f));
  return [...priority, ...rest];
}

// Every slug used as a stop or rain-swap across the live itineraries. Never
// throws — a missing/empty directory or a malformed itinerary file just
// yields fewer (or zero) priority slugs, which makes orderCandidates a no-op
// and the script behaves exactly as it did before this feature existed.
async function loadItineraryPrioritySlugs() {
  const slugs = new Set();
  let files;
  try {
    files = (await readdir(ITINERARIES_DIR)).filter((f) => f.endsWith('.md'));
  } catch {
    return slugs;
  }
  for (const f of files) {
    try {
      const raw = await readFile(join(ITINERARIES_DIR, f), 'utf8');
      const end = raw.indexOf('\n---', 3);
      if (end === -1) continue;
      const fm = yaml.load(raw.slice(4, end));
      for (const day of fm?.itinerary ?? []) {
        for (const stop of day?.stops ?? []) {
          if (stop?.slug) slugs.add(stop.slug);
        }
        if (day?.rainSwapSlug) slugs.add(day.rainSwapSlug);
      }
    } catch {
      // malformed itinerary frontmatter — skip it, never throw
    }
  }
  return slugs;
}

async function main() {
  let files = (await readdir(DIR)).filter((f) => f.endsWith('.md'));
  if (SLUGS) {
    // Precision mode: resolve exactly the requested post ids, in the order given,
    // regardless of where they'd otherwise fall in the alphabetical scan — so
    // --limit (applied below, after this filter) can't cut them off.
    const bySlug = new Map(files.map((f) => [f.replace(/\.md$/, ''), f]));
    const missing = SLUGS.filter((s) => !bySlug.has(s));
    if (missing.length) console.log(`  ⚠ --slugs: no post file for: ${missing.join(', ')}`);
    files = SLUGS.map((s) => bySlug.get(s)).filter(Boolean);
  } else {
    const prioritySlugs = await loadItineraryPrioritySlugs();
    files = orderCandidates(files, prioritySlugs);
    const priorityCount = files.filter((f) => prioritySlugs.has(f.replace(/\.md$/, ''))).length;
    if (priorityCount) console.log(`Priority: ${priorityCount} itinerary stop(s) queued first`);
  }
  let updated = 0, skipNoPlace = 0, already = 0, noData = 0, processed = 0, quotaHits = 0, apiErrors = 0, closed = 0;
  // Fills on posts older than 48h are BACKLOG work; fills on fresh posts are
  // routine top-up. The owner spotted the deadlock (2026-08-02): daily
  // publishing feeds a trickle of fillable venues forever, so a streak counted
  // on TOTAL fills would postpone the country-fill handover indefinitely —
  // the handover question is "is the old debt paid?", not "did anything new
  // arrive yesterday?". fill-phase counts its streak on this number instead.
  let updatedBacklog = 0;
  const BACKLOG_AGE_MS = 48 * 3600 * 1000;
  // Places Details returns null on 429 (places.mjs logs it and does NOT throw), which
  // used to land in the noData bucket — so an exhausted-quota run reported "117 no new
  // data" as if those venues simply had no phone listed, and kept firing doomed calls
  // for the rest of the list. Count it separately and give up after a short streak.
  //
  // It also used to return that same bare null for a 403/404/500, so EVERY failure was
  // filed under "quota-429" — a key that lacks Places API access reads exactly like an
  // exhausted day, and the fix for one is nothing like the fix for the other. Pass
  // reportFailure so the two are counted, logged, and reported apart; only a genuine
  // 429 is worth retrying tomorrow, which is what the workflow's retire step keys off.
  const QUOTA_STREAK_STOP = 5;
  let failStreak = 0, lastFailure = null;

  for (const f of files) {
    if (processed >= EFFECTIVE_LIMIT) break;
    const p = join(DIR, f);
    const t = await readFile(p, 'utf8');

    // Isolate the `place:` frontmatter block (top-level key + its 2-space children).
    // CRLF-safe: many posts use \r\n, which a bare \n pattern would miss.
    const block = t.match(/^place:\r?\n((?:[ ]{2}.*\r?\n)+)/m);
    if (!block) { skipNoPlace++; continue; }
    const placeBody = block[1];

    const id = placeBody.match(/^[ ]{2}id:[ \t]*(.+)/m)?.[1]?.replace(/[\r\n]+$/, '').trim();
    if (!id) { skipNoPlace++; continue; }

    const hasPhone = /^[ ]{2}phone:/m.test(placeBody);
    // hoursOmitted counts as having hours: it marks a post whose hours are
    // absent ON PURPOSE — Google filed a different entity's schedule under the
    // attraction (Bromo, 2026-08-14: the park office's weekday desk hours on a
    // pre-dawn sunrise site; the gate held the post and the hours fixer could
    // only make the prose more wrong). Both the skip rule and the inject below
    // read this flag, so neither can resurrect the wrong schedule.
    const hasHours = /^[ ]{2}openingHours:/m.test(placeBody)
      || /^[ ]{2}hoursOmitted:/m.test(placeBody);
    if (hasPhone && hasHours) { already++; continue; }

    processed++;
    let raw;
    try {
      raw = await fetchPlaceReviewSignals(id.replace(/^['"]|['"]$/g, ''), { reportFailure: true });
    } catch (e) {
      console.log(`  ⚠ ${f}: ${e.message}`);
      continue;
    }
    // `failure` set = the Details call itself failed; null = no API key configured.
    // Anything else is a real answer from Google.
    if (raw === null || raw.failure != null) {
      const kind = raw === null ? 'no-api-key' : raw.failure;
      if (kind === 429) quotaHits++; else apiErrors++;
      lastFailure = kind;
      if (++failStreak >= QUOTA_STREAK_STOP) {
        console.log(
          kind === 429
            ? `\n⛔ Places Details quota exhausted (${failStreak} consecutive 429s) — stopping early.`
            : `\n⛔ Places Details failing with ${kind} (${failStreak} in a row) — stopping early. ` +
              `Not reported as a quota hit; check the key has Places API (New) enabled with no ` +
              `referrer/IP restriction. Note a drained project also returns 403 intermittently ` +
              `alongside its 429s, so check the day's quota before assuming a key problem.`
        );
        break;
      }
      continue;
    }
    failStreak = 0;

    // A venue Google says is closed must never get phone/hours written onto it —
    // quarantine it (draft: true, same pattern as the photo quarantine) so the
    // site stops recommending it. This fires ONLY on a real API answer; every
    // failure path (429/403/network) exited above, so a transient error can
    // never unpublish anything. The weekly refresh job does the same for posts
    // that already have both fields and therefore never reach this loop.
    if (raw.businessStatus && raw.businessStatus !== 'OPERATIONAL') {
      closed++;
      console.log(`  🚫 ${f}: ${raw.businessStatus} — quarantined (draft), not backfilled`);
      if (APPLY && !/^draft:\s*true/m.test(t)) {
        const out = /^draft:\s*/m.test(t)
          ? t.replace(/^draft:\s*\S+[ \t]*$/m, 'draft: true')
          : t.replace(/^---\r?\n/, `---\ndraft: true\n`);
        if (out !== t) await writeFile(p, out, 'utf8');
      }
      continue;
    }

    const phone = raw?.phone;
    const hours = raw?.openingHours;
    if ((!phone || hasPhone) && (!hours?.length || hasHours)) {
      noData++;
      console.log(`  – ${f}: nothing new`);
      continue;
    }

    // Build the lines to append inside the place block (only what's missing).
    let inject = '';
    if (phone && !hasPhone) inject += `  phone: ${yq(phone)}\n`;
    if (hours?.length && !hasHours) {
      inject += `  openingHours:\n` + hours.map((h) => `    - ${yq(h)}`).join('\n') + '\n';
    }
    if (!inject) { noData++; continue; }

    updated++;
    const pub = t.match(/^pubDate:\s*['"]?([0-9T:.Z+-]+)/m)?.[1];
    const isBacklog = !pub || (Date.now() - Date.parse(pub)) > BACKLOG_AGE_MS;
    if (isBacklog) updatedBacklog++;
    console.log(`  ✓ ${f}${phone && !hasPhone ? ' +phone' : ''}${hours?.length && !hasHours ? ` +${hours.length}h hours` : ''}${isBacklog ? '' : ' (new post top-up)'}`);

    if (APPLY) {
      // Append the new lines to the END of the place block (before the next top-level key).
      const nl = placeBody.includes('\r\n') ? '\r\n' : '\n';
      const newBlock = `place:${nl}${placeBody}${inject.replace(/\n/g, nl)}`;
      let out = t.replace(/^place:\r?\n(?:[ ]{2}.*\r?\n)+/m, newBlock);
      // A post can carry busyness from DAYS before its hours arrive here — the
      // moment both exist, any quiet/busy hour outside the doors must go, or the
      // page advertises a visit window when the venue is shut.
      const clamp = clampBusynessInRaw(out);
      if (clamp.changed) {
        out = clamp.raw;
        console.log(`    ⏰ busyness clamped to the new hours: ${clamp.notes.join('; ')}`);
      }
      if (out !== t) await writeFile(p, out, 'utf8');
    }
  }

  // Report the spend so the next job in the chain divides what is actually
  // left, rather than what it hopes is left.
  await recordPlaces('backfill', processed);

  console.log(
    // NOTE: 'updated N' must stay FIRST on this line — the workflow greps the
    // first 'updated <num>' occurrence; 'backlog-updated' is appended after.
    `\nBACKFILL RESULT: updated ${updated}, backlog-updated ${updatedBacklog}, already-complete ${already}, no-new-data ${noData}, ` +
    `no-place ${skipNoPlace}, closed-quarantined ${closed}, quota-429 ${quotaHits}, api-error ${apiErrors}` +
    (apiErrors ? ` (last: ${lastFailure})` : '') +
    `, processed ${processed} of ${files.length} (${APPLY ? 'APPLIED' : 'dry-run'}).`
  );
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  await main();
}
