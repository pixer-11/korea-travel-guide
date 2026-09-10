// ─────────────────────────────────────────────────────────────
//  HOW EACH LANGUAGE SAYS "IS SCHEDULED FOR".
//
//  Lives here, not inside the checker, because a checker that imports its own
//  script re-runs it (scripts/*.mjs execute on import). Nothing tested this
//  list while it was in there, and on 2026-09-10 that cost us: the checker
//  scanned every finished event and every translation, reported ZERO, and 19
//  Chinese events were advertising themselves as upcoming in the meta
//  description and the JSON-LD — on the language Bing sends most of our
//  traffic from. The missing word was 定于, the ordinary way Chinese says "is
//  set for". The list only had the explicitly future 将于 / 将在 / 即将.
//
//  The past forms the repair writes CONTAIN the present ones: 原定于 and 此前定于
//  both contain 定于, so a bare 定于 would re-flag every file it had just fixed
//  and the repair would run forever. The lookbehind excludes 原 and 前, which
//  is what those two prefixes end in. A test asserts the past forms stay quiet.
//
//  A vocabulary is not a rule. It finds what someone thought of, so the test
//  beside this file asserts that every entry still fires on a real sentence —
//  an untested verb list is a list that can quietly go empty.
// ─────────────────────────────────────────────────────────────

// Verbs that put a finished event in the present or the future. Each is the
// ordinary way that language announces a scheduled event, which is exactly why
// they are wrong once it is over.
export const UPCOMING = {
//
// 2026-09-10: this list was the reason a clean verdict meant nothing. It scanned
// every finished event and every translation — the census was right — and still
// reported zero while 19 Chinese events advertised themselves as upcoming, in
// the meta description and the JSON-LD, on the language Bing sends most of our
// traffic from. The missing word was 定于, which is simply how Chinese says
// "is set for"; the list had only the explicitly FUTURE 将于/将在/即将. Korean
// was missing the connective form 열릴 예정이며 (the list had only the final
// 열릴 예정입니다), and Spanish had no bare present 「se celebra + a date」.
//
// A vocabulary is not a rule: it can only find what someone thought of. So each
// language now also carries what the repair pass rewrites TO, and the test file
// asserts every entry fires on a real sentence — an untested verb list is a
// list that can quietly go empty.
  ko: [/열립니다/g, /진행됩니다/g, /개최됩니다/g, /열릴 예정입니다/g, /열릴 예정이며/g, /열릴 예정이고/g, /개최됩니다/g, /진행될 예정입니다/g, /진행될 예정이며/g],
  ja: [/開催されます/g, /行われます/g, /予定です/g, /開催予定です/g, /開催されます/g],
  es: [/se celebrará/gi, /tendrá lugar/gi, /se llevará a cabo/gi, /se celebra del/gi, /se celebra el/gi],
  zh: [/将于/g, /将在/g, /即将/g, /(?<![原前])定于/g, /(?<![原前])确定于/g, /将担任/g],
};