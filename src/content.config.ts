import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Structured schema keeps AI-written prose separate from HARD FACTS.
// Facts (address, rating, hours) are injected from the Places API and
// validated here — the writer model is never allowed to invent them.
const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    // Global layer: Country → Region → Post. Existing Korea posts default here.
    country: z.string().default('South Korea'),
    region: z.string(), // city/area within the country, e.g. "Seoul", "Busan"
    category: z.enum([
      'attraction',
      'restaurant',
      'hidden-gem',
      'trendy',
      'event',
      'essentials',
    ]),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    // For category:event — the actual event dates (ISO). Drive the "upcoming vs
    // ended" state, hub sorting, and Event schema. Optional so a post without a
    // parseable date simply stays "upcoming" rather than mis-expiring.
    eventStartDate: z.coerce.date().optional(),
    eventEndDate: z.coerce.date().optional(),
    heroImage: z
      .object({
        url: z.string(),
        credit: z.string(),
        license: z.enum(['google-places', 'unsplash', 'wikimedia', 'kto-open', 'placeholder']),
        source: z.string(),
      })
      .optional(),
    // Extra in-body images (a small gallery). Same license rules as hero.
    gallery: z
      .array(
        z.object({
          url: z.string(),
          credit: z.string(),
          license: z.enum(['google-places', 'unsplash', 'wikimedia', 'kto-open', 'placeholder']),
          source: z.string(),
        })
      )
      .default([]),
    // Verified facts pulled from Google Places (never model-generated).
    place: z
      .object({
        id: z.string().optional(), // Google Places id — lets the refresh job re-check this exact venue
        name: z.string().optional(),
        address: z.string().optional(),
        rating: z.number().optional(),
        userRatingsTotal: z.number().optional(),
        priceLevel: z.number().optional(),
        googleMapsUrl: z.string().optional(),
        businessStatus: z.string().optional(),
        lat: z.number().optional(),
        lng: z.number().optional(),
        phone: z.string().optional(),
        openingHours: z.array(z.string()).optional(),
        // Real foot-traffic (BestTime.app) — honest quiet/busy hours, 24h clock.
        // Never model-invented; absent when BestTime has no forecast for a venue.
        busyness: z
          .object({
            updated: z.coerce.date().optional(),
            weekdayQuiet: z.array(z.number()).default([]),
            weekdayBusy: z.array(z.number()).default([]),
            weekendQuiet: z.array(z.number()).default([]),
            weekendBusy: z.array(z.number()).default([]),
            venueId: z.string().optional(),
          })
          .optional(),
      })
      .optional(),
    tags: z.array(z.string()).default([]),
    // Answer-first summary — AI Overviews / LLMs cite concise answers up top.
    quickAnswer: z.string().optional(),
    // FAQ powers both readers and FAQPage structured data (strong AI-citation signal).
    faq: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
    // Transparency: we disclose AI assistance to readers and to Google.
    aiGenerated: z.boolean().default(true),
    draft: z.boolean().default(false),
  }),
});

// Per-country "know before you go" guides, web-researched and refreshed monthly.
// Legal/visa specifics always defer to the official-source links in the body.
const essentials = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/essentials' }),
  schema: z.object({
    country: z.string(),
    title: z.string(),
    description: z.string(),
    lastReviewed: z.coerce.date(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { posts, essentials };
