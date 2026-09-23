import type { APIRoute } from 'astro';
import { overlapWeeks, peakWeeks } from '../../lib/holiday-overlap.mjs';
import { buildIcs, type IcsEvent } from '../../lib/ics';
import { SITE } from '../../siteConfig';
import countryFacts from '../../../data/country-facts.json';

// Subscribable: the weeks when three or more Asian countries are on a weekday
// public holiday together. Rebuilt daily with the site, so it rolls forward.
export const GET: APIRoute = ({ site }) => {
  const base = site?.toString().replace(/\/$/, '') ?? '';
  const weeks = overlapWeeks(countryFacts as any);
  const peaks = peakWeeks(weeks, 52).filter((w) => w.score >= 3)
    .sort((a, b) => a.start.localeCompare(b.start));
  const events: IcsEvent[] = peaks.map((w) => ({
    uid: `asia-holiday-overlap-${w.start}@wanderatlasguides.com`,
    title: `${w.score} Asian countries on holiday`,
    description: w.markets
      .map((m: any) => `${m.country}: ${[...new Set(m.holidays.map((h: any) => h.name))].join(', ')}`)
      .join('\n'),
    url: `${base}/tools/holiday-overlap`,
    start: new Date(`${w.start}T00:00:00Z`),
    end: new Date(`${w.end}T00:00:00Z`),
  }));
  const body = buildIcs({
    name: `${SITE.name} — Asia holiday overlap`,
    description: 'Weeks when several Asian countries are on public holiday at once. CC BY 4.0, Wander Atlas.',
    events,
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="asia-holiday-overlap.ics"',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
