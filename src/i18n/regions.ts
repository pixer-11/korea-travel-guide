import regionsJson from './regions.json';
import { defaultLang, type Lang } from './ui';

// Curated, specific intros + practical facts for the headline region hubs. Thin
// generic pages don't rank or get cited — these pillar blurbs feed each post
// cluster. English is the source; ko/ja/es/zh live in regions.json (native-quality,
// not literal). Facts inside (airports, KTX times) are stable and human-verified.
export interface RegionInfo {
  blurb: string;
  getting: string;
  days: string;
}

// English source. Kept here (not in the page) so the English route and the
// /[lang]/regions route render from ONE definition — no drift between them.
const REGION_INFO_EN: Record<string, RegionInfo> = {
  Seoul: {
    blurb:
      "Korea's capital pairs 600-year-old Joseon palaces like Gyeongbokgung with neon nightlife in Hongdae and Gangnam. A single T-money card covers the world-class subway, so you can hop from a hanok alley in Bukchon to a night market in one ride.",
    getting: 'Incheon (ICN) and Gimpo (GMP) airports both link to the city by AREX train and subway; central hubs are Seoul Station, Myeongdong, and Hongik University.',
    days: '3–4 days covers the palaces, Bukchon/Insadong, a night market, and a shopping district, with time for a day trip.',
  },
  Busan: {
    blurb:
      "Korea's second city is a laid-back coastal sprawl of beaches (Haeundae, Gwangalli), the hillside art village of Gamcheon, and the country's biggest seafood market at Jagalchi. It's warmer than Seoul and built for slow, salty days by the water.",
    getting: 'Gimhae Airport (PUS) or a ~2.5-hour KTX from Seoul to Busan Station; the metro and buses reach the beaches and markets.',
    days: '2–3 days for the beaches, Gamcheon, Jagalchi, and a temple like Haedong Yonggungsa.',
  },
  Jeju: {
    blurb:
      "A volcanic island off the south coast, Jeju is Korea's beach-and-nature escape — the Hallasan volcano, lava-tube caves, coastal Olle walking trails, and cafés strung along the Aewol coast. It's famous for black pork and its free-diving haenyeo women.",
    getting: 'Jeju (CJU) is a short, high-frequency flight from Seoul (Gimpo) and Busan; rent a car, as public transport is limited.',
    days: '3–4 days to split between the east (Seongsan sunrise peak) and west (Aewol cafés, Hallim) coasts.',
  },
  Gyeongju: {
    blurb:
      'The capital of the Silla kingdom for nearly a thousand years, Gyeongju is often called a "museum without walls" — grassy royal tombs, the UNESCO-listed Bulguksa temple and Seokguram grotto, and the night-lit Donggung Palace and Wolji Pond, all in a walkable, low-rise old town.',
    getting: 'KTX to Singyeongju Station (~2 hours from Seoul), then a bus or taxi into town; easy as a stop between Seoul and Busan.',
    days: '1–2 days covers the tombs, Bulguksa, and Wolji Pond after dark.',
  },
  Incheon: {
    blurb:
      "Most visitors arrive in Korea through Incheon's airport, but the city rewards a stop: a historic Chinatown born of the 1883 open port, the retro Songwol-dong fairy-tale village, and the futuristic waterfront of Songdo.",
    getting: 'Incheon International (ICN) connects to Seoul by AREX; the city subway and Line 1 reach Chinatown (Incheon Station).',
    days: 'A half or full day, easily bolted onto arrival or departure.',
  },
  Jeonju: {
    blurb:
      'Jeonju is Korea\'s food capital and the birthplace of bibimbap, centred on a 700-house Hanok Village of traditional tiled roofs, tea houses, and makgeolli bars. A UNESCO City of Gastronomy, it\'s all about eating your way slowly through the old town.',
    getting: 'KTX to Jeonju Station (~1.5–2 hours from Seoul), then a short bus or taxi to the Hanok Village.',
    days: '1–2 days for the Hanok Village, food alleys, and Nambu Market.',
  },
};

const TRANSLATIONS = regionsJson as Record<string, Partial<Record<Lang, RegionInfo>>>;

// Curated info for a region in a given language. English is the source; other
// languages fall back to English per FIELD-less whole object (a region either has
// a full translation or none). Returns null for regions with no curated info at
// all (they render the generic fallback intro) — same behaviour in every language.
export function getRegionInfo(region: string, lang: Lang): RegionInfo | null {
  const en = REGION_INFO_EN[region];
  if (!en) return null;
  if (lang === defaultLang) return en;
  return TRANSLATIONS[region]?.[lang] ?? en;
}

// The regions that have curated pillar content (used for coverage checks/tests).
export const CURATED_REGIONS = Object.keys(REGION_INFO_EN);
