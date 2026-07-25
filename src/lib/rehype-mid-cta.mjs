// Rehype plugin: inserts a small lead-magnet CTA roughly mid-article (before the
// middle h2) in every post body. Static HTML — keeps article pages zero-JS — and
// applied at the markdown pipeline level so every current AND future post (all 5
// languages) gets it with no per-template work. Language is derived from the
// file path (translations live under src/content/i18n/<lang>/).
//
// Skips short posts (<3 h2 sections): a mid-article interruption needs enough
// article around it to feel editorial rather than pushy.

const COPY = {
  en: { lead: 'Planning a trip like this?', link: 'Get our free trip checklist' },
  ko: { lead: '이런 여행을 준비 중이신가요?', link: '무료 여행 체크리스트 받기' },
  ja: { lead: 'このような旅行を計画中ですか?', link: '無料の旅行チェックリストをもらう' },
  es: { lead: '¿Planeando un viaje así?', link: 'Consigue nuestra lista de viaje gratis' },
  zh: { lead: '正在计划这样的旅行吗?', link: '获取免费旅行清单' },
};

function langFromPath(path = '') {
  const m = /[\\/]i18n[\\/](ko|ja|es|zh)[\\/]/.exec(path);
  return m ? m[1] : 'en';
}

export default function rehypeMidCta() {
  return (tree, file) => {
    // POSTS ONLY (English source + their /i18n/<lang>/ translations). Essentials,
    // topics and static pages share this markdown pipeline but must NOT get the
    // CTA — they briefly did, and worse, in English (their translations live
    // outside /i18n/ so language detection fell back to en).
    const p = String(file?.path || file?.history?.[0] || '').replace(/\\/g, '/');
    if (!/\/content\/(posts|i18n\/(ko|ja|es|zh))\//.test(p)) return;
    const kids = tree.children ?? [];
    const h2Idx = [];
    for (let i = 0; i < kids.length; i++) {
      if (kids[i].type === 'element' && kids[i].tagName === 'h2') h2Idx.push(i);
    }
    if (h2Idx.length < 3) return;

    const lang = langFromPath(file?.path || file?.history?.[0] || '');
    const c = COPY[lang];
    const prefix = lang === 'en' ? '' : `/${lang}`;

    const aside = {
      type: 'element',
      tagName: 'aside',
      properties: { className: ['mid-cta'] },
      children: [
        { type: 'element', tagName: 'span', properties: { className: ['mid-cta-lead'] }, children: [{ type: 'text', value: c.lead }] },
        {
          type: 'element',
          tagName: 'a',
          properties: { className: ['mid-cta-link'], href: `${prefix}/free/trip-checklist/` },
          children: [{ type: 'text', value: `${c.link} →` }],
        },
      ],
    };

    const insertAt = h2Idx[Math.floor(h2Idx.length / 2)];
    kids.splice(insertAt, 0, aside);
  };
}
