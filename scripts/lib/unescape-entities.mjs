// Frontmatter holds plain characters. The translator sometimes returns them
// HTML-escaped — "ITZY <TUNNEL VISION>" came back as "&lt;TUNNEL VISION&gt;"
// (2026-09-24), and again for Khalid on 2026-09-27 — and Astro escapes text
// once more when it renders, so readers saw the entity itself in the title,
// the events list and the search snippet. html-entity-titles.test.mjs caught
// both, but only after they were live; this runs before the file is written.
//
// &amp; goes last so "&amp;lt;" becomes the text "&lt;", not "<".
export function unescapeEntities(s) {
  if (typeof s !== 'string' || !s.includes('&')) return s;
  return s
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&(?:apos|#39|#x27);/gi, "'")
    .replace(/&#(\d+);/g, (m, d) => { const n = Number(d); return n > 31 && n < 0x110000 ? String.fromCodePoint(n) : m; })
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => { const n = parseInt(h, 16); return n > 31 && n < 0x110000 ? String.fromCodePoint(n) : m; })
    .replace(/&amp;/gi, '&');
}
