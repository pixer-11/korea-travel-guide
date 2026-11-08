// WCAG text contrast, judged from the strings getComputedStyle hands back.
// Kept apart from the browser so the judgement can be tested both ways in CI
// (scripts/lib/contrast.test.mjs); scripts/live/contrast.mjs collects the strings.

/** rgb()/rgba() and the `color(srgb …)` a color-mix() computes to. Anything else is null: not measured, never passed. */
export function parseColor(s) {
  const text = String(s || '').trim();
  const nums = (text.match(/[0-9.]+/g) || []).map(Number);
  if (text.startsWith('color(srgb')) return { r: nums[0] * 255, g: nums[1] * 255, b: nums[2] * 255, a: nums[3] ?? 1 };
  if (text.startsWith('rgb') && nums.length >= 3) return { r: nums[0], g: nums[1], b: nums[2], a: nums[3] ?? 1 };
  return null;
}

/** One colour laid over another; the result is opaque when `bottom` is. */
export function over(top, bottom) {
  const mix = (t, b) => t * top.a + b * (1 - top.a);
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
}

function luminance({ r, g, b }) {
  const f = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** AA: 4.5, or 3 for large text (24px, or 18.66px bold). */
export function requiredRatio(px, weight) {
  return px >= 24 || (px >= 18.66 && weight >= 700) ? 3 : 4.5;
}

/**
 * @param row {{ color: string, layers: string[], opacity: number, px: number, weight: number }}
 *   `layers` runs outward from the text's own element and ends at the first
 *   opaque background; a stack with no opaque layer sits on white.
 * @returns {{ ratio: number, need: number, ok: boolean } | null} null when a colour could not be read.
 */
export function judgeText({ color, layers, opacity = 1, px, weight }) {
  const fg = parseColor(color);
  const parsed = layers.map(parseColor);
  if (!fg || parsed.includes(null)) return null;
  let bg = { r: 255, g: 255, b: 255, a: 1 };
  for (let i = parsed.length - 1; i >= 0; i--) bg = over(parsed[i], bg);
  const text = over({ ...fg, a: fg.a * opacity }, bg);
  const ratio = contrastRatio(text, bg);
  const need = requiredRatio(px, weight);
  // Tenths of a percent are rounding in the computed colours, not a defect.
  return { ratio, need, ok: ratio >= need - 0.005 };
}
