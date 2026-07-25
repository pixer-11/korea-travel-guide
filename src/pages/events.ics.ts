import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { isEventPast, eventSortValue } from '../lib/eventStatus';
import { buildIcs, type IcsEvent } from '../lib/ics';
import { SITE } from '../siteConfig';

// Subscribable calendar of every upcoming event. Readers add it once in their
// calendar app and Wander Atlas events keep showing up there — a recurring
// touchpoint that needs no repeat visit. Static, rebuilt daily with the site.
export const GET: APIRoute = async ({ site }) => {
  const base = site?.toString().replace(/\/$/, '') ?? '';
  const today = new Date();
  const all = await getCollection('posts', ({ data }) => !data.draft && data.category === 'event');
  const upcoming = all
    .filter((p) => !isEventPast(p.data, today) && p.data.eventStartDate)
    .sort((a, b) => eventSortValue(a.data, today) - eventSortValue(b.data, today));

  const events: IcsEvent[] = upcoming.map((p) => {
    const d = p.data;
    const slug = p.id.replace(/\.md$/, '');
    return {
      uid: `${slug}@wanderatlasguides.com`,
      title: String(d.title).replace(/:\s*What to Know.*$/i, '').trim(),
      description: d.description,
      url: `${base}/posts/${slug}`,
      location: [d.region, d.country].filter(Boolean).join(', '),
      start: new Date(d.eventStartDate as Date),
      end: d.eventEndDate ? new Date(d.eventEndDate) : null,
    };
  });

  const body = buildIcs({
    name: `${SITE.name} — Upcoming events`,
    description: 'Festivals, races and cultural events worldwide, from Wander Atlas.',
    events,
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="wander-atlas-events.ics"',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
