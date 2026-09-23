import type { Lang } from './ui';

// Strings the 2026-09-24 country-hub redesign added (DestinationHub.astro).
//
// Kept OUT of ui.ts on purpose: several redesign branches edit ui.ts at the same
// time, and five parallel inserts into the same five language blocks is a merge
// conflict every time. Everything the hub already had (dest.whereToGo,
// dest.latest, itin.*, home.guides …) still comes from ui.ts via t().
//
// Every value here is chrome, never a fact. The numbers, months and names that
// fill the {placeholders} are computed from repo data by the component.
// dest-hub-strings.test.mjs fails if a key is missing from any language.
export const DEST_HUB_STRINGS = {
  en: {
    // home.guides reads "1 guides" in English; the singular, for cities with one.
    oneGuide: '1 guide',
    h1: '{country} travel guide',
    cellBest: 'Best months',
    cellBestSub: 'By {city} climate',
    cellEventsMonth: 'Events in {month}',
    cellEventsUpcoming: 'Upcoming events',
    cellEventsSub: 'See the calendar',
    cellEventsNext: 'Next: {name}',
    cellEsim: 'Stay connected',
    cellEsimValue: 'eSIM guide',
    cellEsimSub: 'eSIM vs WiFi vs roaming',
    cellEntry: 'Entry & essentials',
    cellEntryValue: 'Visa · money · transport',
    cellEntrySub: 'With official sources',
    moreCities: 'More cities',
    all: 'All →',
    reviews: '{n} reviews',
    summaryLabel: '{country} at a glance',
  },
  ko: {
    oneGuide: '가이드 1편',
    h1: '{country} 여행 가이드',
    cellBest: '가기 좋은 달',
    cellBestSub: '{city} 기후 기준',
    cellEventsMonth: '{month} 이벤트',
    cellEventsUpcoming: '다가오는 이벤트',
    cellEventsSub: '일정 보기',
    cellEventsNext: '다음: {name}',
    cellEsim: '데이터 연결',
    cellEsimValue: 'eSIM 가이드',
    cellEsimSub: 'eSIM·포켓와이파이·로밍 비교',
    cellEntry: '입국·필수 정보',
    cellEntryValue: '비자 · 돈 · 교통',
    cellEntrySub: '공식 출처와 함께',
    moreCities: '더 많은 도시',
    all: '전체 보기 →',
    reviews: '리뷰 {n}개',
    summaryLabel: '{country} 한눈에 보기',
  },
  ja: {
    oneGuide: 'ガイド1本',
    h1: '{country}旅行ガイド',
    cellBest: 'ベストシーズン',
    cellBestSub: '{city}の気候から',
    cellEventsMonth: '{month}のイベント',
    cellEventsUpcoming: '今後のイベント',
    cellEventsSub: 'カレンダーを見る',
    cellEventsNext: '次: {name}',
    cellEsim: 'ネット接続',
    cellEsimValue: 'eSIMガイド',
    cellEsimSub: 'eSIM・WiFi・ローミング比較',
    cellEntry: '入国・基本情報',
    cellEntryValue: 'ビザ・お金・交通',
    cellEntrySub: '公式情報つき',
    moreCities: 'その他の都市',
    all: 'すべて見る →',
    reviews: 'レビュー{n}件',
    summaryLabel: '{country}の概要',
  },
  es: {
    oneGuide: '1 guía',
    h1: 'Guía de viaje de {country}',
    cellBest: 'Mejores meses',
    cellBestSub: 'Según el clima de {city}',
    cellEventsMonth: 'Eventos en {month}',
    cellEventsUpcoming: 'Próximos eventos',
    cellEventsSub: 'Ver el calendario',
    cellEventsNext: 'Próximo: {name}',
    cellEsim: 'Conectividad',
    cellEsimValue: 'Guía de eSIM',
    cellEsimSub: 'eSIM vs WiFi vs roaming',
    cellEntry: 'Entrada y esenciales',
    cellEntryValue: 'Visado · dinero · transporte',
    cellEntrySub: 'Con fuentes oficiales',
    moreCities: 'Más ciudades',
    all: 'Ver todo →',
    reviews: '{n} reseñas',
    summaryLabel: '{country} de un vistazo',
  },
  zh: {
    oneGuide: '1 篇指南',
    h1: '{country}旅游指南',
    cellBest: '最佳月份',
    cellBestSub: '依据{city}气候',
    cellEventsMonth: '{month}活动',
    cellEventsUpcoming: '即将举行的活动',
    cellEventsSub: '查看日程',
    cellEventsNext: '下一场：{name}',
    cellEsim: '上网',
    cellEsimValue: 'eSIM 指南',
    cellEsimSub: 'eSIM、随身WiFi与漫游对比',
    cellEntry: '入境与必备信息',
    cellEntryValue: '签证 · 货币 · 交通',
    cellEntrySub: '附官方来源',
    moreCities: '更多城市',
    all: '查看全部 →',
    reviews: '{n}条评价',
    summaryLabel: '{country}概览',
  },
} as const;

export type DestHubKey = keyof (typeof DEST_HUB_STRINGS)['en'];

/**
 * Translator for the hub's new strings, with {name} placeholders filled.
 * Falls back to English only if a key were ever missing — the test makes sure
 * it never is.
 */
export function destHubT(lang: Lang) {
  return (key: DestHubKey, vars: Record<string, string | number> = {}): string => {
    const table = (DEST_HUB_STRINGS[lang] ?? DEST_HUB_STRINGS.en) as Record<string, string>;
    const raw = table[key] ?? DEST_HUB_STRINGS.en[key];
    return Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), raw);
  };
}
