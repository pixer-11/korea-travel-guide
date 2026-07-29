// Turn stored 24h hour arrays into reader-friendly ranges: [8,9,10] → "8–11 AM".
//
// This lived inside PostArticle.astro, which meant the when-to-go pages could
// promise "verified quiet times" and then render venue cards with no times on
// them — the one dataset no competing travel site has, headlined and then not
// shown. Shared from here so both surfaces print the same thing.
//
// AM/PM is a locale word rather than punctuation, so the caller passes its
// translations; Korean readers get 오전/오후.

export function formatHourRanges(hours, { am = 'AM', pm = 'PM' } = {}) {
  const xs = [...new Set(hours ?? [])].filter((h) => Number.isInteger(h)).sort((a, b) => a - b);
  if (!xs.length) return null;

  const f = (h) => {
    const x = ((h % 24) + 24) % 24;
    return { t: x % 12 === 0 ? 12 : x % 12, m: x < 12 ? am : pm };
  };

  const runs = [];
  let s = xs[0], prev = xs[0];
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] === prev + 1) { prev = xs[i]; continue; }
    runs.push([s, prev]); s = xs[i]; prev = xs[i];
  }
  runs.push([s, prev]);

  return runs
    .map(([a, b]) => {
      // The end hour is exclusive: quiet through 10:00 means quiet until 11.
      const from = f(a), to = f(b + 1);
      return from.m === to.m ? `${from.t}–${to.t} ${to.m}` : `${from.t} ${from.m}–${to.t} ${to.m}`;
    })
    .join(', ');
}

/** The single most useful line for a venue: when it is quiet on a weekday. */
export function quietLine(busyness, labels = {}) {
  if (!busyness) return null;
  const wd = formatHourRanges(busyness.weekdayQuiet, labels);
  const we = formatHourRanges(busyness.weekendQuiet, labels);
  return { weekday: wd, weekend: we };
}
