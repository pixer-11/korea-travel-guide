// ─────────────────────────────────────────────────────────────
//  HEAD BOX — where the subject's head is, as a box, not a point.
//
//  The vision gate used to report one focal point ("the face is at 50,45")
//  and every crop centred on it. Measured against the pictures, the point
//  sat 8–17% BELOW the face (Bruno Mars: hat top at ~30%, reported 45%;
//  owner, 2026-08-23). On a 2:3 portrait the card's crop window is 44% of
//  the image tall and absorbs the error; on a 16:9 phone photo held upright
//  (1.78, nine live heroes) the window is smaller and a point that low cuts
//  the chin. A BOX (top of hair → bottom of chin) gives the crop something
//  it can keep inside the window with air above — and asking for the top
//  edge explicitly pulls the model's answer up toward the hair, where the
//  single point never looked.
//
//  Stored shape stays backward compatible:
//    focus: { x, y }               — legacy point (every hero before 08-23)
//    focus: { x, y, top, bottom }  — point = box centre, plus the box
//  x/y keep feeding object-position unchanged; top/bottom only change how a
//  fixed-aspect crop (the card thumbnail) places its window.
// ─────────────────────────────────────────────────────────────

/** The question every focus-producing prompt appends. One wording, one parser. */
//  Asked of every photo, but the BOX is taken only when the subject is a
//  person. Asked of a café interior, "the main person's head" made the
//  model pick a customer's back at the bar in the background (Bali, 08-23)
//  and the card lost the breakfast the photo was about. A place or a dish
//  keeps the 2026-08-15 rule: one focal point on its most recognisable part.
export const HEAD_BOX_ASK =
  'ALSO locate the subject. First decide "subject": "person" ONLY if a person is clearly what the photo is about (large, in focus, the reason the picture was taken — a performer, an athlete); a bystander, a customer in the background or a small figure in a crowd does NOT count, answer "place" (or "dish") instead. ' +
  'Always give the FOCAL POINT a viewer must see — the person\'s FACE, the landmark\'s or room\'s most recognisable part, the dish — as focusX,focusY in percentages from the top-left (0-100); for a landscape with no single subject use 50,50. ' +
  'If subject is "person", ALSO give the HEAD BOX: the smallest box containing the WHOLE head (top of hair or hat → bottom of chin) as headTop/headBottom measured from the TOP edge and headLeft/headRight from the LEFT edge (0-100). Measure carefully — the top of the hair is usually higher than it first looks. If subject is not "person", set all four head values to null.';

export const HEAD_BOX_JSON = '"subject": "person"|"place"|"dish", "focusX": <0-100>, "focusY": <0-100>, "headTop": <0-100>|null, "headBottom": <0-100>|null, "headLeft": <0-100>|null, "headRight": <0-100>|null';

const pct = (v) => (Number.isFinite(Number(v)) ? Math.min(100, Math.max(0, Math.round(Number(v)))) : null);

/**
 * Turn a model reply into a stored focus. Accepts the head box (new) and the
 * bare focal point (old replies, old cached records) so no caller breaks.
 * Returns null when neither is usable.
 */
export function focusFromReply(j) {
  if (!j || typeof j !== 'object') return null;
  let top = pct(j.headTop), bottom = pct(j.headBottom), left = pct(j.headLeft), right = pct(j.headRight);
  // The box counts only for a person-subject; a reply that names no subject
  // at all (older wording) is trusted as before.
  const person = j.subject == null || String(j.subject).toLowerCase() === 'person';
  if (person && top != null && bottom != null && left != null && right != null) {
    if (top > bottom) [top, bottom] = [bottom, top];
    if (left > right) [left, right] = [right, left];
    // A zero-height "box" is a point in disguise — keep it as a point.
    if (bottom - top < 2) return { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2) };
    return { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2), top, bottom };
  }
  const x = pct(j.focusX ?? j.x), y = pct(j.focusY ?? j.y);
  return x != null && y != null ? { x, y } : null;
}

/** True when the focus carries a head box (not just a point). */
export const hasBox = (f) => Boolean(f && Number.isFinite(f.top) && Number.isFinite(f.bottom) && f.bottom > f.top);

/**
 * Vertical start (pixels) of a crop window `ch` tall on an image `H` tall.
 *   • box: centre on the box, then push the window so the box sits inside
 *     it with `margin` (fraction of the window) of air above the hair and
 *     below the chin; a box taller than the window stays centred.
 *   • point: the point at the window's centre (the 2026-08-22 rule).
 *   • none: caller decides (returns null).
 * Always clamped to the image.
 */
export function cropWindowTop({ H, ch, focus, margin = 0.08 }) {
  if (!focus || !Number.isFinite(H) || !Number.isFinite(ch) || ch <= 0) return null;
  const clamp = (t) => Math.max(0, Math.min(H - ch, Math.round(t)));
  if (hasBox(focus)) {
    const bt = (focus.top / 100) * H, bb = (focus.bottom / 100) * H, air = ch * margin;
    let top = (bt + bb) / 2 - ch / 2;
    if (bb - bt + 2 * air <= ch) {
      if (top > bt - air) top = bt - air;            // hair must be inside, with air above
      if (top + ch < bb + air) top = bb + air - ch;  // chin must be inside, with air below
    }
    return clamp(top);
  }
  if (!Number.isFinite(focus.y)) return null;
  return clamp((focus.y / 100) * H - ch / 2);
}

/**
 * The crop key a thumbnail was cut with. 'v2:' is the point window; a box
 * gets 'v3:' so ONLY heroes that gained a box are re-cut — not the 900
 * point-only thumbs that are still right.
 */
export const focusKey = (f) => (!f ? '' : hasBox(f) ? `v3:${f.x},${f.y},${f.top}-${f.bottom}` : `v2:${f.x},${f.y}`);

/**
 * The YAML lines for a focus under `heroImage:` — point, plus the box when
 * measured. Textual splicing (not re-serialising) keeps the rest of the
 * frontmatter byte-for-byte; every script that writes a focus by hand uses
 * this so none of them forgets the box.
 */
export function focusYaml(focus, eol = '\n', indent = '  ') {
  const lines = [`${indent}focus:`, `${indent}  x: ${focus.x}`, `${indent}  y: ${focus.y}`];
  if (hasBox(focus)) lines.push(`${indent}  top: ${focus.top}`, `${indent}  bottom: ${focus.bottom}`);
  return lines.join(eol);
}

/**
 * Replace (or insert) the focus block inside a post's `heroImage:` block.
 * Returns the new source, or null when there is no heroImage block to hold it.
 */
export function spliceFocus(src, focus) {
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const lines = src.split(/\r?\n/);
  const start = lines.findIndex((l) => /^heroImage:\s*$/.test(l));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && /^ {2}\S/.test(lines[end]) || (end < lines.length && /^ {3,}/.test(lines[end]))) end++;
  const kept = [];
  for (let i = start + 1; i < end; i++) {
    if (/^ {2}focus:/.test(lines[i])) {
      while (i + 1 < end && /^ {3,}/.test(lines[i + 1])) i++;
      continue;
    }
    kept.push(lines[i]);
  }
  lines.splice(start + 1, end - start - 1, ...kept, ...focusYaml(focus, eol).split(eol));
  return lines.join(eol);
}
