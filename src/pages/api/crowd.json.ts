import type { APIRoute } from 'astro';

export const prerender = true;

// DISCONTINUED 2026-09-26 at the data provider's request.
//
// This endpoint served the quiet/busy hours of ~800 venues as a public JSON
// feed. The hours come from BestTime.app. BestTime's written answer (2026-09-25,
// support thread "Written permission request: free public redistribution with
// attribution"): showing the hours on our guide pages is fine, and so are the
// embeddable widgets with a visible BestTime link — but a ready-made public
// feed could stand in for their API, so it may not stay up, "even with a more
// restrictive license, a key, or a rate limit".
//
// The URL is kept on purpose: anything that already calls it gets this notice
// and an empty list rather than a bare 404. Do NOT put venue data back here
// without a new written permission from BestTime.
export const GET: APIRoute = () =>
  new Response(
    JSON.stringify({
      discontinued: true,
      since: '2026-09-26',
      message:
        'This public crowd-data feed has been discontinued at the request of the data provider. ' +
        'For hourly foot-traffic data in your own app, use the BestTime.app API directly: https://besttime.app . ' +
        'Our embeddable crowd widgets remain available: https://wanderatlasguides.com/tools/widget/',
      count: 0,
      places: [],
    }, null, 1),
    {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    },
  );
