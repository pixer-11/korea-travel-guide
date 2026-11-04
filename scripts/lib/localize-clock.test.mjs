import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localizeClock, ENGLISH_CLOCK } from './localize-clock.mjs';

// Every line below was on a live page on 2026-11-04.

test('zh: ranges and single times take the word the corpus uses for that hour', () => {
  assert.equal(
    localizeClock('宫殿每天11am至6pm开放。想赶在旅行团之前入场，最好11am开门时就到。', 'zh'),
    '宫殿每天上午11点至下午6点开放。想赶在旅行团之前入场，最好上午11点开门时就到。',
  );
  assert.equal(localizeClock('目前公布的开放时间为每天8am–11pm。', 'zh'), '目前公布的开放时间为每天早上8点–晚上11点。');
  assert.equal(localizeClock('晚市为7pm–1am。', 'zh'), '晚市为晚上7点–凌晨1点。');
  assert.equal(localizeClock('12pm 最忙', 'zh'), '中午12点最忙');
});

test('zh: a range names one stretch of the morning once, and minutes keep one shape', () => {
  assert.equal(localizeClock('工作日7am至10am人最少', 'zh'), '工作日早上7点至10点人最少');
  assert.equal(localizeClock('周末为 4:00–6:45pm。', 'zh'), '周末为下午4:00–6:45。');
  assert.equal(localizeClock('（10:45–11:45am）', 'zh'), '（上午10:45–11:45）');
});

test('the start of "9–11am" takes the end\'s marker — and turns at noon and midnight', () => {
  assert.equal(localizeClock('9–11am人最少', 'zh'), '上午9点–11点人最少');
  assert.equal(localizeClock('11–1pm最忙', 'zh'), '上午11点–下午1点最忙');
  assert.equal(localizeClock('10–12pm也可以', 'zh'), '上午10点–中午12点也可以');
  assert.equal(localizeClock('12–2pm', 'zh'), '中午12点–下午2点');
  assert.equal(localizeClock('11–2am', 'zh'), '晚上11点–凌晨2点');
});

test('a word the translator already wrote is kept; only the English marker goes', () => {
  assert.equal(localizeClock('通常工作日早上8:30am一开门就去', 'zh'), '通常工作日早上8:30一开门就去');
  assert.equal(localizeClock('傍晚5pm左右开始', 'zh'), '傍晚5点左右开始');
  assert.equal(localizeClock('午前2amのブース席', 'ja'), '午前2時のブース席');
  assert.equal(localizeClock('주말 저녁 6pm–11pm에 가장 붐빕니다.', 'ko'), '주말 저녁 6시–11시에 가장 붐빕니다.');
  assert.equal(localizeClock('- **오전 10am 개관에 맞춰 도착하십시오.**', 'ko'), '- **오전 10시 개관에 맞춰 도착하십시오.**');
  // A word that contradicts the marker is the translator's slip: the marker decides.
  assert.equal(localizeClock('上午9pm', 'zh'), '晚上9点');
});

test('zh/ja: a space between two CJK characters goes; a space beside a digit is the page\'s own', () => {
  assert.equal(localizeClock('每天 11am 至 6pm 开放', 'zh'), '每天上午11点至下午6点开放');
  assert.equal(localizeClock('目前每天早上 6:30–9:00am 开门', 'zh'), '目前每天早上 6:30–9:00 开门');
  assert.equal(localizeClock('- **出门玩之前**：10:30am一开门就去', 'zh'), '- **出门玩之前**：上午10:30一开门就去');
});

test('ja: 午前/午後 with 時 and 分, noon 正午, midnight to 2am 深夜, never one morning across midnight', () => {
  assert.equal(localizeClock('時間は6pm〜1amです。7am～8amが最も空いている', 'ja'), '時間は午後6時〜深夜1時です。午前7時～8時が最も空いている');
  assert.equal(localizeClock('営業時間は毎日7:30am〜12:30amで', 'ja'), '営業時間は毎日午前7時30分〜深夜0時30分で');
  assert.equal(localizeClock('12pmに開店し、12pm〜3pmが混みます', 'ja'), '正午に開店し、正午〜午後3時が混みます');
});

