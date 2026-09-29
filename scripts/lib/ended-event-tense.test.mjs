// 어휘 목록은 규칙이 아니다 — 누가 생각해낸 것만 찾는다.
// 2026-09-10: 검사기가 끝난 이벤트 64건과 번역 256개를 전수 훑고도 0건을 보고했다.
// 인구조사는 맞았는데 어휘가 비어 있었다. 중국어 19건이 메타 설명과 JSON-LD 에서
// 스스로를 "예정"이라 광고하고 있었고, 빠진 단어는 定于 — 중국어가 "~에 열린다"를
// 말하는 가장 평범한 방식이다. 목록엔 명시적 미래인 将于·将在·即将만 있었다.
// 그래서 이 테스트는 **모든 항목이 실제 문장에서 발화하는지**를 검사한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { UPCOMING, upcomingText, stackedSchedule, PLANNED, upcomingHits, GENERIC } from './ended-event-tense.mjs';

// 각 패턴이 실제로 잡아야 하는 문장. 새 패턴을 넣으면 여기에도 넣어야 한다.
const FIRES = {
  ko: {
    '열립니다': '축제는 8월 3일에 열립니다.',
    '진행됩니다': '공연은 이틀간 진행됩니다.',
    '개최됩니다': '대회는 서울에서 개최됩니다.',
    '열릴 예정입니다': '행사는 9월에 열릴 예정입니다.',
    '열릴 예정이며': '행사는 9월에 열릴 예정이며, 티켓은 온라인에서 판매됩니다.',
    '열릴 예정이고': '행사는 9월에 열릴 예정이고 무료입니다.',
    '진행될 예정입니다': '투어는 3일간 진행될 예정입니다.',
    '진행될 예정이며': '투어는 3일간 진행될 예정이며 사전 예약이 필요합니다.',
  },
  ja: {
    '開催されます': 'フェスティバルは8月に開催されます。',
    '行われます': '公演は2日間行われます。',
    '予定です': 'イベントは9月の予定です。',
    '開催予定です': '大会は東京で開催予定です。',
  },
  es: {
    'se celebrará': 'El festival se celebrará en agosto.',
    'tendrá lugar': 'El concierto tendrá lugar el 3 de agosto.',
    'se llevará a cabo': 'La feria se llevará a cabo en Madrid.',
    'se celebra del': 'La Tomatina se celebra del 26 al 27 de agosto de 2026.',
    'se celebra el': 'El festival se celebra el 15 de agosto de 2026.',
  },
  zh: {
    '将于': '音乐节将于8月举行。',
    '将在': '演出将在东京举行。',
    '即将': '展览即将开幕。',
    '(?<![原前])定于': 'Lollapalooza音乐节定于7月30日至8月2日在芝加哥举行。',
    '(?<![原前])确定于': '巡演确定于8月16日登陆伊斯坦布尔。',
    '将担任': 'Charli XCX将担任压轴演出。',
  },
};

test('모든 언어가 어휘를 갖고 있다', () => {
  for (const lang of ['ko', 'ja', 'es', 'zh']) {
    assert.ok(Array.isArray(UPCOMING[lang]) && UPCOMING[lang].length, `${lang} 어휘가 비었다`);
  }
});

test('어휘의 모든 항목이 실제 문장에서 발화한다 — 죽은 패턴이 없다', () => {
  for (const [lang, patterns] of Object.entries(UPCOMING)) {
    for (const re of patterns) {
      const key = re.source;
      const sentence = FIRES[lang]?.[key];
      assert.ok(sentence, `${lang}: 패턴 "${key}" 에 대한 예문이 테스트에 없다 — 추가할 것`);
      assert.ok(new RegExp(re.source, re.flags).test(sentence), `${lang}: 패턴 "${key}" 가 자기 예문에서 발화하지 않는다`);
    }
  }
});

test('🛑 과거형 문장은 잡지 않는다 — 수리 결과가 다시 걸리면 무한 루프다', () => {
  const past = {
    ko: '행사는 9월에 열릴 예정이었습니다.',
    ja: 'イベントは9月に開催される予定でした。',
    es: 'El festival estaba previsto para agosto.',
    zh: '音乐节原定于7月30日至8月2日举行。',
  };
  for (const [lang, sentence] of Object.entries(past)) {
    for (const re of UPCOMING[lang]) {
      assert.equal(new RegExp(re.source, re.flags).test(sentence), false,
        `${lang}: 과거형 문장이 "${re.source}" 에 걸렸다 — 수리해도 계속 걸린다`);
    }
  }
});

