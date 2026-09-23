import type { APIRoute } from 'astro';
import { overlapWeeks, overlapCsv } from '../../lib/holiday-overlap.mjs';
import countryFacts from '../../../data/country-facts.json';

// The open dataset behind /tools/holiday-overlap — same arithmetic as the page.
// CC BY 4.0; the page states the licence and the holiday source.
export const GET: APIRoute = () =>
  new Response(overlapCsv(overlapWeeks(countryFacts as any)), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="asia-holiday-overlap.csv"',
      'Cache-Control': 'public, max-age=3600',
    },
  });
