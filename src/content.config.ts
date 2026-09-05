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
    // Does this event come back every year? Answered by the web search that
    // discovered it, because the title alone cannot say: "Lollapalooza" and
    // "Tour de France" carry no word that marks them annual, and the keyword
    // heuristic they used to rely on read them as one-offs and dropped them
    // from the index the day they ended. Absent on posts written before
    // 2026-08-06, which still fall back to that heuristic.
    eventRecurring: z.boolean().optional(),
    // The event's REAL organiser, only when verified from an official source
    // (GSC flagged the field's absence 2026-08-08). We used to stamp Wander
    // Atlas here across 98 events — a machine-readable false claim, removed
    // 2026-08-07. Absent beats invented: never fill this from guesswork.
    eventOrganizer: z.object({ name: z.string(), url: z.string().optional() }).optional(),
    // How to get in. Google names offers as a recommended Event property and
    // GSC flags its absence; the answer is the same as for the organizer —
    // verified or nothing. Deliberately NO price for paid events: ticket
    // prices move weekly and tier out, and a rotted number is worse than an
    // absent one. `free` (with the country's currency, so price 0 is valid
    // schema) is the one value that cannot go stale.
    eventOffers: z.object({
      url: z.string().optional(),
      free: z.boolean().optional(),
      currency: z.string().optional(),
    }).optional(),
    // The named act, only when the event IS that act performing. Festival
    // line-ups are excluded on purpose: a recurring event page outlives the
    // line-up printed on it, so storing one turns a true fact into a false
    // one by doing nothing at all.
    eventPerformer: z.object({ name: z.string(), kind: z.enum(['person', 'group']) }).optional(),
    // Stamped by backfill-event-offers.mjs whether or not it found anything,
    // so an unsettled event is never paid for a second time.
    eventFactsAsked: z.boolean().optional(),
    // Where it happens (stadium, arena, circuit, park). Captured at discovery;
    // the photo pipeline's second search key after the act itself — an event
    // named only in generic words ("Formula 1 Italian Grand Prix") has no act
    // anchor at all, but its venue (Autodromo Nazionale Monza) is on Commons.
    eventVenue: z.string().optional(),
    heroImage: z
      .object({
        url: z.string(),
        credit: z.string(),
        // 'editor': shot in person by the site's editor (first two: Yakiuo
        // Ishikawa + La Scène, HCMC, 2026-08-15). Served from /editor-photos/,
        // identity proven by the photograph itself, credit "Photo: Pixer".
        license: z.enum(['google-places', 'unsplash', 'wikimedia', 'kto-open', 'placeholder', 'foursquare', 'flickr-cc', 'openverse-cc', 'editor']),
        source: z.string(),
        // Where the subject IS, as % from top-left — reported by the vision
        // gate when it approves the photo, consumed as object-position by the
        // 16:9 hero frame. Without it a portrait crops centre-on and a
        // performer's face falls out of the frame (The Weeknd / Post Malone,
        // 2026-08-15). Optional: older heroes fall back to a top-weighted
        // default for portraits.
        // top/bottom (2026-08-23): the head box the gate measured — hair to
        // chin, % from the top. x/y is its centre. Card thumbnails keep the
        // box inside their window; older heroes carry the point only.
        focus: z
          .object({
            x: z.number().min(0).max(100),
            y: z.number().min(0).max(100),
            top: z.number().min(0).max(100).optional(),
            bottom: z.number().min(0).max(100).optional(),
          })
          .optional(),
      })
      .optional(),
    // Extra in-body images (a small gallery). Same license rules as hero.
    gallery: z
      .array(
        z.object({
          url: z.string(),
          credit: z.string(),
          // 'editor': shot in person by the site's editor (first two: Yakiuo
        // Ishikawa + La Scène, HCMC, 2026-08-15). Served from /editor-photos/,
        // identity proven by the photograph itself, credit "Photo: Pixer".
        license: z.enum(['google-places', 'unsplash', 'wikimedia', 'kto-open', 'placeholder', 'foursquare', 'flickr-cc', 'openverse-cc', 'editor']),
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
        // Hours are absent ON PURPOSE — Google filed a different entity's
        // schedule under this place (Bromo, 2026-08-14: the park office's
        // weekday desk hours on a pre-dawn sunrise attraction). The value is
        // the human-readable reason; while present, every hours writer
        // (backfill-place-details, refresh) must leave openingHours alone.
        hoursOmitted: z.string().optional(),
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
    // Deliberately published without a hero, after every free photo source came
    // back empty for a week. Distinguishes "we decided this guide is worth more
    // than its missing picture" from "the pipeline dropped the photo" — the
    // content validator requires a hero on everything else, and must keep doing
    // so for new posts. Cleared automatically when the patrol finally attaches
    // a verified photo.
    photoless: z.boolean().default(false),
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
    // Per-section review dates (scripts/add-essentials-section.mjs). The
    // file-level lastReviewed still means "the whole guide was re-researched".
    sectionsReviewed: z.record(z.string(), z.coerce.date()).optional(),
    draft: z.boolean().default(false),
  }),
});

