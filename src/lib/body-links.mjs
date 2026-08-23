// ─────────────────────────────────────────────────────────────
//  IN-BODY LINKS TO OUR OWN GUIDES — added at render time, not in content.
//
//  A place guide's 36 paragraphs carried ONE link to another guide; event
//  guides carry six and keep readers moving (UX audit 2026-08-23; readers
//  who click an internal link average 3.7 pages vs 1.2). The prose already
//  names neighbouring places by name — "a five-minute walk from Porto
//  Antico's Aquarium" — so the first plain-text mention of a place we have a
//  guide for becomes a link. Rendered HTML in, rendered HTML out; the
//  markdown on disk is untouched and translations get the same treatment
//  from their own rendered HTML.
//
//  Never inside an existing link, a heading, code, or a tag; one link per
//  target; at most `max` links per article so the body does not turn blue.
// ─────────────────────────────────────────────────────────────

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const SKIP = /^(a|h1|h2|h3|h4|code|pre|script|style)$/i;

/**
 * @param {string} html            rendered article HTML
 * @param {{name:string, href:string}[]} targets  guides to link; longer names first is best
 * @param {{max?:number, minLen?:number}} [opts]
 * @returns {string}
 */
export function linkMentions(html, targets, { max = 4, minLen = 5 } = {}) {
  if (!html || !targets?.length || max <= 0) return html;
  const todo = targets
    .filter((t) => t && t.href && typeof t.name === 'string' && t.name.trim().length >= minLen)
    .map((t) => {
      const name = t.name.trim();
      // Word boundaries only where the name itself is Latin/digit at that end:
      // Korean and Japanese attach particles straight onto a name ("경복궁을",
      // "経福宮の"), so a trailing letter must not block the match there.
      const lead = /^[A-Za-z0-9]/.test(name) ? '(^|[^\\p{L}\\p{N}])' : '(^|)';
      const tail = /[A-Za-z0-9]$/.test(name) ? '(?![\\p{L}\\p{N}])' : '';
      return { ...t, name, re: new RegExp(`${lead}(${escapeRe(name)})${tail}`, 'iu') };
    })
    .sort((a, b) => b.name.length - a.name.length);
  if (!todo.length) return html;
  let budget = max;
  const seenHref = new Set();
  const skipStack = [];
  let out = '';
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
  let last = 0, m;
  const emitText = (text) => {
    if (!text || skipStack.length || budget <= 0) { out += text; return; }
    // Each link is written and the search moves PAST it, so a later, shorter
    // name can never land inside anchor text already written.
    let done = '', rest = text;
    for (const t of todo) {
      if (budget <= 0) break;
      if (t.done || seenHref.has(t.href)) continue;
      const hit = t.re.exec(rest);
      if (!hit) continue;
      const at = hit.index + hit[1].length;
      done += `${rest.slice(0, at)}<a href="${escapeHtml(t.href)}">${hit[2]}</a>`;
      rest = rest.slice(at + hit[2].length);
      t.done = true; seenHref.add(t.href); budget--;
    }
    out += done + rest;
  };
  while ((m = tagRe.exec(html))) {
    emitText(html.slice(last, m.index));
    const tag = m[0], name = m[1].toLowerCase();
    const closing = tag.startsWith('</'), selfClosing = /\/>$/.test(tag);
    if (SKIP.test(name) && !selfClosing) {
      if (closing) { const i = skipStack.lastIndexOf(name); if (i >= 0) skipStack.splice(i, 1); }
      else skipStack.push(name);
    }
    out += tag;
    last = m.index + tag.length;
  }
  emitText(html.slice(last));
  return out;
}
