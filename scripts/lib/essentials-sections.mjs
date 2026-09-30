// Section handling for the essentials guides (scripts/build-essentials.mjs).
// Pure, so it can be tested without running the writer.

export const REQUIRED_H2 = [
  '## Visa & entry', '## Getting around', '## Money & costs',
  '## Best time to visit', '## Emergencies & safety', '## Official sources',
];

// The guide split at its H2s: [{ h, text }], the text before the first H2
// (the Quick answer) under h ''. Used to carry the existing guide forward.
export function splitSections(body) {
  const out = [];
  for (const part of body.split(/\n(?=## )/)) {
    const h = part.startsWith('## ') ? part.split('\n')[0].trim() : '';
    out.push({ h, text: part.replace(/\s+$/, '') });
  }
  return out;
}

// Sections this script does not write (e.g. "## Luggage storage", added one at
// a time by add-essentials-section.mjs with their own sources) go back into the
// rewritten guide in the place they held. Until 2026-09-30 a rewrite simply
// dropped them: adding Australia on 09-28 re-ran this for every guide older
// than REFRESH_DAYS, and four source-checked luggage sections vanished from
// twenty pages without a word.
export function carryExtraSections(oldBody, newBody) {
  const old = splitSections(oldBody);
  // The carried section always wins: its review date travels with it, so a
  // same-named section the model wrote on its own must not replace it.
  const carried = new Set(old.filter((s) => s.h && !REQUIRED_H2.includes(s.h)).map((s) => s.h));
  let sections = splitSections(newBody).filter((n) => !carried.has(n.h));
  for (let i = 0; i < old.length; i++) {
    const s = old[i];
    if (!carried.has(s.h)) continue;
    // Before the heading that followed it last time, if the new guide has it.
    const next = old.slice(i + 1).find((n) => REQUIRED_H2.includes(n.h))?.h ?? '## Official sources';
    let at = sections.findIndex((n) => n.h === next);
    if (at < 0) at = sections.findIndex((n) => n.h === '## Official sources');
    sections.splice(at < 0 ? sections.length : at, 0, s);
  }
  return sections.map((s) => s.text).join('\n\n');
}

// The guide with only the sections build-essentials writes (plus the Quick
// answer): what the model is shown as its starting point. Extra sections stay
// out of the prompt so they cannot be rewritten; carryExtraSections puts them
// back afterwards.
export function requiredOnly(body) {
  return splitSections(body).filter((s) => !s.h || REQUIRED_H2.includes(s.h)).map((s) => s.text).join('\n\n');
}
