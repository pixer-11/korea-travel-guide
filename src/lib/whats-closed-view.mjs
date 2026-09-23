// ─────────────────────────────────────────────────────────────
//  WHAT'S CLOSED — the results view, as HTML strings.
//
//  One renderer for both sides. The page used to draw its answer twice — once
//  in Astro for the delivered HTML, once in an inline script when the reader
//  pressed the button — and the two drifted (English venue names on the server
//  list, raw ISO dates on one side only, styles lost on redraw; all 2026-09).
//  Now the server calls renderResults() with set:html and the browser calls the
//  same function after a change, so there is nothing to keep in step.
//
//  Layout (2026-09-24 redesign, from the owner's Claude Design proposal):
//    1. three summary cards — holidays hit, places with a closing day,
//       days on which everything is open
//    2. a place × date grid — one row per place, a cell per day
//    3. the holidays, reader's-language name first
//    4. "go on these days" — for each place, the days it IS open
//  Pure: data and localized strings come in by argument, no DOM, no imports.
// ─────────────────────────────────────────────────────────────

export const MAX_GRID_DAYS = 21;
// Rows in the grid. A country with sixty places with a closing day would make
// the grid a wall; the rest are listed as links under it.
export const MAX_GRID_ROWS = 15;
const DAY = 86400000;

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Every ISO day from..to inclusive, capped. Empty when the range is backwards. */
export function spanOf(fromISO, toISO, cap = MAX_GRID_DAYS) {
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.parse(`${toISO}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return [];
  const out = [];
  for (let t = a; t <= b && out.length < cap; t += DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

const dow = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

/**
 * The numbers the view is drawn from — exported so a test can check them
 * without parsing HTML.
 * @param {{holidays:{date:string}[], venues:{slug:string,name:string,city:string|null,closed:number[]}[]}} data
 * @param {string[]} span
 */
export function summarize(data, span) {
  const holidays = (data?.holidays ?? []).filter((h) => span.includes(h.date));
  const holidayDays = new Set(holidays.map((h) => h.date));
  const rows = (data?.venues ?? [])
    .map((v) => {
      const cells = span.map((d) => (v.closed.includes(dow(d)) ? 'closed' : 'open'));
      return { ...v, cells, closedCount: cells.filter((c) => c === 'closed').length };
    })
    .filter((r) => r.closedCount > 0)
    .sort((a, b) => b.closedCount - a.closedCount || a.name.localeCompare(b.name));
  const closedPerDay = span.map((_, i) => rows.filter((r) => r.cells[i] === 'closed').length);
  const allOpen = span.filter((d, i) => closedPerDay[i] === 0 && !holidayDays.has(d));
  return {
    holidays, holidayDays, rows, closedPerDay, allOpen,
    closureTotal: rows.reduce((a, r) => a + r.closedCount, 0),
  };
}

/**
 * @param {object} data     one country's island entry
 * @param {string[]} span   ISO days (already capped)
 * @param {object} S        localized strings (see WhatsClosed.astro `S`)
 * @param {string} locale   BCP-47 for Intl
 * @param {string} postBase localized /posts prefix
 */
export function renderResults(data, span, S, locale, postBase) {
  const sum = summarize(data, span);
  const f = (opts) => new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' });
  // "9/24", not Intl's "9. 24." (ko) or "24/9" guesswork: month/day everywhere
  // except Spanish, which reads day/month.
  const md = { format: (d) => (String(locale).startsWith('es')
    ? `${d.getUTCDate()}/${d.getUTCMonth() + 1}`
    : `${d.getUTCMonth() + 1}/${d.getUTCDate()}`) };
  const wd = f({ weekday: 'short' });
  const monthShort = f({ month: 'short' });
  const at = (iso) => new Date(`${iso}T00:00:00Z`);
  const n = (tpl, v) => esc(String(tpl).replace('{n}', String(v)));
  const dayList = (days, max = 4) => {
    const shown = days.slice(0, max).map((d) => `${md.format(at(d))}(${wd.format(at(d))})`).join(', ');
    return days.length > max ? `${shown} …` : shown;
  };

  // 1 — summary
  const firstHol = sum.holidays[0];
  const cards = `
<div class="wcv-sum">
  <div class="wcv-card wcv-card-hol">
    <p class="wcv-card-k">${esc(S.sumHolidays)}</p>
    <p class="wcv-card-n">${n(S.unitDays, new Set(sum.holidays.map((h) => h.date)).size)}</p>
    <p class="wcv-card-s">${firstHol ? `${esc(md.format(at(firstHol.date)))} ${esc(firstHol.label)}${sum.holidays.length > 1 ? ' …' : ''}` : esc(S.none)}</p>
  </div>
  <div class="wcv-card">
    <p class="wcv-card-k">${esc(S.sumClosedPlaces)}</p>
    <p class="wcv-card-n">${n(S.unitPlaces, sum.rows.length)}</p>
    <p class="wcv-card-s">${esc(S.sumClosedSub.replace('{days}', String(span.length)).replace('{n}', String(sum.closureTotal)))}</p>
  </div>
  <div class="wcv-card wcv-card-open">
    <p class="wcv-card-k">${esc(S.sumAllOpen)}</p>
    <p class="wcv-card-n">${n(S.unitDays, sum.allOpen.length)}</p>
    <p class="wcv-card-s">${sum.allOpen.length ? esc(dayList(sum.allOpen, 3)) : esc(S.none)}</p>
  </div>
</div>`;

  // 2 — grid (only when some place closes; otherwise one plain line)
  let grid;
  if (!sum.rows.length) {
    grid = `<section class="wcv-panel"><h2>${esc(S.gridHeading)}</h2><p class="wcv-empty">${esc(S.noClosures)}</p></section>`;
  } else {
    let prevMonth = '';
    const head = span.map((d) => {
      const hol = sum.holidayDays.has(d);
      const m = monthShort.format(at(d));
      const showMonth = m !== prevMonth; prevMonth = m;
      return `<th scope="col" class="${hol ? 'wcv-hol' : ''}"${hol ? ` title="${esc(S.legendHoliday)}"` : ''}><time datetime="${d}"><span class="wcv-wd">${esc(wd.format(at(d)))}</span><span class="wcv-md">${esc(showMonth ? md.format(at(d)) : String(at(d).getUTCDate()))}</span></time></th>`;
    }).join('');
    const shownRows = sum.rows.slice(0, MAX_GRID_ROWS);
    const extra = sum.rows.slice(MAX_GRID_ROWS);
    const body = shownRows.map((r) => `
<tr>
  <th scope="row"><a href="${esc(postBase)}/${esc(r.slug)}/">${esc(r.name)}</a>${r.city ? `<span class="wcv-city">${esc(r.city)}</span>` : ''}</th>
  ${r.cells.map((c, i) => `<td class="${sum.holidayDays.has(span[i]) ? 'wcv-hol' : ''}"><span class="wcv-dot wcv-${c}" aria-label="${esc(c === 'closed' ? S.legendClosed : S.legendOpen)}">${c === 'closed' ? '×' : ''}</span></td>`).join('')}
</tr>`).join('');
    const foot = `<tr class="wcv-foot"><th scope="row">${esc(S.closedThatDay)}</th>${sum.closedPerDay.map((c, i) => `<td class="${sum.holidayDays.has(span[i]) ? 'wcv-hol' : ''}">${c || '–'}</td>`).join('')}</tr>`;
    grid = `
<section class="wcv-panel">
  <div class="wcv-panel-head">
    <h2>${esc(S.gridHeading)}</h2>
    <p class="wcv-legend"><span><i class="wcv-dot wcv-open"></i>${esc(S.legendOpen)}</span><span><i class="wcv-dot wcv-closed"></i>${esc(S.legendClosed)}</span><span><i class="wcv-ring"></i>${esc(S.legendHoliday)}</span></p>
  </div>
  <div class="wcv-scroll" tabindex="0" role="region" aria-label="${esc(S.gridHeading)}">
    <table class="wcv-grid"><thead><tr><th scope="col"></th>${head}</tr></thead><tbody>${body}${foot}</tbody></table>
  </div>
  ${extra.length ? `<p class="wcv-more">${esc(S.moreRows.replace('{n}', String(extra.length)))} ${extra.map((r) => `<a href="${esc(postBase)}/${esc(r.slug)}/">${esc(r.name)}</a>`).join(' · ')}</p>` : ''}
  <p class="wcv-note">${esc(S.hoursSource)}</p>
</section>`;
  }

  // 3 — holidays
  const hols = sum.holidays.length
    ? `<ul class="wcv-hols">${sum.holidays.map((h) => `
<li><time class="wcv-badge" datetime="${h.date}"><small>${esc(monthShort.format(at(h.date)))}</small>${esc(String(at(h.date).getUTCDate()))}</time>
<span><strong>${esc(h.label)}</strong>${h.local && h.local !== h.label ? `<small>${esc(h.local)} · ${esc(wd.format(at(h.date)))}</small>` : `<small>${esc(wd.format(at(h.date)))}</small>`}</span></li>`).join('')}</ul>`
    : `<p class="wcv-empty">${esc(S.noHolidays)}</p>`;
  const holPanel = `<section class="wcv-panel wcv-hol-panel"><h2>${esc(S.holidaysHeading)}</h2>${hols}<p class="wcv-note">${esc(S.caveat)}</p></section>`;

  // 4 — plan: the days each place IS open
  const plan = sum.rows.length ? `
<section class="wcv-plan">
  <h2>${esc(S.planHeading)}</h2>
  <ul>${sum.rows.slice(0, 8).map((r) => {
    const open = span.filter((_, i) => r.cells[i] === 'open');
    const shut = span.filter((_, i) => r.cells[i] === 'closed');
    // Whichever list is shorter is the useful one: "open only at weekends" for
    // a weekend market, "just avoid Monday" for a museum.
    const line = !open.length ? S.planNeverOpen
      : open.length <= shut.length ? S.planOpenOn.replace('{dates}', dayList(open, 6))
      : S.planAvoid.replace('{dates}', dayList(shut, 6));
    return `<li><strong>${esc(r.name)}</strong> — ${esc(line)}</li>`;
  }).join('')}</ul>
</section>` : '';

  return `${cards}${grid}<div class="wcv-pair">${holPanel}${plan}</div>`;
}
