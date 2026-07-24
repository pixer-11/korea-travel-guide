// Pure: group MailerLite subscribers into send audiences. Each subscriber lands in
// exactly one audience (→ exactly one email/week). Region comes from fields.region
// (comma-separated slugs, or empty / "__global__" for the Editor's Picks edition);
// language from fields.lang (default "en"). Audiences are split by language.
const LANGS = new Set(['en', 'ko', 'ja', 'es', 'zh']);

function parseRegions(raw) {
  const list = String(raw || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const real = list.filter((r) => r && r !== '__global__');
  return real;
}

export function bucketSubscribers(subscribers) {
  const map = new Map();
  for (const s of subscribers) {
    const f = s.fields || {};
    const lang = LANGS.has(f.lang) ? f.lang : 'en';
    const regions = parseRegions(f.region);
    let type, regionKey, regionList;
    if (regions.length === 0) { type = 'global'; regionKey = '__global__'; regionList = []; }
    else if (regions.length === 1) { type = 'single'; regionKey = regions[0]; regionList = regions; }
    else { type = 'multi'; regionList = [...regions].sort(); regionKey = regionList.join('+'); }
    const key = `${regionKey}:${lang}`;
    if (!map.has(key)) map.set(key, { key, type, regions: regionList, lang, subscriberIds: [] });
    map.get(key).subscriberIds.push(s.id);
  }
  return [...map.values()];
}