// Translated post TEXT (ko/ja/es/zh), one file per language per post at
// src/content/i18n/<lang>/<post-id>.md. Deliberately stores ONLY prose — the
// hard facts (place, rating, address, hours, images, dates) are always read from
// the original English post at render time, so a translation can never drift from
// or contradict the verified Places data. Written by scripts/translate-posts.mjs.
const postI18n = defineCollection({
  // generateId keeps the language folder in the id ("ko/seoul-…"), otherwise every
  // language's copy of a post collapses to the same id and they overwrite each other.
  loader: glob({
    pattern: '**/*.md',
    base: './src/content/i18n',
    generateId: ({ entry }) => entry.replace(/\.md$/, ''),
  }),
  schema: z.object({
    lang: z.enum(['ko', 'ja', 'es', 'zh']),
    slug: z.string(), // id of the source post in the `posts` collection
    title: z.string(),
    description: z.string(),
    quickAnswer: z.string().optional(),
    faq: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
    // Set when a re-translation is needed because the English post changed.
    sourceUpdated: z.string().optional(),
    // sha1 (12 hex chars) of the English source's translatable fields at the
    // time this file was written. translate-posts.mjs re-queues the file when
    // the live source no longer matches — without it, a source edit never
    // propagated to translations.
    srcHash: z.string().optional(),
  }),
});

// Translated per-country essentials TEXT (ko/ja/es/zh). Same design as postI18n:
// prose only; the English source keeps the authority (official links, lastReviewed).
const essentialsI18n = defineCollection({
  loader: glob({
    pattern: '**/*.md',
    base: './src/content/essentials-i18n',
    generateId: ({ entry }) => entry.replace(/\.md$/, ''),
  }),
  schema: z.object({
    lang: z.enum(['ko', 'ja', 'es', 'zh']),
    slug: z.string(), // id of the source essentials entry (country slug)
    title: z.string(),
    description: z.string(),
  }),
});

