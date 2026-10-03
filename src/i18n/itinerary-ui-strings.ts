import type { Lang } from './ui';

// Strings for the itinerary hub and pages redesign (2026-09-30, owner's "일정
// 목록 개선안" / "바르셀로나 일정 개선안"). Kept out of ui.ts like the other
// redesigns; itinerary-ui-strings.test.mjs checks every key in all five
// languages with the same placeholders.
//
// Left out of the mock-ups on purpose, because nothing on the site records
// them: flight times from Incheon, "the editor picks every month", "we'll email
// you when a course for your city is out".
export const ITIN_UI = {
  en: {
    seoTitle: 'City Itineraries ({days} days): Routes, Closing Days & Rainy-Day Swaps',
    h1a: 'How many days do you have?', h1b: 'Itineraries you can simply follow',
    dek: '{n} itineraries across {c} cities ({days} days), built on real opening hours and ratings, with routes worked out from real coordinates, closing days and a rainy-day swap.',
    feat1: 'Routes from real coordinates', feat2: 'Closing days by weekday', feat3: 'A rainy-day alternative',
    finderKicker: 'Find a course in 30 seconds', fDays: 'Trip length', fAny: 'Any', fDaysN: '{n} days', fRegion: 'Region', fInterest: 'What you like (any)',
    fShow: 'Show {n} courses ↓', fNone: 'No course matches yet. Try fewer filters.',
    catHistory: 'History & temples', catFood: 'Markets & food', catNature: 'Nature & gardens', catViews: 'Views & night', catArt: 'Art & museums',
    rAsia: 'Asia', rEurope: 'Europe', rMeca: 'Middle East', rAmOc: 'Americas & Oceania', rAfrica: 'Africa',
    monthTitle: 'Good in {m}', monthSub: 'From each country guide’s best months · updated monthly',
    listCount: '{n} courses · {c} cities', sort: 'Sort', sortName: 'By name', sortStops: 'Most stops',
    daysN: '{n} days', stopsN: '{n} stops', routeDone: '{n} stops · route worked out', viewCourse: 'See the course →',
    featRouteT: 'Routes from real coordinates', featRouteD: 'Distances between stops come from real coordinates, so you know where to walk and where to ride.',
    featQuietT: 'Quieter hours', featQuietD: 'Busy sights show the hours when fewer people are there.',
    featClosedT: 'Closing days', featClosedD: 'Each stop carries its closing day; enter your arrival date and clashes are flagged.',
    featRainT: 'Rainy-day swaps', featRainD: 'Each day comes with an indoor place to swap in for the outdoor plan.',
    nlHeading: 'New itineraries and guides, by email', nlDek: 'One genuinely useful travel guide a week. Subscribe and get the printable trip checklist free.',
    badgeRain: "Rainy-day swaps included", statPlaces: "Stops", statDwell: "Time at stops", statDwellV: "~{h} h", statWalk: "Walking", statWalkV: "{km} km+", statBook: "Book ahead", statN: "{n}", arrivalLabel: "Arrival (day 1)", arrivalHint: "Enter your arrival date to see real dates and closing-day clashes.", clashNone: "No closing days clash with your dates.", clashN: "{n} closing-day clash(es)", clashTip: "Try moving that day or swapping the order.", rainOn: "Rainy-day view", rainOff: "Back to the plan", prep: "Tickets & stays →", bookTitle: "Book these ahead", bookDek: "The guides recommend booking these in advance.", bookCount: "Tick what you have booked · {d}/{n}", bookCta: "Tickets and tours →", stayTitle: "Where to stay", stayDek: "Compare stays in {city} for your dates.", stayCta: "Stays in {city} →", copyLink: "Copy link", copied: "Copied", ticketChip: "Book ahead", howToGet: "How to get there", sideTitle: "Before you go", passTitle: "A city pass for the paid stops?", passDek: "{n} of this plan's paid stops are on Go City's list. What a pass covers depends on the type: Explorer and Essentials let you pick a set number, All-Inclusive is sold by the day. Compare with single tickets before you buy.", passCta: "See the Go City pass →", passNote: "Some are a guided visit rather than plain entry. Affiliate link, no extra cost to you.",
  },
  ko: {
    seoTitle: '도시별 {days}일 여행 코스: 동선·휴무일·비 오는 날 대안까지',
    h1a: '며칠 있으세요?', h1b: '그대로 따라가는 여행 코스',
    dek: '{c}개 도시, {days}일 코스 {n}개. 실제 영업시간과 평점, 실제 좌표로 계산한 동선에 휴무일과 비 오는 날 대안까지 넣었습니다.',
    feat1: '실제 좌표로 계산한 동선', feat2: '요일별 휴무 표시', feat3: '비 오는 날 대안',
    finderKicker: '30초 코스 찾기', fDays: '여행 일수', fAny: '상관없음', fDaysN: '{n}일', fRegion: '지역', fInterest: '좋아하는 것 (여러 개)',
    fShow: '코스 {n}개 보기 ↓', fNone: '조건에 맞는 코스가 아직 없어요. 조건을 줄여 보세요.',
    catHistory: '역사·사원', catFood: '시장·미식', catNature: '자연·정원', catViews: '전망·야경', catArt: '미술·박물관',
    rAsia: '아시아', rEurope: '유럽', rMeca: '중동', rAmOc: '미주·오세아니아', rAfrica: '아프리카',
    monthTitle: '{m}에 떠나기 좋은 코스', monthSub: '나라별 가이드의 가기 좋은 달 기준 · 매달 자동 갱신',
    listCount: '코스 {n}개 · 도시 {c}개', sort: '정렬', sortName: '이름순', sortStops: '장소 많은 순',
    daysN: '{n}일', stopsN: '{n}곳', routeDone: '{n}곳 · 동선 계산 완료', viewCourse: '코스 보기 →',
    featRouteT: '실제 좌표로 동선', featRouteD: '장소 사이 거리를 실제 좌표로 재서, 걸을지 대중교통을 탈지 알려 줍니다.',
    featQuietT: '한산한 시간 표시', featQuietD: '인기 명소는 사람이 적은 시간대를 함께 보여 줍니다.',
    featClosedT: '휴무일 표시', featClosedD: '장소마다 쉬는 요일을 달고, 도착일을 넣으면 겹치는 날을 알려 줍니다.',
    featRainT: '비 오는 날 대안', featRainD: '야외 일정을 대신할 실내 장소를 날마다 함께 넣었습니다.',
    nlHeading: '새 코스와 가이드를 메일로', nlDek: '매주 진짜 쓸모 있는 여행 가이드 한 편. 구독하면 인쇄용 여행 준비 체크리스트도 무료로 드려요.',
    badgeRain: "비 오는 날 대안 포함", statPlaces: "장소", statDwell: "관람 시간", statDwellV: "약 {h}시간", statWalk: "걷는 거리", statWalkV: "{km}km+", statBook: "사전 예약", statN: "{n}곳", arrivalLabel: "도착일 (1일차)", arrivalHint: "도착일을 넣으면 날짜와 휴무일이 맞춰져요.", clashNone: "고른 날짜에 겹치는 휴무일이 없어요.", clashN: "휴무 {n}곳이 겹쳐요", clashTip: "그날을 앞당기거나 순서를 바꿔 보세요.", rainOn: "비 오는 날 보기", rainOff: "원래 일정 보기", prep: "티켓·숙소 준비 →", bookTitle: "미리 예약해야 하는 곳", bookDek: "가이드에서 사전 예약을 권하는 곳입니다.", bookCount: "예약한 곳은 체크해 두세요 · {d}/{n}", bookCta: "입장권·투어 보기 →", stayTitle: "숙소", stayDek: "{city} 숙소를 날짜에 맞춰 비교해 보세요.", stayCta: "{city} 숙소 보기 →", copyLink: "링크 복사", copied: "복사했어요", ticketChip: "사전 예약 권장", howToGet: "가는 법", sideTitle: "떠나기 전에", passTitle: "유료 명소, 패스로 묶을까?", passDek: "이 일정의 유료 명소 {n}곳이 Go City 목록에 있어요. 패스마다 범위가 달라요. Explorer·Essentials는 정해진 수만큼 고르고, All-Inclusive는 일수로 팝니다. 개별 입장권과 비교해 보고 사세요.", passCta: "Go City 패스 보기 →", passNote: "일부는 일반 입장이 아니라 가이드 방문이에요. 제휴 링크 · 추가 비용 없음",
  },
  ja: {
    seoTitle: '都市別{days}日間の旅行コース：動線・定休日・雨の日の代案まで',
    h1a: '何日ありますか？', h1b: 'そのまま歩ける旅のコース',
    dek: '{c}都市、{days}日間のコース{n}本。実際の営業時間と評価、実際の座標で計算した動線に、定休日と雨の日の代案まで入れました。',
    feat1: '実際の座標で計算した動線', feat2: '曜日別の定休日表示', feat3: '雨の日の代案',
    finderKicker: '30秒でコース探し', fDays: '旅の日数', fAny: 'こだわらない', fDaysN: '{n}日', fRegion: '地域', fInterest: '好きなこと（複数可）',
    fShow: 'コース{n}本を見る ↓', fNone: '条件に合うコースはまだありません。条件を減らしてみてください。',
    catHistory: '歴史・寺院', catFood: '市場・グルメ', catNature: '自然・庭園', catViews: '眺望・夜景', catArt: 'アート・博物館',
    rAsia: 'アジア', rEurope: 'ヨーロッパ', rMeca: '中東', rAmOc: '南北アメリカ・オセアニア', rAfrica: 'アフリカ',
    monthTitle: '{m}に行きたいコース', monthSub: '各国ガイドのベストシーズン基準 · 毎月自動更新',
    listCount: 'コース{n}本 · {c}都市', sort: '並べ替え', sortName: '名前順', sortStops: 'スポットが多い順',
    daysN: '{n}日', stopsN: '{n}か所', routeDone: '{n}か所 · 動線計算済み', viewCourse: 'コースを見る →',
    featRouteT: '実際の座標で動線', featRouteD: 'スポット間の距離を実際の座標で測り、歩くか交通機関を使うかを示します。',
    featQuietT: '空いている時間', featQuietD: '人気スポットは人が少ない時間帯も一緒に表示します。',
    featClosedT: '定休日表示', featClosedD: 'スポットごとに定休日を付け、到着日を入れると重なる日を知らせます。',
    featRainT: '雨の日の代案', featRainD: '屋外の予定の代わりになる屋内スポットを毎日入れています。',
    nlHeading: '新しいコースとガイドをメールで', nlDek: '本当に役立つ旅行ガイドを毎週1本。登録すると印刷用の旅行準備チェックリストも無料でお届けします。',
    badgeRain: "雨の日の代案つき", statPlaces: "スポット", statDwell: "滞在時間", statDwellV: "約{h}時間", statWalk: "歩く距離", statWalkV: "{km}km+", statBook: "事前予約", statN: "{n}か所", arrivalLabel: "到着日（1日目）", arrivalHint: "到着日を入れると日付と定休日が合わせて表示されます。", clashNone: "選んだ日程に重なる定休日はありません。", clashN: "定休日が{n}か所重なります", clashTip: "その日を前倒しするか、順番を入れ替えてみてください。", rainOn: "雨の日の案を見る", rainOff: "元の予定に戻す", prep: "チケット・宿の準備 →", bookTitle: "事前予約が必要な場所", bookDek: "ガイドで事前予約を勧めている場所です。", bookCount: "予約したらチェック · {d}/{n}", bookCta: "チケット・ツアーを見る →", stayTitle: "宿", stayDek: "日程に合わせて{city}の宿を比べてみましょう。", stayCta: "{city}の宿を見る →", copyLink: "リンクをコピー", copied: "コピーしました", ticketChip: "事前予約推奨", howToGet: "行き方", sideTitle: "出発前に", passTitle: "有料スポットはパスでまとめる？", passDek: "このプランの有料スポット {n} か所が Go City の対象です。範囲はパスの種類で違います。Explorer と Essentials は決まった数を選び、All-Inclusive は日数で販売されます。個別チケットと比べてから購入を。", passCta: "Go City パスを見る →", passNote: "一部は通常入場ではなくガイド付き見学です。アフィリエイトリンク・追加料金なし",
  },
  es: {
    seoTitle: 'Itinerarios por ciudad ({days} días): rutas, días de cierre y alternativas para la lluvia',
    h1a: '¿Cuántos días tienes?', h1b: 'Itinerarios para seguir tal cual',
    dek: '{n} itinerarios en {c} ciudades ({days} días), con horarios y valoraciones reales, rutas calculadas con coordenadas reales, días de cierre y una alternativa para la lluvia.',
    feat1: 'Rutas con coordenadas reales', feat2: 'Días de cierre por día de la semana', feat3: 'Alternativa para la lluvia',
    finderKicker: 'Encuentra un itinerario en 30 segundos', fDays: 'Duración', fAny: 'Da igual', fDaysN: '{n} días', fRegion: 'Región', fInterest: 'Lo que te gusta (varios)',
    fShow: 'Ver {n} itinerarios ↓', fNone: 'Aún no hay itinerarios con esos filtros. Prueba con menos.',
    catHistory: 'Historia y templos', catFood: 'Mercados y comida', catNature: 'Naturaleza y jardines', catViews: 'Vistas y noche', catArt: 'Arte y museos',
    rAsia: 'Asia', rEurope: 'Europa', rMeca: 'Oriente Medio', rAmOc: 'América y Oceanía', rAfrica: 'África',
    monthTitle: 'Buenos para {m}', monthSub: 'Según los mejores meses de cada guía de país · se actualiza cada mes',
    listCount: '{n} itinerarios · {c} ciudades', sort: 'Ordenar', sortName: 'Por nombre', sortStops: 'Más paradas',
    daysN: '{n} días', stopsN: '{n} paradas', routeDone: '{n} paradas · ruta calculada', viewCourse: 'Ver el itinerario →',
    featRouteT: 'Rutas con coordenadas reales', featRouteD: 'Las distancias entre paradas salen de coordenadas reales: sabrás dónde caminar y dónde tomar transporte.',
    featQuietT: 'Horas más tranquilas', featQuietD: 'Los sitios más concurridos muestran las horas con menos gente.',
    featClosedT: 'Días de cierre', featClosedD: 'Cada parada indica su día de cierre; pon tu fecha de llegada y verás los choques.',
    featRainT: 'Alternativa para la lluvia', featRainD: 'Cada día incluye un lugar cubierto para cambiar el plan al aire libre.',
    nlHeading: 'Nuevos itinerarios y guías, por correo', nlDek: 'Una guía de viaje realmente útil cada semana. Suscríbete y llévate gratis la checklist de viaje imprimible.',
    badgeRain: "Con alternativas para la lluvia", statPlaces: "Paradas", statDwell: "Tiempo de visita", statDwellV: "~{h} h", statWalk: "A pie", statWalkV: "{km} km+", statBook: "Reservar antes", statN: "{n}", arrivalLabel: "Llegada (día 1)", arrivalHint: "Pon tu fecha de llegada para ver fechas reales y choques con días de cierre.", clashNone: "Ningún día de cierre choca con tus fechas.", clashN: "{n} choque(s) con días de cierre", clashTip: "Prueba a adelantar ese día o cambiar el orden.", rainOn: "Ver plan para lluvia", rainOff: "Volver al plan", prep: "Entradas y alojamiento →", bookTitle: "Reserva esto antes", bookDek: "Las guías recomiendan reservarlos con antelación.", bookCount: "Marca lo que ya reservaste · {d}/{n}", bookCta: "Entradas y tours →", stayTitle: "Dónde dormir", stayDek: "Compara alojamiento en {city} para tus fechas.", stayCta: "Alojamiento en {city} →", copyLink: "Copiar enlace", copied: "Copiado", ticketChip: "Reservar antes", howToGet: "Cómo llegar", sideTitle: "Antes de salir", passTitle: "¿Un pase para las visitas de pago?", passDek: "{n} de las visitas de pago de este plan están en la lista de Go City. Lo que incluye depende del pase: Explorer y Essentials dejan elegir un número fijo y All-Inclusive se vende por días. Compáralo con las entradas sueltas antes de comprar.", passCta: "Ver el pase de Go City →", passNote: "Algunas son visitas guiadas en vez de entrada libre. Enlace de afiliado, sin coste extra.",
  },
  zh: {
    seoTitle: '城市{days}日游行程：路线、休息日与雨天替代方案',
    h1a: '你有几天？', h1b: '照着走就行的旅行路线',
    dek: '{c} 个城市、{days} 天路线共 {n} 条。依据真实营业时间和评分，用真实坐标算好路线，还标出休息日和雨天替代方案。',
    feat1: '用真实坐标算好的路线', feat2: '按星期标注休息日', feat3: '雨天替代方案',
    finderKicker: '30 秒找路线', fDays: '旅行天数', fAny: '不限', fDaysN: '{n} 天', fRegion: '地区', fInterest: '喜欢的内容（可多选）',
    fShow: '查看 {n} 条路线 ↓', fNone: '暂时没有符合条件的路线，试着减少筛选条件。',
    catHistory: '历史与寺庙', catFood: '市场与美食', catNature: '自然与园林', catViews: '观景与夜景', catArt: '艺术与博物馆',
    rAsia: '亚洲', rEurope: '欧洲', rMeca: '中东', rAmOc: '美洲与大洋洲', rAfrica: '非洲',
    monthTitle: '{m}适合出发的路线', monthSub: '依据各国指南的最佳月份 · 每月自动更新',
    listCount: '{n} 条路线 · {c} 个城市', sort: '排序', sortName: '按名称', sortStops: '景点最多',
    daysN: '{n} 天', stopsN: '{n} 处', routeDone: '{n} 处 · 路线已计算', viewCourse: '查看路线 →',
    featRouteT: '真实坐标路线', featRouteD: '用真实坐标测量景点之间的距离，告诉你该步行还是乘车。',
    featQuietT: '人少的时段', featQuietD: '热门景点会同时显示人较少的时段。',
    featClosedT: '休息日标注', featClosedD: '每个景点都标出休息日，填入抵达日期就会提示冲突的日子。',
    featRainT: '雨天替代方案', featRainD: '每天都附一个可替代户外行程的室内去处。',
    nlHeading: '新路线和指南，用邮件发给你', nlDek: '每周一篇真正实用的旅行指南。订阅即可免费获得可打印的旅行准备清单。',
    badgeRain: "含雨天替代方案", statPlaces: "景点", statDwell: "游览时间", statDwellV: "约 {h} 小时", statWalk: "步行距离", statWalkV: "{km} 公里+", statBook: "需提前预订", statN: "{n} 处", arrivalLabel: "抵达日（第 1 天）", arrivalHint: "填入抵达日期，就能看到真实日期和休息日冲突。", clashNone: "你选的日期没有碰上休息日。", clashN: "有 {n} 处碰上休息日", clashTip: "试着把那天提前，或调换顺序。", rainOn: "查看雨天方案", rainOff: "回到原行程", prep: "门票与住宿准备 →", bookTitle: "需要提前预订的地方", bookDek: "指南建议提前预订的地方。", bookCount: "订好了就打勾 · {d}/{n}", bookCta: "查看门票和团 →", stayTitle: "住宿", stayDek: "按日期比较{city}的住宿。", stayCta: "查看{city}住宿 →", copyLink: "复制链接", copied: "已复制", ticketChip: "建议提前预订", howToGet: "怎么去", sideTitle: "出发前", passTitle: "付费景点要不要买通票？", passDek: "本行程中有 {n} 个付费景点在 Go City 的名单上。通票类型不同，包含范围也不同：Explorer 和 Essentials 只能选固定数量，All-Inclusive 按天数出售。购买前请和单独门票比较。", passCta: "查看 Go City 通票 →", passNote: "部分景点为导览参观而非普通入场。联盟链接，不额外收费。",
  },
};

export type ItinUiKey = keyof (typeof ITIN_UI)['en'];

/** Translator for the itinerary hub/pages, English fallback; `vars` fills the {placeholders}. */
export function itinUi(lang: Lang) {
  const table = (ITIN_UI as Record<string, Record<string, string>>)[lang] ?? ITIN_UI.en;
  return (key: ItinUiKey, vars: Record<string, string | number> = {}): string => {
    let s = table[key] ?? ITIN_UI.en[key];
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
  };
}
