import { getCollection } from 'astro:content';

// PUBLIC CROWD-DATA API — the site's one genuinely uncopyable asset, served as data.
//
// Why this exists. Audiala's founder replied to an outreach mail on 2026-08-25
// with exactly one question: "Do you have an API? Happy to link to your service
// if we use it." A backlink from a site that credits its sources was on the
// table and the only thing missing was a machine-readable endpoint. The numbers
// were already on the pages; nothing but the wrapper was absent.
//
// Foot-traffic patterns per venue are absent from Google Maps' public data and
// unlicensable by assistants, so this is the part of the catalogue that other
// people actually want. Giving it away costs nothing (it is already visible on
// every guide page) and is the cheapest credited-link generator the site has.
//
// Shape is deliberately flat and boring: one array, one object per place, hours
// as integers in local 24h time. No pagination, no auth, no rate limit — the
// whole thing is a static file built at deploy time, so it costs a CDN hit.
//
// CORS is wide open ON PURPOSE. A browser-side integration (Audiala's case) is
// blocked without it, and there is nothing here to protect: every number is
// already public on the page it came from.
export const prerender = true;

const SITE = (import.meta.env.SITE || 'https://wanderatlasguides.com').replace(/\/$/, '');

type Busy = { weekdayQuiet?: number[]; weekendQuiet?: number[]; weekendBusy?: number[]; updated?: string | Date };

// Only places that actually carry a measurement. A venue with an empty busyness
// block is worse than absent — a consumer would read "no quiet hours" as a fact
// rather than as missing data.
const hasData = (b?: Busy) =>
  !!b && ((b.weekdayQuiet?.length ?? 0) + (b.weekendQuiet?.length ?? 0) + (b.weekendBusy?.length ?? 0)) > 0;

const day = (d?: string | Date) =>
  !d ? null : (d instanceof Date ? d.toISOString() : new Date(d).toISOString()).slice(0, 10);

export async function GET() {
  const posts = await getCollection('posts', ({ data }) => !data.draft);

  const places = posts
    .filter((p) => hasData(p.data.place?.busyness as Busy))
    .map((p) => {
      const b = p.data.place!.busyness as Busy;
      return {
        id: p.id.replace(/\.md$/, ''),
        // The venue name, not the SEO headline: "Wat Arun", not
        // "Wat Arun: Bangkok Travel Guide (4.6★)". A consumer matching against
        // their own place list needs the former.
        name: p.data.place?.name ?? String(p.data.title).split(':')[0].trim(),
        city: p.data.region ?? null,
        country: p.data.country ?? null,
        lat: p.data.place?.lat ?? null,
        lng: p.data.place?.lng ?? null,
        // Local clock hours, 0-23. Empty array means "measured, none found",
        // which is different from the field being absent.
        weekdayQuiet: b.weekdayQuiet ?? [],
        weekendQuiet: b.weekendQuiet ?? [],
        weekendBusy: b.weekendBusy ?? [],
        measured: day(b.updated),
        url: `${SITE}/posts/${p.id.replace(/\.md$/, '')}/`,
      };
    })
    .sort((a, b) => (a.country ?? '').localeCompare(b.country ?? '') || (a.city ?? '').localeCompare(b.city ?? ''));

  const body = {
    // Attribution terms live IN the payload, not only in prose on a docs page.
    // A developer wiring this up reads the JSON, not the website.
    license: 'Free to use, including commercially. Attribution requested, not required.',
    attribution: {
      text: 'Crowd data by Wander Atlas',
      url: `${SITE}/tools/best-time/`,
    },
    docs: `${SITE}/tools/best-time/`,
    hours: 'Local clock hours, 0-23. quiet = reliably below typical; busy = reliably above.',
    method:
      'Aggregated venue foot-traffic observations, refreshed on a rolling schedule. `measured` is the date that venue was last refreshed, not the date of this file.',
    count: places.length,
    places,
  };

  return new Response(JSON.stringify(body, null, 1), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      // A day of edge caching. The underlying numbers move on a rolling refresh
      // measured in weeks, so a consumer polling hourly should not pay for it.
      'cache-control': 'public, max-age=86400',
    },
  });
}