// Pre-generated itinerary pages (spec 2026-07-27). Stores ONLY structure + AI
// connective prose keyed by post slug — every hard fact (rating/hours/coords/
// quiet times) is read from the source post at render time, so an itinerary can
// never contradict or outlive the verified data. Built by scripts/build-itineraries.mjs.
const itineraries = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/itineraries' }),
  schema: z.object({
    city: z.string(),          // display region name, e.g. "Seoul" (matches posts' region)
    country: z.string(),
    days: z.number().int().min(1).max(7),
    title: z.string(),
    description: z.string(),
    quickAnswer: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    stopsHash: z.string(),     // sha1 of ordered stop slugs — regen/retranslate trigger
    packedAvailable: z.boolean().default(false), // gate ≥15 (filter option visibility)
    faq: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
    itinerary: z.array(z.object({
      label: z.string(),       // AI: "Palaces & hanok lanes"
      intro: z.string(),       // AI connective prose for the day
      stops: z.array(z.object({
        slug: z.string(),      // MUST resolve to a live post — validator enforces
        slot: z.enum(['morning', 'lunch', 'afternoon', 'evening']),
        why: z.string(),       // AI 1-2 sentences, facts injected from the post
        dwellMin: z.number(),
        // minutes is nullable: transit legs deliberately carry no invented ETA
        // (src/lib/itinerary.mjs walkLeg() — the page links Google Maps for real
        // routing instead of promising a number we can't stand behind).
        walkToNext: z.object({ km: z.number(), minutes: z.number().nullable(), transit: z.boolean() }).nullable(),
      })),
      rainSwapSlug: z.string().nullable().default(null),
    })),
    aiGenerated: z.boolean().default(true),
    draft: z.boolean().default(false),
  }),
});
// Translated itinerary PROSE (same design as postI18n: facts stay in EN sources).
const itinerariesI18n = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/itineraries-i18n',
    generateId: ({ entry }) => entry.replace(/\.md$/, '') }),
  schema: z.object({
    lang: z.enum(['ko', 'ja', 'es', 'zh']),
    slug: z.string(),
    sourceHash: z.string(),    // copy of stopsHash at translation time — staleness check
    title: z.string(), description: z.string(), quickAnswer: z.string(),
    faq: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
    days: z.array(z.object({ label: z.string(), intro: z.string() })),
    whys: z.record(z.string(), z.string()).default({}),      // slug → translated why
    rainWhys: z.record(z.string(), z.string()).default({}),  // slug → translated swap note
  }),
});

// The 5 cross-country "topic" hubs (visa/transport/money/best-time/emergency).
// English source lives here as structured content; the localized copies live in
// essentialsTopicsI18n (translated by scripts/translate-topics.mjs).
const topicShape = {
  metaTitle: z.string(),
  metaDescription: z.string(),
  h1: z.string(),
  dek: z.string(),
  quickAnswer: z.string(),
  countryHeading: z.string(),
  breadcrumbName: z.string(),
  disclosure: z.string(),
  faq: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
};
const essentialsTopics = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/essentials-topics' }),
  schema: z.object({ icon: z.string(), ...topicShape }),
});
const essentialsTopicsI18n = defineCollection({
  loader: glob({
    pattern: '**/*.md',
    base: './src/content/essentials-topics-i18n',
    generateId: ({ entry }) => entry.replace(/\.md$/, ''),
  }),
  // srcHash: same staleness fingerprint as postI18n (translate-topics.mjs, 2026-09-02).
  schema: z.object({ lang: z.enum(['ko', 'ja', 'es', 'zh']), slug: z.string(), srcHash: z.string().optional(), ...topicShape }),
});

// Static prose pages (about/privacy/terms) as content, so they can be translated.
const staticShape = {
  metaTitle: z.string(),
  metaDescription: z.string(),
  eyebrow: z.string(),
  h1: z.string(),
  lastUpdated: z.string().optional(),
};
const staticPages = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/static-pages' }),
  schema: z.object(staticShape),
});
const staticPagesI18n = defineCollection({
  loader: glob({
    pattern: '**/*.md',
    base: './src/content/static-pages-i18n',
    generateId: ({ entry }) => entry.replace(/\.md$/, ''),
  }),
  // srcHash: same staleness fingerprint as postI18n (translate-static.mjs, 2026-09-02).
  schema: z.object({ lang: z.enum(['ko', 'ja', 'es', 'zh']), slug: z.string(), srcHash: z.string().optional(), ...staticShape }),
});

export const collections = { posts, essentials, postI18n, essentialsI18n, itineraries, itinerariesI18n, essentialsTopics, essentialsTopicsI18n, staticPages, staticPagesI18n };
