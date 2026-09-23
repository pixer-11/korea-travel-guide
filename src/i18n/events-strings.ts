import type { Lang } from './ui';

// Strings for the events hubs redesign (2026-09-24): filter chips, the "on now"
// progress cards and the month rows. Kept out of ui.ts on purpose — parallel
// branches edit that file, and a merge conflict in a 3,000-line dictionary is
// how a language block silently loses a key. events-strings.test.mjs checks
// every key exists, non-empty, in all five languages.
//
// Placeholders: {n} a count, {c} a country count, {p} a percentage.
export const EVENTS_STRINGS = {
  en: {
    statLine: '{c} countries · concerts, sports, festivals — {n} events',
    subscribe: 'Subscribe in your calendar',
    filterLabel: 'Filter events by type',
    countriesLabel: 'Events by country',
    catAll: 'All',
    catConcerts: 'Concerts',
    catSports: 'Sports',
    catFestivals: 'Festivals',
    catExhibitions: 'Exhibitions',
    catOther: 'Other',
    count: '{n} events',
    countOne: '1 event',
    daysLeft: '{n} days left',
    dayLeft: '1 day left',
    lastDay: 'Last day today',
    ended: 'Ended',
    progress: '{p}% of the run has passed',
    noneInFilter: 'No events of this type right now.',
  },
  ko: {
    statLine: '{c}개국 · 콘서트·스포츠·축제 — 이벤트 {n}건',
    subscribe: '내 캘린더에서 구독하기',
    filterLabel: '이벤트 종류로 거르기',
    countriesLabel: '나라별 이벤트',
    catAll: '전체',
    catConcerts: '콘서트',
    catSports: '스포츠',
    catFestivals: '축제',
    catExhibitions: '전시',
    catOther: '기타',
    count: '{n}건',
    countOne: '1건',
    daysLeft: '{n}일 남음',
    dayLeft: '1일 남음',
    lastDay: '오늘이 마지막 날',
    ended: '종료',
    progress: '기간의 {p}% 지남',
    noneInFilter: '지금은 이 종류의 이벤트가 없습니다.',
  },
  ja: {
    statLine: '{c}か国 · コンサート・スポーツ・お祭り — イベント{n}件',
    subscribe: 'カレンダーで購読する',
    filterLabel: 'イベントの種類で絞り込む',
    countriesLabel: '国別のイベント',
    catAll: 'すべて',
    catConcerts: 'コンサート',
    catSports: 'スポーツ',
    catFestivals: 'お祭り',
    catExhibitions: '展示',
    catOther: 'その他',
    count: '{n}件',
    countOne: '1件',
    daysLeft: '残り{n}日',
    dayLeft: '残り1日',
    lastDay: '本日最終日',
    ended: '終了',
    progress: '会期の{p}%が経過',
    noneInFilter: '現在この種類のイベントはありません。',
  },
  es: {
    statLine: '{c} países · conciertos, deportes y festivales — {n} eventos',
    subscribe: 'Suscríbete en tu calendario',
    filterLabel: 'Filtrar eventos por tipo',
    countriesLabel: 'Eventos por país',
    catAll: 'Todos',
    catConcerts: 'Conciertos',
    catSports: 'Deportes',
    catFestivals: 'Festivales',
    catExhibitions: 'Exposiciones',
    catOther: 'Otros',
    count: '{n} eventos',
    countOne: '1 evento',
    daysLeft: 'Quedan {n} días',
    dayLeft: 'Queda 1 día',
    lastDay: 'Hoy es el último día',
    ended: 'Terminado',
    progress: 'Ha transcurrido el {p} % del periodo',
    noneInFilter: 'Ahora mismo no hay eventos de este tipo.',
  },
  zh: {
    statLine: '{c} 个国家 · 音乐会、体育、节庆 — 共 {n} 场活动',
    subscribe: '在日历中订阅',
    filterLabel: '按类型筛选活动',
    countriesLabel: '按国家查看活动',
    catAll: '全部',
    catConcerts: '音乐会',
    catSports: '体育',
    catFestivals: '节庆',
    catExhibitions: '展览',
    catOther: '其他',
    count: '{n} 场',
    countOne: '1 场',
    daysLeft: '还剩 {n} 天',
    dayLeft: '还剩 1 天',
    lastDay: '今天是最后一天',
    ended: '已结束',
    progress: '已进行 {p}%',
    noneInFilter: '目前没有此类活动。',
  },
};

export type EventsStringKey = keyof (typeof EVENTS_STRINGS)['en'];

/** Translator for the events hubs, English fallback; `vars` fills {n}/{c}/{p}. */
export function evStrings(lang: Lang) {
  const table = (EVENTS_STRINGS as Record<string, Record<string, string>>)[lang] ?? EVENTS_STRINGS.en;
  return (key: EventsStringKey, vars: Record<string, string | number> = {}): string => {
    let s = table[key] ?? EVENTS_STRINGS.en[key];
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
  };
}
