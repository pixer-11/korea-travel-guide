import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { isEventPast, eventSortValue } from '../../lib/eventStatus';
import { buildIcs, type IcsEvent } from '../../lib/ics';
import { SITE } from '../../siteConfig';
import countriesData from '../../../data/countries.json';

// Per-country subscribable calendar, mirroring the /events/<country> hubs.
export async function getStaticPaths() {
  const all = await getCollection('posts', ({ data }) => !data.draft && data.category === 'event');
  const bySlug = new Map(countriesData.countries.map((c) => [c.name, c]));
  const grouped = new Map<string, typeof all>();
  for (const p of all) {
    const name = p.data.country ?? 'South Korea';
    if (!grouped.has(name)) grouped.set(name, [] as unknown as typeof all);
    grouped.get(name)!.push(p);
  }
  // Same ≥2-event threshold the HTML hub uses, so the two stay in step.
  return [...grouped.entries()]
    .filter(([name, evs]) => bySlug.has(name) && evs.length >= 2)
    .map(([name, evs]) => ({
      params: { country: bySlug.get(name)!.slug },
      props: { countryName: name, posts: evs },
    }));
}

export const GET: APIRoute = async ({ site, props }) => {
  const base = site?.toString().replace(/\/$/, '') ?? '';
  const today = new Date();
  const { countryName, posts } = props as { countryName: string; posts: any[] };

  const upcoming = posts
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
      start: new Date(d.eventStartDate),
      end: d.eventEndDate ? new Date(d.eventEndDate) : null,
    };
  });

  const body = buildIcs({
    name: `${SITE.name} — ${countryName} events`,
    description: `Upcoming festivals and events in ${countryName}, from Wander Atlas.`,
    events,
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="wander-atlas-${countryName.toLowerCase().replace(/\s+/g, '-')}-events.ics"`,
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
