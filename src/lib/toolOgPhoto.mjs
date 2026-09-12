import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

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
export function toolOgPhoto(slug) {
  try {
    const path = fileURLToPath(new URL(`../content/posts/${slug}.md`, import.meta.url));
    const { data } = matter(readFileSync(path, 'utf8'));
    // A draft is off the site; sharing its photo would point at a 301.
    if (data?.draft === true) return undefined;
    return data?.heroImage?.url || undefined;
  } catch {
    // Post renamed or retired → undefined, and BaseLayout falls back to the
    // brand card exactly as before. A missing photo must never fail a build.
    return undefined;
  }
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
