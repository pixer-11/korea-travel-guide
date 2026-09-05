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
  const hits = [];
  walk(out, '', (path, str) => {
    if (TOOL_MARKERS.test(str) || (fieldTag && fieldTag.test(str))) hits.push(path);
  });
  return hits;
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
