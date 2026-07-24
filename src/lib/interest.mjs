// Pure: turn page context into the field values the signup form submits.
// Region is a stable lowercase slug so it matches the newsletter audience keys.
export function interestFields({ region = '', country = '', lang, source = '' }) {
  const slug = String(region).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return { region: slug, lang, source };
}
