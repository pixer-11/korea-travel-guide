import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import countriesData from '../../data/countries.json';
import { SITE } from '../siteConfig';

// llms.txt, GENERATED from live data instead of hand-maintained. The old static
// file listed 10 of 17 countries and linked only 4 — stale the moment a country
// was added. Everything below derives from countries.json + the posts collection,
// so adding a country updates this file with no human step.
export const GET: APIRoute = async ({ site }) => {
  const base = site?.toString().replace(/\/$/, '') ?? 'https://wanderatlasguides.com';
  const posts = await getCollection('posts', ({ data }) => !data.draft);

  const countFor = (name: string) => posts.filter((p) => (p.data.country ?? 'South Korea') === name).length;
  const live = countriesData.countries
    .map((c) => ({ ...c, count: countFor(c.name) }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  // Cities we actually have guides for, in publish-volume order.
  const citiesFor = (country: string) => {
    const tally = new Map<string, number>();
    for (const p of posts) {
      if ((p.data.country ?? 'South Korea') !== country) continue;
      tally.set(p.data.region, (tally.get(p.data.region) ?? 0) + 1);
    }
    return [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r);
  };

  const countryList = live.map((c) => c.name);
  const coverage = countryList.length > 1
    ? `${countryList.slice(0, -1).join(', ')} and ${countryList[countryList.length - 1]}`
    : countryList[0] ?? '';

  const destLines = live.map((c) => {
    const cities = citiesFor(c.name).slice(0, 6);
    const tail = citiesFor(c.name).length > cities.length ? ' and more' : '';
    return `- [${c.name}](${base}/destinations/${c.slug}/): ${cities.join(', ')}${tail}`;
  });

  // Pre-built multi-day itineraries — a high-value AI-citation surface (an LLM
  // answering "3 days in Seoul" can cite the exact page). One line per itinerary,
  // days/stop count read from the itinerary data itself, never hardcoded.
  const itineraries = await getCollection('itineraries', ({ data }) => !data.draft);
  const itinLines = itineraries
    .slice()
    .sort((a, b) => a.data.city.localeCompare(b.data.city))
    .map((it) => {
      const stopCount = it.data.itinerary.reduce((n, day) => n + day.stops.length, 0);
      return `- [${it.data.title}](${base}/itinerary/${it.id}): ${it.data.days}-day itinerary in ${it.data.city}, ${it.data.country} — ${stopCount} stops`;
    });

  const body = `# ${SITE.name}

> ${SITE.name} (${base}) is an editor-reviewed, AI-assisted travel guide to destinations worldwide. Every guide opens with an answer-first summary, then gives verified facts sourced from live Google Places (ratings, addresses, price level), practical "how to get there" and "what to eat" details, and a FAQ. Coverage spans ${live.length} countries — ${coverage} — with more added continuously.

Facts such as ratings, addresses and hours come from live Google Places data and can change — verify before visiting. Images are licensed or public domain. Guides are produced with AI assistance and reviewed against official sources by the ${SITE.name} editorial team. Guides are available in English, Korean, Japanese, Spanish and Chinese.

## Destinations
- [All destinations](${base}/destinations): Browse every country and continent we cover
${destLines.join('\n')}

## Itineraries
- [All itineraries](${base}/itinerary): Ready-made day-by-day plans built from our verified guides
${itinLines.join('\n')}

## Travel essentials
- [Visa & entry](${base}/essentials/visa): Visa-free rules, e-arrival cards, entry requirements
- [Getting around](${base}/essentials/transport): Transit cards, trains, subways and map apps
- [Money & costs](${base}/essentials/money): Cards vs cash, ATMs, tipping, tax refunds
- [Best time to visit](${base}/essentials/best-time-to-visit): Seasons, weather, festivals
- [Emergency & help](${base}/essentials/emergency): Emergency numbers and traveler help lines

## Events
- [Upcoming events](${base}/events): Concerts, festivals and sports events worth traveling for, by month and country
- [Events feed (markdown)](${base}/events.md): Machine-readable list of upcoming events with dates, cities and links
- [Events calendar (iCal)](${base}/events.ics): Subscribable calendar of upcoming events

## Tools
- [Best time to visit — crowd finder](${base}/tools/best-time): Quietest hours to visit venues, from real foot-traffic data
- [Travel eSIM guides by country](${base}/tools/esim): eSIM vs pocket WiFi vs roaming per country — local networks, setup steps, no stale prices
- [Flights](${base}/flights): Search live flight prices to any destination
- [Free trip-planning checklist](${base}/free/trip-checklist): A printable pre-trip checklist

## About
- [Editorial policy](${base}/about): How our guides are made and reviewed
- [Contact](${base}/contact): Reach the editorial team
- [Sitemap](${base}/sitemap-index.xml): Full list of indexable pages
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
};