test('검사 범위: FAQ 질문은 빼고 답변은 넣는다', () => {
  const out = {
    title: 'Hanoi Jazztival 2026',
    description: 'El Hanoi Jazztival 2026 se celebró del 17 al 19 de septiembre.',
    quickAnswer: 'Estaba previsto del 17 al 19 de septiembre de 2026.',
    body: 'El festival se celebró en cuatro sedes.',
    faq: [{ q: '¿Dónde se celebra el Hanoi Jazztival 2026?', a: 'Se celebró en la Ópera de Hanói.' }],
  };
  const text = upcomingText(out);
  assert.ok(!text.includes('¿Dónde se celebra el'), '질문은 검사 대상이 아니다');
  assert.ok(text.includes('Se celebró en la Ópera'), '답변은 검사한다');
  // 질문만 현재형인 파일은 통과해야 한다 — 2026-09-20 에 스페인어가 3번 연속 실패한 자리
  assert.equal(UPCOMING.es.flatMap((re) => text.match(re) ?? []).length, 0);
});

test('검사 범위: 답변에 남은 미래형은 여전히 잡힌다', () => {
  const out = { faq: [{ q: '¿Cuándo es?', a: 'El festival se celebrará en septiembre.' }] };
  const text = upcomingText(out);
  assert.deepEqual(UPCOMING.es.flatMap((re) => text.match(re) ?? []), ['se celebrará']);
});

test('검사 범위: faq 가 없거나 이상해도 죽지 않는다', () => {
  assert.equal(upcomingText({ title: 'x' }), 'x');
  assert.equal(upcomingText({ title: 'x', faq: null }), 'x');
  assert.equal(upcomingText({ title: 'x', faq: [null, { q: 'q' }] }), 'x');
  assert.equal(upcomingText(null), '');
});

// ── "예정" 겹쌓기 (2026-09-29) ─────────────────────────────────────────
// 실제로 라이브에 나가 있던 문장들이다. 이렇게 겹치면 취소된 행사처럼 읽힌다.
test('겹쌓기: 실제 라이브 문장에서 발화한다', () => {
  const live = {
    ko: '인도네시아 발리에서 열릴 예정이었던 데크맨텔 x 포테이토 헤드는 2026년 9월 25일로 예정되어 있었습니다.',
    ja: 'ラ・メルセ祭は9月20日から24日にかけて開催される予定でした。無料の催しが予定されており、パレードが行われる予定でした。',
    zh: '总决赛原定于9月5日在胡志明市举行，赛程原定为一个月。',
    es: 'La edición estaba prevista del 21 de agosto al 6 de septiembre y la final estaba programada para el 6.',
  };
  for (const [lang, sentence] of Object.entries(live)) {
    assert.ok(stackedSchedule({ description: sentence }, lang), `${lang}: 겹쌓기를 못 잡았다`);
  }
});

test('겹쌓기: 한국어 "열릴 예정이었던" 은 한 번만 나와도 잡는다', () => {
  assert.ok(stackedSchedule({ quickAnswer: '베로나에서 열릴 예정이었던 오페라 축제입니다.' }, 'ko'));
});

test('🛑 새로 권하는 담백한 문장은 두 검사기 어디에도 안 걸린다 — 걸리면 재시도가 영원히 돈다', () => {
  const plain = {
    ko: '라 메르세 축제의 일정은 2026년 9월 20~24일이었습니다. 결승 일정은 9월 5일, 장소는 호찌민시였습니다.',
    ja: '会期は2026年9月20日〜24日でした。決勝は9月5日、会場はホーチミン市でした。',
    zh: '日程为2026年9月20日至24日。决赛日期为9月5日，地点为胡志明市。',
    es: 'Las fechas anunciadas eran del 20 al 24 de septiembre de 2026; la final era el 5 de septiembre, en Ciudad Ho Chi Minh.',
  };
  for (const [lang, sentence] of Object.entries(plain)) {
    assert.equal(stackedSchedule({ description: sentence, body: sentence }, lang), null, `${lang}: 담백한 문장이 겹쌓기로 걸렸다`);
    for (const re of UPCOMING[lang]) {
      assert.equal(new RegExp(re.source, re.flags).test(sentence), false, `${lang}: 담백한 문장이 "${re.source}" 에 걸렸다`);
    }
  }
});

