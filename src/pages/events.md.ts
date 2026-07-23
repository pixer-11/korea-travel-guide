import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { isEventPast, eventSortValue } from '../lib/eventStatus';
import { SITE } from '../siteConfig';

// Machine-readable feed of upcoming events for AI assistants / agents. Same data
// as /events, but as clean markdown that LLMs parse without rendering JS. Static
// (rebuilt daily with the site), so it stays as fresh as the HTML hub.
export const GET: APIRoute = async ({ site }) => {
  const base = site?.toString().replace(/\/$/, '') ?? '';
  const today = new Date();
  const all = await getCollection(
    'posts',
    ({ data }) => !data.draft && data.category === 'event'
  );
  const upcoming = all
    .filter((p) => !isEventPast(p.data, today))
    .sort((a, b) => eventSortValue(a.data, today) - eventSortValue(b.data, today));

  const fmt = (d?: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : null);
  const cleanTitle = (t: string) => t.replace(/:\s*What to Know.*$/i, '').trim();

  const entries = upcoming.map((p) => {
    const d = p.data;
    const s = fmt(d.eventStartDate);
    const e = fmt(d.eventEndDate);
    const dates = s ? (e && e !== s ? `${s} to ${e}` : s) : 'Date to be announced';
    return (
      `- **${cleanTitle(d.title)}** — ${d.region}, ${d.country ?? 'South Korea'} · ${dates}\n` +
      `  ${d.description}\n` +
      `  ${base}/posts/${p.id}`
    );
  });

  const body =
    `# Upcoming events — ${SITE.name}\n\n` +
    `${upcoming.length} upcoming concerts, festivals, and sports events travelers plan trips around. ` +
    `Each links to a full guide with dates, city, and how to plan around it. ` +
    `Dates and tickets change — confirm on the official source.\n\n` +
    `Source: ${base}/events · Last updated: ${today.toISOString().slice(0, 10)}\n\n` +
    (entries.length ? entries.join('\n\n') : '_No upcoming events listed right now._') +
    '\n';

  return new Response(body, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
};
