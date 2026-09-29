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

// The text of a translated post that the UPCOMING vocabulary may be run over.
//
// FAQ QUESTIONS are left out, on purpose. The English rules keep a question in
// the present tense — the editorial repair on 2026-09-20 rewrote all five
// ANSWERS of the Hanoi Jazztival guide and deliberately left "Where does Hanoi
// Jazztival 2026 take place?" alone, because a question about a past event
// still reads that way. The Spanish translator mirrored it faithfully as
// "¿Dónde se celebra el Hanoi Jazztival 2026?", the guard matched "se celebra
// el", and the file failed three attempts in a row over a sentence the English
// is allowed to have.
//
// audit-ended-event-tense-i18n has skipped q: lines since it was written, for
// the same reason. The guard inside translate-posts said it used "the same
// vocabulary the audit uses, so the two cannot drift apart" — and then drifted
// on scope rather than vocabulary. This is the one place that decides scope.
export function upcomingText(out) {
  const answers = Array.isArray(out?.faq) ? out.faq.map((f) => f?.a).filter(Boolean) : [];
  return [out?.title, out?.description, out?.quickAnswer, out?.body, ...answers]
    .filter(Boolean)
    .join('\n');
}

// A sentence about how such events USUALLY go is not about this edition, and
// the English rules keep it in the present ("the programme usually runs across
// a single day"). Korean renders that "보통 하루 동안 진행됩니다", which the
// vocabulary above matched: on 2026-09-29 the Bhubaneswar athletics guide
// failed three attempts in a row over that one true sentence, and the plainer
// prompt of the same day made such sentences common. Judged sentence by
// sentence, like ENDED_HISTORY in translate-posts.
// A recurring rule is a norm too: "La Tomatina falls on the last Wednesday of
// August" came back as "se celebra el último miércoles de agosto" and failed
// three attempts (2026-09-29). An ordinal weekday is a rule; this edition's
// date ("el 26 de agosto") still is not exempt.
export const GENERIC = {
  ko: /보통|대개|일반적으로|흔히|대체로|통상|매년|해마다/,
  ja: /通常|一般的に|たいてい|普通は|多くの場合|毎年|例年/,
  es: /normalmente|habitualmente|por lo general|suele|suelen|generalmente|cada año|todos los años|se celebra el (?:último|primer|segundo|tercer|cuarto)\b/i,
  // Not a bare 一般: 一般门票 is a ticket type, and "本届的一般门票将于9月1日发售"
  // is this edition's future (Codex, 2026-09-29).
  zh: /通常|一般来说|一般而言|往往|大多数情况下|每年|历年/,
};

// A clause that names THIS occasion — a year, a day of a month, "this year",
// "this edition" — is not a general norm whatever marker it carries:
// "매년 열리는 이 축제의 2026년 행사는 8월 11일에 열립니다", "通常とは異なり今年の
// 公演は…", "se celebra el primer día del festival (20 de septiembre de 2026)"
// are all this edition's tense error (Codex, 2026-09-29).
const SPECIFIC = /20\d\d|\d{1,2}\s*월\s*\d{1,2}\s*일|\d{1,2}\s*月\s*\d{1,2}\s*[日号]|\b\d{1,2} de [a-záéíóú]+|올해|이번 ?(?:대회|행사|공연|축제|회차)|今年|今回|本届|本次|今年度|esta edición|este año/i;

/** UPCOMING matches in `out`, skipping sentences that state a general norm. */
export function upcomingHits(out, lang) {
  const vocab = UPCOMING[lang] ?? [];
  const generic = GENERIC[lang];
  const hits = [];
  // Clauses, not sentences: "입장은 보통 두 시간 전부터이며, 이번 공연은 9월 20일에
  // 열립니다" carries the norm and this edition's error in one sentence, and a
  // sentence-wide exemption let the error through (Codex, 2026-09-29). Cutting
  // at commas too can only cost a retry on a norm split from its verb — the safe
  // direction.
  // A clause that ENDS on the marker ("この種の大会は通常、", "一般来说，",
  // "Normalmente,") opens the clause after it, so that one is exempt too.
  const endsOnMarker = generic && new RegExp(`(?:${generic.source})[\\s,;，；、]*$`, generic.flags.replace('g', ''));
  let carry = false;
  for (const sentence of upcomingText(out).split(/(?<=[.。!?！？,;，；、])\s*|\n+/)) {
    const specific = SPECIFIC.test(sentence);
    const isNorm = !!(generic && generic.test(sentence)) && !specific;
    const exempt = isNorm || (carry && !specific);
    carry = isNorm && endsOnMarker.test(sentence);
    if (exempt) continue;
    for (const re of vocab) {
      const m = sentence.match(new RegExp(re.source, re.flags.replace('g', '')));
      if (m) hits.push(m[0]);
    }
  }
  // The vocabulary lists a few verbs twice (개최됩니다, 開催されます).
  return [...new Set(hits)];
}

// ─────────────────────────────────────────────────────────────
//  THE OPPOSITE FAILURE: "SCHEDULED" SAID OVER AND OVER.
//
//  2026-09-29: the prompt told Korean to render EVERY scheduling statement as
//  "…열릴 예정이었습니다", so a single description read "바르셀로나의 라 메르세
//  축제는 9월 20–24일에 열릴 예정이었습니다. 어떤 축제인지, 언제 어디서 열릴
//  예정이었는지…". Stacked like that, Korean reads as a plan that fell through —
//  픽서님 read the Verona opera festival (which ran to its last night) as
//  cancelled. Census that day: 31 ko, 22 ja, 6 zh, 1 es of 181 finished events.
//
//  The rule is "say the schedule once, then write a plain record". This finds a
//  unit (title, description, quick answer, one FAQ answer, one body paragraph)
//  that says it twice, and the Korean adnominal 열릴 예정이었던 even once — "the
//  X that was to be held" is how Korean introduces something that did not happen.
// ─────────────────────────────────────────────────────────────
export const PLANNED = {
  ko: /예정/g,
  ja: /予定/g,
  // Word-bounded: without it "imprevistos" (the unforeseen) counted as a second
  // "previsto" and sent a clean translation back twice (Codex, 2026-09-29).
  es: /\b(?:previst|programad)[oa]s?\b/gi,
  zh: /原定|预定|计划于/g,
};
export const READS_CANCELLED = {
  ko: /(?:열릴|개최될|진행될|펼쳐질) 예정이었던/,
};

/** First unit that stacks the "scheduled" word, as { unit, text }, or null. */
export function stackedSchedule(out, lang) {
  const re = PLANNED[lang];
  if (!re) return null;
  const answers = Array.isArray(out?.faq) ? out.faq.map((f) => f?.a).filter(Boolean) : [];
  const paras = String(out?.body || '').split(/\n\s*\n/);
  const units = [
    ['title', out?.title], ['description', out?.description], ['quickAnswer', out?.quickAnswer],
    ...answers.map((a, i) => [`faq${i + 1}`, a]),
    ...paras.map((p, i) => [`body¶${i + 1}`, p]),
  ];
  for (const [unit, text] of units) {
    if (!text) continue;
    const s = String(text);
    if ((s.match(new RegExp(re.source, re.flags)) || []).length >= 2) return { unit, text: s };
    if (READS_CANCELLED[lang]?.test(s)) return { unit, text: s };
  }
  return null;
}