test('ko: 오전/오후 with a space, 정오·자정·새벽, minutes as 분', () => {
  assert.equal(localizeClock('평일 9am부터 4pm까지 운영합니다.', 'ko'), '평일 오전 9시부터 오후 4시까지 운영합니다.');
  assert.equal(localizeClock('12pm에 문을 열고 12am에 닫습니다. 2am까지 영업.', 'ko'), '정오에 문을 열고 자정에 닫습니다. 새벽 2시까지 영업.');
  assert.equal(localizeClock('9:05am 출발, 매일 밤 10:00 PM까지', 'ko'), '오전 9시 5분 출발, 매일 밤 10시까지');
});

test('a sentence-ending period stays; code, links and Spanish are not touched', () => {
  assert.equal(localizeClock('평일 9am. 끝', 'ko'), '평일 오전 9시. 끝');
  assert.equal(localizeClock('[링크](https://x.com/9am) `9am`', 'ko'), '[링크](https://x.com/9am) `9am`');
  assert.equal(localizeClock('Entre las 8:30am y las 9:30am', 'es'), 'Entre las 8:30am y las 9:30am');
  assert.equal(localizeClock('Open 9am–5pm', 'en'), 'Open 9am–5pm');
  // Not a clock: digits run into the marker, or "am" begins a word.
  assert.equal(localizeClock('B12am 3 amazing', 'zh'), 'B12am 3 amazing');
});

test('nothing English is left for the counter to find', () => {
  const s = localizeClock('11am至6pm · 9–11am · 7:30am–4pm · 12:30am · 2 PM', 'zh');
  assert.equal((s.match(ENGLISH_CLOCK) || []).length, 0, s);
});

test('a YAML key keeps its space: 「a: 7:00 AMの」 → 「a: 午前7時の」, never 「a:午前7時」', () => {
  // The first apply run of 11-04 joined them and the file no longer parsed.
  assert.equal(localizeClock('    a: 7:00 AMの開館直後がおすすめです。', 'ja'), '    a: 午前7時の開館直後がおすすめです。');
  assert.equal(localizeClock('    a: 9am 开门', 'zh'), '    a: 上午9点开门');
});

test('a radio frequency is not a clock: 「WSM 650 AM」 stays (nashville-grand-ole-opry)', () => {
  assert.equal(localizeClock('整场演出都通过WSM 650 AM现场直播。', 'zh'), '整场演出都通过WSM 650 AM现场直播。');
  assert.equal(localizeClock('공연 전체가 WSM 650 AM으로 생중계됩니다.', 'ko'), '공연 전체가 WSM 650 AM으로 생중계됩니다.');
});

test('addresses, paths, ~~~ code and a line-ending a.m. (Codex, 11-04)', () => {
  assert.equal(localizeClock('연락: foo@9am.com', 'ko'), '연락: foo@9am.com');
  assert.equal(localizeClock('링크 /posts/9am/ 참고', 'ko'), '링크 /posts/9am/ 참고');
  assert.equal(localizeClock('~~~md\n9am\n~~~', 'ko'), '~~~md\n9am\n~~~');
  // The abbreviation's dot ends the sentence at a line end; mid-line it is the abbreviation's.
  assert.equal(localizeClock('이용 안내: 9 a.m.', 'ko'), '이용 안내: 오전 9시.');
  assert.equal(localizeClock('이용 안내: 9 a.m.\n다음 줄', 'ko'), '이용 안내: 오전 9시.\n다음 줄');
  assert.equal(localizeClock('이용 안내: 9 a.m. 출발', 'ko'), '이용 안내: 오전 9시 출발');
  // Slash-joined times are still times.
  assert.equal(localizeClock('주말 9am/10am 개장', 'ko'), '주말 오전 9시/오전 10시 개장');
});

// ── native review of the first apply run (11-04) ─────────────────────────────

