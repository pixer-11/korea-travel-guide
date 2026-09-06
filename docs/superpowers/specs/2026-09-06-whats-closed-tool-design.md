# "What's closed on my dates" — a small date-range tool

*2026-09-06. Approved in chat before writing.*

## Why this, and why small

The Reddit demand study (2026-09-05, 1,358 threads) found the largest single genre
is not "what should I see" but "does this plan work" — 91 threads asking someone to
look over an itinerary. Closures and public holidays are the recurring hazard inside
those threads, and it is a question we can answer from data we already hold, with no
external source to verify. That matters: the luggage-storage round the same week
shipped 4 countries out of 20 because official sources could not be found for the
other 16.

It stays **one page**, not a page grid, for a reason that has nothing to do with
effort. Indexing has been frozen since 2026-07-25 — 634 new pages took zero
impressions — and publishing is throttled to 25/day in response. A thousand new
template URLs would add index pressure and reach nobody. Traffic for this comes from
internal links on the 1,025 `when-to-go` pages and the 20 country guides, not from
new URLs.

## What it answers, and from what

Measured on 2026-09-06:

| Input | Coverage | The question it answers |
|---|---|---|
| Public holidays: date + local name, translated into 5 languages | 20 countries, this year + next | "Is there a public holiday during my trip?" |
| Weekly closed days from Google Places hours | **129 venues** (Monday 79, Tuesday 28, Sunday 23) | "Which of the places you cover are shut on the days I'm there?" |

Both are facts already in the repo: `data/country-facts.json` (holidays),
`src/i18n/holidays.json` (their names in ko/ja/es/zh), and each post's
`place.openingHours`.

## What it will not say

The tool knows holiday **dates** and each venue's **ordinary weekly** schedule. It
does not know holiday opening hours, and it will not imply that it does. No
"museums close on national holidays", no "expect reduced hours" — those are guesses
dressed as findings, the exact class of claim the 2026-09-02→04 repairs removed.

The page states plainly: a public holiday falls on these dates; these venues we
cover are normally closed on these weekdays; holiday schedules differ and are worth
checking with the venue.

Two data honesty rules:
- A post carrying `place.hoursOmitted` is excluded. That field means Google filed
  another entity's schedule under this place, and its "closed Monday" is not this
  venue's fact.
- Venue hours come from Google Places and are sometimes stale. The page says where
  the hours come from and when that venue was last refreshed, so a reader can judge.

## Shape

```
src/lib/whats-closed.mjs        pure functions over data passed in — no imports of
                                site data, so it is testable in plain node
                                (same contract as src/lib/when-to-go.mjs)
src/components/WhatsClosed.astro  build-time data → server-rendered result +
                                a small client filter for the date range
src/pages/tools/whats-closed.astro          English route
src/pages/[lang]/tools/whats-closed.astro   ko/ja/es/zh
```

Five URLs total, matching the existing `best-time` tool exactly (`BestTimeTool.astro`
shared by both routes, `lang` as the only prop).

### The library

```js
holidaysInRange(countryFacts, country, fromISO, toISO)   → [{date, localName, name}]
closedVenuesInRange(posts, { country, fromISO, toISO })  → [{date, weekday, venues:[…]}]
weekdayClosures(posts)                                   → Map<country, Map<weekday, venue[]>>
```

Pure, data-in/data-out. No date library: ISO strings in, ISO strings out, UTC
arithmetic only, because a range that crosses a month or a year is the normal case
and local-time parsing is where that breaks.

### Rendering

Server-rendered for the default view (a country, the next 14 days) so the answer
exists as text in the delivered HTML — the same decision `BestTimeTool` documents,
and what makes the page quotable by an assistant. The date pickers then filter a
build-time JSON island client-side. No API, no server.

## Where it is linked from

- every `when-to-go/<country>/<month>` page: the month's holidays are already listed
  there, so the line is "planning exact dates? check what's closed"
- each country guide's `## Getting around` neighbourhood, where the reader is
  already thinking about days
- `/tools/` index and `llms.txt`

## Testing

| Level | What |
|---|---|
| Unit | `whats-closed.test.mjs`: a range inside one month; a range crossing a month; crossing a year; a range with no holidays; a venue with `hoursOmitted` is excluded; a venue closed two days a week appears on both; empty inputs return empty, never throw |
| Unit | the five-language strings exist for every key the component uses (the same registration check the essentials topics gained on 2026-09-05) |
| Integration | `validate-content.mjs` clean; the page builds in all five languages |
| Live | after deploy: five URLs answer 200, the default view shows real holidays for a country we know has one in the window, and the closed-venue list matches a venue's own page |

## Deliberately not in scope

Crowd hours — `/tools/best-time/` already answers "what time is it quiet" from the
same catalogue, in five languages. This tool links to it rather than repeating it.
Per-city pages, opening-hour predictions for holidays, and any venue we have not
published.
