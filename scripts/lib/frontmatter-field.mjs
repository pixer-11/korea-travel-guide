// Replace (or insert) ONE top-level scalar field in a markdown file's YAML
// frontmatter by text, without re-serialising the rest — gray-matter's
// round-trip reorders keys and rewrites quoting on every other line, which
// turns a one-line title change into a 60-line diff and trips the srcHash
// tooling. Used by the CTR retitle tool (2026-08-23).

/** YAML single-quoted scalar: the only escape is '' for a literal '. */
export const yamlQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * Set `key: value` in the frontmatter block of `src`. A folded (`>-`) or
 * block value spanning indented continuation lines is replaced whole. When
 * the key is absent it is inserted after the first line of the block.
 * Returns the new source; the EOL style of the file is kept.
 */
export function setFrontmatterField(src, key, value) {
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const lines = src.split(/\r?\n/);
  if (lines[0] !== '---') throw new Error('no frontmatter');
  const end = lines.indexOf('---', 1);
  if (end < 0) throw new Error('unterminated frontmatter');
  const line = `${key}: ${yamlQuote(value)}`;
  const re = new RegExp(`^${key}:(\\s|$)`);
  for (let i = 1; i < end; i++) {
    if (!re.test(lines[i])) continue;
    let j = i + 1;
    while (j < end && /^\s+\S/.test(lines[j])) j++; // continuation lines of a folded/block scalar
    lines.splice(i, j - i, line);
    return lines.join(eol);
  }
  lines.splice(1, 0, line);
  return lines.join(eol);
}