test('the K-pop groups 2PM and 2AM are not clock times — a real 2PM still is', async () => {
  const { countEnglishClock } = await import('./localize-clock.mjs');
  for (const [s, lang] of [
    ['是男团2PM的成员', 'zh'], ['他最早以 2PM 队长的身份走红', 'zh'], ['一面是2PM的舞台', 'zh'], ['2PM成员李俊昊的演唱会', 'zh'],
    ['ボーイズグループ2PMのメンバー', 'ja'], ['2PMとして立ってきたステージ', 'ja'], ['2PMのリーダー', 'ja'],
    ['보이그룹 2PM 멤버로서', 'ko'], ['2PM 무대 위의 모습', 'ko'], ['2AM 멤버', 'ko'],
  ]) {
    assert.equal(localizeClock(s, lang), s);
    assert.equal(countEnglishClock(s), 0, s);
  }
  assert.equal(localizeClock('下午2PM开始', 'zh'), '下午2点开始');
  assert.equal(localizeClock('晚上7PM开始', 'zh'), '晚上7点开始');
  assert.equal(localizeClock('2pm开门', 'zh'), '下午2点开门');
  assert.equal(localizeClock('12–2PM', 'zh'), '中午12点–下午2点');
});

test('ko: the particle chosen for 「pm」 (피엠) follows 시 / 정오 once the English goes', () => {
  assert.equal(localizeClock('평일 6–9pm이 가장 한산합니다.', 'ko'), '평일 오후 6시–9시가 가장 한산합니다.');
  assert.equal(localizeClock('12–1pm은 붐빕니다', 'ko'), '정오–오후 1시는 붐빕니다');
  assert.equal(localizeClock('5pm을 피하시고 7–9am과 6–7pm이 좋습니다', 'ko'), '오후 5시를 피하시고 오전 7시–9시와 오후 6시–7시가 좋습니다');
  assert.equal(localizeClock('9pm으로 바뀌었습니다', 'ko'), '오후 9시로 바뀌었습니다');
  // After 분 and 자정 the consonant form stays; the copula 이고 stays.
  assert.equal(localizeClock('9:30am이 좋고 12am은 닫습니다. 마감은 9pm이고', 'ko'), '오전 9시 30분이 좋고 자정은 닫습니다. 마감은 오후 9시이고');
});

test('zh: a scene word the translator wrote (每晚, 清晨, 一早) is kept, never doubled', () => {
  assert.equal(localizeClock('每晚7:45pm和8:45pm上演的免费声光秀', 'zh'), '每晚7:45和晚上8:45上演的免费声光秀');
  assert.equal(localizeClock('清晨6am开园', 'zh'), '清晨6点开园');
  assert.equal(localizeClock('周六一早10am开门就进馆', 'zh'), '周六一早10点开门就进馆');
});

test('부터/에서 and から pairs inside one half of the day say the word once', () => {
  assert.equal(localizeClock('금요일과 토요일에는 저녁 5pm부터 9pm까지만', 'ko'), '금요일과 토요일에는 저녁 5시부터 9시까지만');
  assert.equal(localizeClock('9am부터 10am 사이가 가장 한산합니다', 'ko'), '오전 9시부터 10시 사이가 가장 한산합니다');
  assert.equal(localizeClock('평일 9am부터 4pm까지', 'ko'), '평일 오전 9시부터 오후 4시까지');
  assert.equal(localizeClock('平日の7amから10amの間、または週末の朝7amから9amの間', 'ja'), '平日の午前7時から10時の間、または週末の朝7時から9時の間');
  assert.equal(localizeClock('月曜と火曜は7amから2amまで', 'ja'), '月曜と火曜は午前7時から深夜2時まで');
});

test('zh pangu pages: a space left after 「早上8:30」 alone goes with the one before it', () => {
  assert.equal(localizeClock('赶在 8:30am 开园时到达', 'zh'), '赶在早上8:30开园时到达');
  assert.equal(localizeClock('目前每天早上 6:30–9:00am 开门', 'zh'), '目前每天早上 6:30–9:00 开门');
});

test('Codex round 2: a time word before 2PM makes it a time; 2PM의 멤버 is the band; a stray marker turns the particle pass off', () => {
  assert.equal(localizeClock('下午2PM演唱会开始', 'zh'), '下午2点演唱会开始');
  assert.equal(localizeClock('2PM의 멤버', 'ko'), '2PM의 멤버');
  assert.equal(localizeClock('기호\uE000이 있고 9pm', 'ko'), '기호\uE000이 있고 오후 9시');
});
