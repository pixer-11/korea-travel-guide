// Which photo a TOOL hub shares when someone posts its link.
//
// The six tool and itinerary hubs shared /og-default.jpg — the brand card —
// while every post, country and region hub shared a real photograph (found in
// the 2026-09-10 site diagnosis, fixed 09-12). pickOgPhoto cannot help here:
// it ranks a page's CHILDREN by rating, and these hubs either have no posts
// under them or would all rank the same handful of five-star landmarks, so
// four of the six came out holding the same picture of the Colosseum.
//
// So each hub names ONE post whose hero says what the tool is for, and this
// reads that post's CURRENT hero rather than freezing a URL:
//
//   when-to-go    Kenroku-en under cherry blossom     — the season, at a glance
//   best-time     the Trevi Fountain, rimmed by crowd — the busy hour
//   whats-closed  the Louvre at night, courtyard bare — the day it is shut
//   esim          Times Square                        — arriving switched on
//   widget        the Colosseum                       — the crowd chart's subject
//   itinerary     Gamcheon, a village you walk        — a day on foot
//
// Following the post instead of hardcoding the URL matters: heroes get
// replaced by the vision audit and the photo patrols, and a frozen URL would
// keep sharing a picture a person had since rejected. Whatever the post is
// wearing has passed the same gates as everything else on the site.
//
// Every one of the six was looked at by a person before it was chosen — a
// seventh (Tsukiji, 2005, half the frame parked scooters) was rejected on
// sight, which is the whole reason this list is written by hand.
//
// 🛑 The first version read the markdown itself, with
// `readFileSync(fileURLToPath(new URL('../content/posts/' + slug + '.md', import.meta.url)))`.
// That works under `astro dev` and under `node --test` — both run this file
// from source — and returns undefined in the production build, where the
// module has been bundled and import.meta.url no longer points anywhere near
// src/content. It fails SILENTLY, because a missing photo is supposed to fall
// back to the brand card: dev showed six photographs, the deploy shipped six
// brand cards, and the tests passed the whole time (2026-09-12).
//
// It takes the post COLLECTION now — the same objects the page already has
// from getCollection — so there is no filesystem in it at all.
export function heroOf(posts, slug) {
  // Collections have carried ids both with and without the .md suffix across
  // Astro versions, and this repo strips it by hand in several places — match
  // either rather than depend on which one today's build hands over.
  const norm = (v) => String(v ?? '').replace(/\.md$/, '');
  const post = posts?.find?.((p) => norm(p.id) === slug || norm(p.slug) === slug);
  // A draft is off the site; sharing its photo would point at a 301.
  if (!post || post.data?.draft === true) return undefined;
  return post.data?.heroImage?.url || undefined;
}

/** The post each tool hub borrows its share image from. */
export const TOOL_OG = {
  whenToGo: 'kanazawa-kenroku-en',
  bestTime: 'rome-trevi-fountain',
  whatsClosed: 'paris-louvre-museum',
  esim: 'new-york-times-square',
  widget: 'rome-colosseum',
  itinerary: 'busan-gamcheon-culture-village',
};
