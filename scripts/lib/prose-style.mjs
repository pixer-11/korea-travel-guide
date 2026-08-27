// House rules for English prose the model writes for readers.
//
// One home, because the alternative was proven: on 2026-08-27 the site's 1,461
// English guides carried 15,726 em-dashes, and the cause was that writer.mjs's
// prompt used 28 of its own — the model copied the punctuation of the
// instruction. Fixing that one prompt only fixes the guides. Itineraries, region
// intros, essentials, titles and prose repairs each write their own English from
// their own prompt, and a rule pasted into six files drifts in six directions.
//
// Append to the system prompt of anything that produces reader-facing English.

// The em-dash is the loudest machine-written tell in English prose, and the one
// readers name unprompted. Stated as a rule rather than demonstrated by absence,
// because an instruction outranks an example the model has to infer.
export const NO_EM_DASH =
  'PUNCTUATION: use commas, colons, semicolons and full stops. Do NOT use em-dashes (—) or en-dashes ' +
  'between clauses. Readers have learned to read them as machine-written. A sentence that seems to need one ' +
  'is almost always two sentences, or wants a colon. Ranges keep their dash (9am–11am, 2–4 days).';

// Everything a reader-facing English prompt should carry. Kept as one export so a
// caller adds a line, not a checklist, and a future rule reaches every generator
// the moment it lands here.
export const HOUSE_STYLE = NO_EM_DASH;
