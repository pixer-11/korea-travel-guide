// Typed door onto src/lib/dayTrips.mjs, where the gates, the distance maths and
// the "day trips from Bangkok" rationale live. The computation moved there on
// 2026-09-07 so astro.config.mjs could call the SAME graph to date these hubs in
// the sitemap: a day-trip page shows its NEIGHBOURS' guides, so nothing but this
// graph knows when one of them last changed, and a second copy of the gates in
// the config is the fourth-copy mistake that left three region hubs dated at a
// URL no route builds.
//
// A wrapper rather than a bare re-export, so callers keep the real types under
// strict TS instead of the `any` a .mjs import infers.
import { buildDayTrips as build } from './dayTrips.mjs';

type Post = { id: string; data: any };

export interface DayTripNeighbor {
  region: string;
  km: number;
  posts: Post[];
  total: number;
}
export interface DayTripHub {
  city: string;
  slug: string;
  country: string;
  neighbors: DayTripNeighbor[];
}

export function buildDayTrips(posts: Post[]): DayTripHub[] {
  return build(posts) as DayTripHub[];
}
