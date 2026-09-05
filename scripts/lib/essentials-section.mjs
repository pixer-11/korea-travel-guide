// ─────────────────────────────────────────────────────────────
//  ONE SECTION OF A COUNTRY ESSENTIALS GUIDE
//
//  build-essentials.mjs researches and writes a guide WHOLE. That is right for
//  a monthly refresh and wrong for adding a topic: the sixth topic (luggage
//  storage, 2026-09-05) would have rewritten visa, transport and money prose
//  that had already been reviewed. So section work goes through here — find the
//  heading, swap its body, and leave every other byte, including the file's
//  line endings, exactly as it was.
// ─────────────────────────────────────────────────────────────
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function detectEol(md) {
  return /\r\n/.test(md) ? '\r\n' : '\n';
}

/** Byte span of `## <heading>` up to the next H2 (or end of file), or null. */
export function findSection(md, heading) {
  const m = new RegExp(`^## ${escapeRe(heading)}[ \\t]*$`, 'm').exec(md);
  if (!m) return null;
  const bodyFrom = m.index + m[0].length;
  const rel = md.slice(bodyFrom).search(/^## /m);
  return { start: m.index, end: rel === -1 ? md.length : bodyFrom + rel };
}

export function upsertSection(md, { heading, body, anchorAfter = 'Getting around', fallbackBefore = 'Official sources' }) {
  const eol = detectEol(md);
  const text = String(body).trim().replace(/\r\n/g, '\n').replace(/\n/g, eol);
  const block = `## ${heading}${eol}${eol}${text}${eol}${eol}`;

  const existing = findSection(md, heading);
  if (existing) return md.slice(0, existing.start) + block + md.slice(existing.end);

  const anchor = findSection(md, anchorAfter);
  if (anchor) return md.slice(0, anchor.end) + block + md.slice(anchor.end);

  const before = findSection(md, fallbackBefore);
  if (before) return md.slice(0, before.start) + block + md.slice(before.start);

  return `${md.replace(/\s*$/, '')}${eol}${eol}${block}`;
}

/**
 * Per-section review date. The file-level `lastReviewed` means "the whole guide
 * was re-researched" and must keep that meaning, so a section refresh records
 * itself separately.
 */
export function stampSectionReviewed(md, slug, isoDate) {
  const eol = detectEol(md);
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  if (!fm) return md;
  const block = fm[1];
  const childRe = new RegExp(`^(\\s+)${escapeRe(slug)}: .*$`, 'm');

  if (/^sectionsReviewed:/m.test(block)) {
    const updated = childRe.test(block)
      ? block.replace(childRe, `$1${slug}: ${isoDate}`)
      : block.replace(/^sectionsReviewed:.*$/m, (line) => `${line}${eol}  ${slug}: ${isoDate}`);
    return md.slice(0, fm.index) + `---${eol}${updated}${eol}---` + md.slice(fm.index + fm[0].length);
  }
  const added = `${block}${eol}sectionsReviewed:${eol}  ${slug}: ${isoDate}`;
  return md.slice(0, fm.index) + `---${eol}${added}${eol}---` + md.slice(fm.index + fm[0].length);
}
