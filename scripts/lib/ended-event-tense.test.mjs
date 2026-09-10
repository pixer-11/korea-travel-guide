// 어휘 목록은 규칙이 아니다 — 누가 생각해낸 것만 찾는다.
// 2026-09-10: 검사기가 끝난 이벤트 64건과 번역 256개를 전수 훑고도 0건을 보고했다.
// 인구조사는 맞았는데 어휘가 비어 있었다. 중국어 19건이 메타 설명과 JSON-LD 에서
// 스스로를 "예정"이라 광고하고 있었고, 빠진 단어는 定于 — 중국어가 "~에 열린다"를
// 말하는 가장 평범한 방식이다. 목록엔 명시적 미래인 将于·将在·即将만 있었다.
// 그래서 이 테스트는 **모든 항목이 실제 문장에서 발화하는지**를 검사한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { UPCOMING } from './ended-event-tense.mjs';

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
