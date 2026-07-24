// Pure: turn page context into the field values the signup form submits.
// Region is a stable lowercase slug so it matches the newsletter audience keys.
import { slugify } from '../../scripts/lib/slugify.mjs';

export function interestFields({ region = '', country = '', lang, source = '' }) {
  const slug = region ? slugify(region) : '';
  return { region: slug, lang, source };
}
