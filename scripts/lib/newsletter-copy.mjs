export const LANGS = ['en', 'ko', 'ja', 'es', 'zh'];

const COPY = {
  en: { subjectSingle: 'This week in {region}', preheaderSingle: 'New guides from {region}, just published →', editorNote: "Every week we send you only the new guides from the place you follow. Here's {region}, freshly published.", sectionLabel: "This week's guides", eventsLabel: 'Upcoming events', ctaSingle: 'Explore all {region} guides', alsoNew: 'Also new across {country}', read: 'Read the guide →', unsubscribe: 'Unsubscribe', langLabel: 'Language', regionChange: 'Change your region', weeklyEdit: 'The Weekly Edit' },
  ko: { subjectSingle: '이번 주 {region} 소식', preheaderSingle: '{region}에서 새로 발행된 가이드 →', editorNote: '매주 관심 지역의 새 글만 모아 보내드려요. 이번 주 {region} 소식입니다.', sectionLabel: '이번 주의 가이드', eventsLabel: '다가오는 이벤트', ctaSingle: '{region} 가이드 전체 보기', alsoNew: '{country}의 다른 새 글', read: '가이드 읽기 →', unsubscribe: '구독 취소', langLabel: '언어', regionChange: '지역 변경', weeklyEdit: '주간 에디트' },
  ja: { subjectSingle: '今週の{region}', preheaderSingle: '{region}の新着ガイド →', editorNote: '毎週、フォロー中の地域の新着ガイドだけをお届けします。今週の{region}です。', sectionLabel: '今週のガイド', eventsLabel: '近日開催のイベント', ctaSingle: '{region}のガイドをすべて見る', alsoNew: '{country}のその他の新着', read: 'ガイドを読む →', unsubscribe: '配信停止', langLabel: '言語', regionChange: '地域を変更', weeklyEdit: 'ウィークリー・エディット' },
  es: { subjectSingle: 'Esta semana en {region}', preheaderSingle: 'Nuevas guías de {region}, recién publicadas →', editorNote: 'Cada semana te enviamos solo las guías nuevas del lugar que sigues. Aquí tienes {region}.', sectionLabel: 'Las guías de esta semana', eventsLabel: 'Próximos eventos', ctaSingle: 'Ver todas las guías de {region}', alsoNew: 'También nuevo en {country}', read: 'Leer la guía →', unsubscribe: 'Cancelar suscripción', langLabel: 'Idioma', regionChange: 'Cambiar región', weeklyEdit: 'La edición semanal' },
  zh: { subjectSingle: '本周{region}', preheaderSingle: '{region}最新发布的攻略 →', editorNote: '我们每周只为你发送所关注地区的最新攻略。这是本周的{region}。', sectionLabel: '本周攻略', eventsLabel: '即将举行的活动', ctaSingle: '查看{region}的全部攻略', alsoNew: '{country}的其他新内容', read: '阅读攻略 →', unsubscribe: '取消订阅', langLabel: '语言', regionChange: '更换地区', weeklyEdit: '每周精选' },
};

export function copyFor(lang) {
  return COPY[lang] || COPY.en;
}

export function fill(str, vars = {}) {
  return String(str).replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : `{${k}}`));
}
