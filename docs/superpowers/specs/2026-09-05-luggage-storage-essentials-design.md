# Luggage storage — a sixth essentials topic (country level)

*2026-09-05. Approved in chat before writing.*

## Why this, why now

Reddit demand research on 2026-09-05 harvested 1,358 real threads (21 subreddits,
last 12 months) and counted them **by title** — what someone opened a thread to
ask, not what a trip report mentions in passing. Luggage storage came first, 33
threads, concentrated in Japan (r/JapanTravelTips 21) and China (r/travelchina
11): *"Hotel Luggage Storage in Tokyo"*, *"Long-term luggage storage in Tokyo for
1 week?"*, *"Himeji JR Station Luggage Storage Lockers"*.

We publish nothing on it. The five essentials topics are visa, transport, money,
best time and emergency.

The same research says the eventual destination is **city level** — people search
"luggage storage tokyo", not "japan". We are not starting there because the
blocker is data, not page type: our venue database holds restaurants and
attractions, not lockers, and inventing locations or prices is the exact defect
class the 09-02→09-04 repair marathon removed. Country level is the part we can
write truthfully today, and it is what a city page would link to for the
mechanics. City level follows only if a verifiable location source is found
(see Roadmap in the memory note `wa-content-gap-roadmap`).

## What the reader gets

1. **A topic hub** at `/essentials/luggage-storage` (+ `/ko|ja|es|zh/...`):
   how left luggage works when you travel — station coin lockers and their sizes,
   what a locker typically costs, app-based networks that hold bags in shops,
   airport baggage counters, hotels holding bags before check-in and after
   check-out — then the country list, then FAQ. Same shape as the other five.
2. **A `## Luggage storage` section in each country guide**
   (`src/content/essentials/<country>.md`), placed directly after
   `## Getting around`: what exists in *that* country, roughly what it costs,
   which network or operator serves it, and the official links.

## Architecture

### Content model
No new collection. The topic is a sixth file in `essentialsTopics`
(`icon, metaTitle, metaDescription, h1, dek, quickAnswer, countryHeading,
breadcrumbName, disclosure, faq[]` — the existing `topicShape`), and the country
text is a new `##` section inside the existing `essentials` markdown body.

Consequence: `translate-topics.mjs` (globs the collection) picks the hub up for
ko/ja/es/zh with no change, and `translate-essentials.mjs` re-queues each country
guide because its source hash changes.

### Inserting the section into 20 country files

`scripts/build-essentials.mjs` rewrites a country guide **whole**. Running it to
add a section would also rewrite visa, transport and money prose that has already
been reviewed — unacceptable.

A new script, `scripts/add-essentials-section.mjs`, does one job: put one named
section into country guides without disturbing anything else.

- Reads `src/content/essentials/<country>.md`, finds the `## <Section>` heading.
  Absent → insert after `## Getting around`; present → replace that section only.
  Anchor fallback order: `## Getting around` → before `## Official sources` →
  end of body. Every other byte is preserved, including line endings.
- Researches with the same web-search pattern `build-essentials.mjs` uses
  (`WRITER_MODEL`, `HOUSE_STYLE`), one country at a time, resumable, `COUNTRY=`
  and `FORCE=` honoured.
- Records when the section itself was checked, in frontmatter:
  `sectionsReviewed: { 'luggage-storage': 2026-09-05 }` — a new optional map on
  the `essentials` schema. The file-level `lastReviewed` keeps meaning "the
  whole guide was re-researched" and is **not** touched by this script.
- Generic by construction: `SECTION=luggage-storage` today, `dietary` and
  `kids` next, with their prompts kept in one table in the script.

### The registration problem

Adding a topic today means editing five places by hand:

| # | File | What |
|---|---|---|
| 1 | `src/content/essentials-topics/<slug>.md` | the hub's prose |
| 2 | `src/pages/essentials/<slug>.astro` | English route (7 lines) |
| 3 | `src/pages/[lang]/essentials/<slug>.astro` | localized route (13 lines) |
| 4 | `src/components/EssentialsIndex.astro` | the card in the topic list |
| 5 | `src/pages/llms.txt.ts` | the line for AI crawlers |

Plus `src/i18n/ui.ts`: `ess.<key>` and `ess.<key>Dek` in all five languages.

Miss one and the failure is silent — a hub nobody links to, or a card that 404s.
So this design adds `scripts/essentials-topics-registered.test.mjs`: enumerate
`src/content/essentials-topics/*.md` and assert, for each slug, that 2–5 exist
and that `ui.ts` carries both keys in all five languages. It fails the build for
any topic, not just this one.

### Accuracy rules for the generated sections

The 09-02→09-04 marathon exists because generated prose asserted things nobody
checked. The section generator therefore:

- States **ranges**, never a single exact price: "most station lockers run about
  ¥400–800 a day depending on size". A country-wide exact figure is a fabrication.
- Ends every section with 1–3 official links (rail or airport operator, or the
  service's own site). **Each link is fetched before the section is written**;
  a section whose links do not answer 200 is discarded and the country skipped.
- Names the network or operator only when the link proves it serves that country.
- Skips a country outright when research yields nothing verifiable — no empty
  section, no hedged filler. Better one country short than one country wrong.
- Passes the existing prose checks (`validate-content.mjs`) before commit.

## Testing

| Level | What |
|---|---|
| Unit | the section inserter as a pure function: inserts at the anchor; replaces in place on a second run (idempotent); leaves every other byte and the line endings identical; falls back correctly when `## Getting around` is missing |
| Unit | registration test above (fails when a topic lacks a route, card or ui string) |
| Integration | `node scripts/validate-content.mjs` clean; `translate-topics.mjs --dry` queues the new topic for four languages |
| Live | after deploy: `/essentials/luggage-storage/` 200 in five languages, the card appears on `/essentials/`, a country guide shows the section, every source link 200 |

## Rollout

1. Hub page + routes + registration test + ui strings — no country text yet.
2. **Japan only**, for 픽서님's review: it is the demand centre and the country
   the editor knows first-hand.
3. On approval, the remaining 19 countries, one run, resumable.
4. Translations (hub + changed country guides), then deploy, then the live checks.

Each step is its own commit; the whole batch is pushed once (repeated pushes
cancel each other's builds).

## Deliberately not in scope

City and station pages; locker location lists; prices per station; affiliate
links to storage networks. Each needs a verifiable location source we do not yet
have, and that question is the next roadmap item, not this one.
