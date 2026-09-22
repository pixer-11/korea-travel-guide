// A quarantined post's LIVE twin — the check every release path owes before it
// clears a draft flag.
//
// 2026-09-22: the publish gate has refused duplicate venues since day one
// (generate.mjs: place.id, slug, topicKey). Nothing was watching the OTHER door.
// A post that is already on disk does not go back through generate.mjs; it goes
// live when a patrol deletes its `draft: true` — and four quarantined posts were
// sitting one release away from standing next to their own twin:
//
//   sentosa-lau-pa-sat            ↔ singapore-lau-pa-sat            (place.id)
//   tokyo-smith-wollensky         ↔ tokyo-smith-wollensky-ginza     (place.id)
//   madrid-el-campero-madrid      ↔ madrid-el-campero               (topic)
//   singapore-house-of-tan-…      ↔ singapore-house-of-tan-yeok-nee (topic)
//
// validate-content could not warn about them either: it skips drafts, so the
// contradiction only becomes visible on the day it becomes a live duplicate.
//
// backfill-photos-alt already had this check — for EVENTS only, keyed on the
// event anchor (`liveEvents.alreadyLive`). Venues had nothing. This module is
// that rule for the rest of the corpus, in one place so the three release paths
// cannot drift apart.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFrontmatter } from './frontmatter-edit.mjs';
import { topicKey } from './topic-key.mjs';

export const POSTS_DIR = 'src/content/posts';

/**
 * Index the LIVE posts so a draft can be tested against them.
 * @param {string} dir posts directory
 * @returns {{ byPlaceId: Map<string, string>, byTopic: Map<string, string> }}
 */
export function liveTwinIndex(dir = POSTS_DIR) {
  const byPlaceId = new Map();
  const byTopic = new Map();
  let files = [];
  try { files = readdirSync(dir); } catch { return { byPlaceId, byTopic }; }
  for (const f of files) {
    if (!f.endsWith('.md')) continue;
    let fm;
    try { fm = readFrontmatter(readFileSync(join(dir, f), 'utf8')); } catch { continue; }
    if (!fm || fm.draft === true) continue; // only LIVE posts can be a twin
    const slug = f.replace(/\.md$/, '');
    const id = fm.place?.id;
    // First writer wins: with two live posts on one id the pair is already a
    // duplicate, and this index is not the thing that resolves it.
    if (id && !byPlaceId.has(id)) byPlaceId.set(id, slug);
    if (fm.title && fm.region) {
      const k = topicKey(fm.title, fm.region);
      if (k && !byTopic.has(k)) byTopic.set(k, slug);
    }
  }
  return { byPlaceId, byTopic };
}

/**
 * Record a post this run just released, so the next draft in the same run sees
 * it. The index is a snapshot taken at startup; a patrol that clears two drafts
 * of one venue in one pass would otherwise publish both — the twin check would
 * be reading a disk state that stopped being true one iteration ago.
 * @param {{ byPlaceId: Map<string, string>, byTopic: Map<string, string> }} index
 * @param {string} slug
 * @param {any} fm
 */
export function noteLive(index, slug, fm) {
  if (!fm) return;
  const id = fm.place?.id;
  if (id && !index.byPlaceId.has(id)) index.byPlaceId.set(id, slug);
  if (fm.title && fm.region) {
    const k = topicKey(fm.title, fm.region);
    if (k && !index.byTopic.has(k)) index.byTopic.set(k, slug);
  }
}

/**
 * Slug of a live post covering the same venue as this one, or null.
 *
 * Same two keys the publish gate uses, in the same order: Google's place.id
 * when both posts carry one, and the normalized title+region key when either is
 * placeless — which is the case this exists for, since a placeless post is
 * exactly the one the id check cannot see.
 *
 * @param {string} slug the post being considered for release
 * @param {any} fm its parsed frontmatter
 * @param {{ byPlaceId: Map<string, string>, byTopic: Map<string, string> }} index
 * @returns {string | null}
 */
export function liveTwinOf(slug, fm, index) {
  if (!fm) return null;
  const id = fm.place?.id;
  if (id) {
    const hit = index.byPlaceId.get(id);
    if (hit && hit !== slug) return hit;
  }
  if (fm.title && fm.region) {
    const k = topicKey(fm.title, fm.region);
    const hit = k ? index.byTopic.get(k) : null;
    if (hit && hit !== slug) return hit;
  }
  return null;
}