test('겹쌓기: 단위는 칸·문단별이다 — 서로 다른 칸에 한 번씩은 정상', () => {
  const out = {
    description: '2026년 9월 25일 일정으로 예정된 공연입니다.',
    quickAnswer: '티켓은 8월 판매 예정이었습니다.',
    body: '첫 문단에 예정 한 번.\n\n둘째 문단에도 예정 한 번.',
  };
  assert.equal(stackedSchedule(out, 'ko'), null);
  assert.equal(stackedSchedule({ body: '예정 한 번. 같은 문단에 예정 또.' }, 'ko').unit, 'body¶1');
});

test('겹쌓기: 스페인어는 단어 안의 부분 문자열을 세지 않는다 (imprevistos)', () => {
  const s = 'El concierto estaba previsto para el 20 de septiembre; el recinto disponía de accesos alternativos para imprevistos.';
  assert.equal(stackedSchedule({ body: s }, 'es'), null);
  assert.ok(stackedSchedule({ body: 'Estaba previsto el 20 y la final estaba programada el 21.' }, 'es'), '진짜 두 번은 여전히 잡는다');
});

test('겹쌓기: 모든 언어에 어휘가 있고, 없는 언어·빈 입력에 죽지 않는다', () => {
  for (const lang of ['ko', 'ja', 'es', 'zh']) assert.ok(PLANNED[lang], `${lang} 어휘 없음`);
  assert.equal(stackedSchedule({ title: 'x' }, 'fr'), null);
  assert.equal(stackedSchedule(null, 'ko'), null);
  assert.equal(stackedSchedule({ faq: [null, { q: 'q' }] }, 'ko'), null);
});

// ── 일반론 문장 면제 (2026-09-29, 부바네스와르 육상 3연속 실패) ──────────────
test('일반론: "보통 ~진행됩니다" 는 이번 회차 이야기가 아니라 통과한다', () => {
  const norm = {
    ko: '이런 대회는 보통 하루 동안 진행됩니다.',
    ja: 'この種の大会は通常、1日で行われます。',
    es: 'Este tipo de reunión normalmente se celebra el mismo día.',
    zh: '这类赛事通常将在一天内完成。',
  };
  for (const [lang, s] of Object.entries(norm)) {
    assert.deepEqual(upcomingHits({ body: s }, lang), [], `${lang}: 일반론 문장이 걸렸다`);
  }
});

test('일반론: 같은 글이라도 이번 회차의 현재형은 여전히 잡힌다', () => {
  const out = { body: '이런 대회는 보통 하루 동안 진행됩니다. 올해 대회는 8월 3일에 열립니다.' };
  assert.deepEqual(upcomingHits(out, 'ko'), ['열립니다']);
  assert.deepEqual(upcomingHits({ description: '音楽祭は8月に開催されます。' }, 'ja'), ['開催されます']);
  assert.deepEqual(upcomingHits({ faq: [{ q: '¿Cuándo?', a: 'El festival se celebrará en agosto.' }] }, 'es'), ['se celebrará']);
  for (const lang of ['ko', 'ja', 'es', 'zh']) assert.ok(GENERIC[lang], `${lang} 일반론 표지 없음`);
});

test('일반론: 같은 문장에 쉼표로 붙은 이번 회차 오류는 면제되지 않는다 (코덱스 09-29)', () => {
  assert.deepEqual(upcomingHits({ body: '입장은 보통 공연 두 시간 전부터이며, 이번 공연은 2026년 9월 20일에 열립니다.' }, 'ko'), ['열립니다']);
  assert.deepEqual(upcomingHits({ body: 'Normalmente dura un día; esta edición se celebrará el 20 de septiembre de 2026.' }, 'es'), ['se celebrará']);
});

test('일반론: 중국어 "一般门票"(일반 입장권)는 일반론 표지가 아니다', () => {
  assert.deepEqual(upcomingHits({ body: '本届音乐节的一般门票将于2026年9月1日发售。' }, 'zh'), ['将于']);
  assert.deepEqual(upcomingHits({ body: '一般来说，这类赛事将在一天内完成。' }, 'zh'), []);
});
