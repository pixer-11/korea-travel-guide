// The one reader of a post's hero image URL.
//
// 2026-08-19: `loadUsedImageUrls` — the set that stops two posts from sharing a
// photo — read the hero with a regex for the FIRST `  url:` line in the file.
// That regex was wrong twice over:
//
//   1. A folded scalar (`url: >-` with the URL on the next line) captured the
//      literal string ">-". 106 live posts registered ">-" instead of their hero,
//      so their photos looked unclaimed to every picker.
//   2. When a post puts `officialLink.url` ABOVE heroImage — field order varies,
//      gray-matter round-trips reorder — the first match was the ticket site.
//      7 more posts, wuhan-2026-wuhan-open-snooker among them.
//
// Net effect: ~113 heroes were invisible to duplicate avoidance, and the daily
// patrol handed the same snooker-table photo to Taiyuan and Wuhan.
//
// validate-content already learned this lesson (see its parsePost comment: "a
// regex can't read a `credit: >-` folded scalar or a quoted URL reliably") and
// switched to gray-matter. The audit and the prevention now read the hero the
// same way — one juror, not two.
import matter from 'gray-matter';

/** Hero image URL of a post's raw file text, or null. */
export function heroUrlOf(src) {
  let data;
  try {
    data = matter(String(src ?? '')).data;
  } catch {
    return null; // unparseable frontmatter — validate-content reports it separately
  }
  const u = data?.heroImage?.url;
  return typeof u === 'string' && u.trim() ? u.trim() : null;
}
