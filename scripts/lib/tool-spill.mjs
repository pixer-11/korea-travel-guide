// Tool-call spill guard for translation replies.
//
// 2026-09-05: the ko translation of essentials topic "luggage-storage" came
// back with the model's own tool-call XML inside a field value —
//
//   quickAnswer: "…아래 목적지별 가이드를 참고하세요.</quickAnswer>
//                 <parameter name="countryHeading">국가별 수하물 보관 안내"
//
// so `countryHeading` never arrived as a key, yaml.dump dropped it, and the
// Astro content collection refused the file. Every push after that failed
// "Build check (deploy guard)" and the live site sat on the previous build
// until the next morning. The reply is stochastic, so the fix is to refuse it
// at write time (retry) rather than repair the file afterwards.
//
// Two things are never legitimate inside a translated value:
//   1. tool-call plumbing (<parameter …>, <invoke>, <function_calls>, antml:)
//   2. a closing tag named after one of the reply's own fields (</quickAnswer>)
// (2) is derived from the reply's own keys instead of a hard-coded list, so a
// generic closing tag a markdown body may legitimately carry — </a>, </strong>
// — is left alone.

const TOOL_MARKERS = /<\/?(?:antml:)?(?:invoke|function_calls|parameter)\b|<parameter\s+name=/i;

// Only keys that are plain identifiers become closing-tag patterns, so nothing
// needs regex-escaping here.
const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function walk(value, path, hit) {
  if (typeof value === 'string') {
    hit(path || '(root)', value);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}[${i}]`, hit));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k, hit);
  }
}

/** Paths of every string in `out` that carries tool-call spill. Empty = clean. */
export function findToolSpill(out) {
  if (!out || typeof out !== 'object') return [];
  const keys = Object.keys(out).filter((k) => SAFE_KEY.test(k));
  const fieldTag = keys.length ? new RegExp(`</(?:${keys.join('|')})\\s*>`, 'i') : null;
  // The JSON form of the same spill: the model writes the whole reply as JSON
  // text into one field — `blurb: "…\",\"getting\":\"…"` or a value that opens
  // with `{"blurb":`. 45 region intros shipped that way, the raw `","getting":"`
  // printed mid-paragraph on /ko/regions/siem-reap and 44 others (owner,
  // 2026-10-01).
  const fieldJson = keys.length ? new RegExp(`"\\s*,\\s*"(?:${keys.join('|')})"\\s*:|^\\s*\\{\\s*"(?:${keys.join('|')})"\\s*:`) : null;
  const hits = [];
  walk(out, '', (path, str) => {
    if (TOOL_MARKERS.test(str) || (fieldTag && fieldTag.test(str)) || (fieldJson && fieldJson.test(str))) hits.push(path);
  });
  return hits;
}

/**
 * The web-search tool's citation markup, copied into a value by the model:
 * `<cite index="8-3,8-5">ITX-Cheongchun …</cite>`. 47 region intros across 24
 * cities carried it, raw on /regions/gapyeong and inside the FAQPage answer
 * sent to search engines (2026-10-01). The cited words stay; the tags go.
 */
export function stripCitations(s) {
  return String(s).replace(/<\/?cite\b[^>]*>/gi, '');
}

/** Names of required fields that came back missing or blank. Empty = complete. */
export function missingFields(out, required) {
  if (!out || typeof out !== 'object') return [...required];
  return required.filter((k) => {
    const v = out[k];
    if (Array.isArray(v)) return v.length === 0;
    return typeof v !== 'string' || v.trim() === '';
  });
}

/**
 * The arguments of a forced tool call, or a throw naming why the reply must
 * not be stored. A reply cut at max_tokens still parses: the fields that fit
 * arrive and the last ones are simply absent, and `{ zh: undefined }` vanishes
 * in JSON.stringify. translate-country-blurbs stored three such replies a day
 * for three weeks and left /zh/destinations/ in English (2026-11-08).
 * @param {any} msg  an Anthropic messages.create response
 * @param {string[]} required  field names that must be present and non-blank
 */
export function completeToolInput(msg, required) {
  if (msg?.stop_reason === 'max_tokens') throw new Error('reply cut at max_tokens');
  const use = msg?.content?.find((b) => b.type === 'tool_use');
  if (!use) throw new Error('no tool_use in response');
  // The model can close one field and open the next in XML *inside* a value
  // (2026-09-05, essentials topics ko). Never store such a reply.
  const spill = findToolSpill(use.input);
  if (spill.length) throw new Error(`tool-call spill in ${spill.join(', ')}`);
  const missing = missingFields(use.input, required);
  if (missing.length) throw new Error(`missing ${missing.join(', ')}`);
  return use.input;
}

/**
 * Put a spilled string field back where it belongs, when that can be done
 * without guessing.
 *
 * The spill has one shape: the model ends a string field with its own closing
 * tag and opens the NEXT field as XML inside the same value —
 *
 *   description: "Five days in Tokyo…</description>\n<parameter name=\"quickAnswer\">Start in…"
 *
 * so `quickAnswer` never arrives as a key, though every word of it did. Tokyo's
 * 5-day itinerary came back like this in 3 of 5 calls on 2026-11-14; the run
 * asked twice, got it twice, and the city went without its rebuild. Asking
 * again costs a call and may get the same reply. The text is all there.
 *
 * Only this exact shape is undone: a top-level string field, closed with ITS
 * OWN name, followed by exactly one <parameter name="X"> where X is a key the
 * reply is missing. Anything else is left for findToolSpill to refuse.
 *
 * @param {object} out  the tool input; modified in place
 * @param {string[]} [allowed]  the only keys that may be restored (the schema's string fields)
 * @returns {string[]} keys restored, in order; [] when nothing was touched
 */
export function restoreSpilledFields(out, allowed = null) {
  if (!out || typeof out !== 'object') return [];
  const restored = [];
  // A restored field can itself carry the next one, so walk until nothing moves.
  for (let guard = 0; guard < 8; guard++) {
    let moved = false;
    for (const key of Object.keys(out)) {
      const value = out[key];
      if (typeof value !== 'string' || !SAFE_KEY.test(key)) continue;
      // String.raw: this file has lost a layer of backslashes to a shell once.
      const m = new RegExp(String.raw`^([\s\S]*?)</${key}\s*>\s*<parameter\s+name="([A-Za-z_][A-Za-z0-9_-]*)"\s*>([\s\S]*)$`, 'i').exec(value);
      if (!m) continue;
      const [, own, next, rest] = m;
      if (next in out || (allowed && !allowed.includes(next))) continue;
      // The moved text may end by closing the parameter. If it carries the field
      // after it too, it is moved whole and undone on the next pass; whatever
      // plumbing is still left after that, findToolSpill refuses.
      const tail = rest.replace(/\s*<\/parameter\s*>\s*$/i, '');
      if (!own.trim() || !tail.trim() || TOOL_MARKERS.test(own)) continue;
      out[key] = own.trim();
      out[next] = tail.trim();
      restored.push(next);
      moved = true;
    }
    if (!moved) break;
  }
  return restored;
}
