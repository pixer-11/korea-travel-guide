// Korean rendering for validator output that goes to Telegram.
//
// The validators print English — they are developer tools and their messages
// carry diagnostic detail. The workflows used to pipe that stdout straight into
// a Telegram message under a Korean heading, so the heading was Korean and every
// line under it was English. Patching the individual strings would not hold:
// the next issue code someone adds would leak again, silently, and the leak only
// shows up in the owner's chat.
//
// So this renders from the CODE, not from the prose. Each line is reduced to the
// facts that identify it (file, slug, numbers) and rebuilt in Korean. An
// unrecognised code still produces a Korean line naming the code — the English
// sentence never survives the trip. That is the property worth having: adding a
// validator message can no longer put English in front of the owner.

/** Pull the identifying facts out of a validator line, ignoring its prose. */
function facts(rest) {
  const file = rest.match(/[\w./-]*[\w-]+\.md/)?.[0] ?? null;
  const quoted = [...rest.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const day = rest.match(/day (\d+)/)?.[1] ?? null;
  // A stale-leg line quotes the stored value first and the freshly computed one
  // second. Keep FIRST-seen per key (the stored value, which is the wrong one
  // being reported) and keep the full list so both can be shown.
  const nums = {};
  const numsAll = {};
  for (const m of rest.matchAll(/\b(km|minutes|min|stops|dwell)=(-?[\d.]+)/g)) {
    if (!(m[1] in nums)) nums[m[1]] = m[2];
    (numsAll[m[1]] ??= []).push(m[2]);
  }
  const lang = rest.match(/\b(ko|ja|es|zh|en)\b(?=[/\s\]])/)?.[1] ?? null;
  return { file, slug: quoted[0] ?? null, quoted, day, nums, numsAll, lang };
}

/** Short "where" prefix: file, day, stop — whatever the line actually carried. */
function where(f) {
  const parts = [];
  if (f.file) parts.push(f.file.replace(/^.*\//, ''));
  if (f.day) parts.push(`${f.day}일차`);
  if (f.slug) parts.push(f.slug);
  return parts.length ? parts.join(' · ') : '대상 미상';
}

/**
 * "• where — body", but a site-wide finding has no where. Whole-site checks
 * (the design-uniformity ones) name no file, and "• 대상 미상 — 혼잡도 그래프
 * 색이 되돌아감" reads as a second, imaginary problem next to the real one.
 */
function koLine(f, body) {
  const w = where(f);
  return w === '대상 미상' ? `• ${body}` : `• ${w} — ${body}`;
}

const T = {
  // 일정(itinerary) 정확성
  'LEG-STALE': (f) => {
    const [stored, fresh] = f.numsAll.km ?? [];
    const gap = stored && fresh ? `저장값 ${stored}km → 실제 ${fresh}km` : '저장값과 실제 거리가 다름';
    return `구간 거리가 실제와 다름 (${gap}) — 일정 재생성 필요`;
  },
  'DWELL-STALE': () => '머무는 시간이 원본 글과 어긋남 — 일정 재생성 필요',
  'WALK-TOO-FAR': (f) => `걸어서 가기엔 너무 먼 구간 (${f.nums.km ?? '?'}km)`,
  'TRANSIT-MINUTES-PRESENT': () => '대중교통 구간인데 도보 시간이 남아 있음',
  'DAY-BUDGET-EXCEEDED': () => '하루 일정이 감당할 수 있는 시간을 넘김',
  'DAY-TOTAL-TOO-SHORT': () => '하루 일정이 지나치게 비어 있음',
  'DAY-STOP-COUNT': () => '하루 방문지 수가 기준을 벗어남',
  'STOP-COUNT-CLAIM': () => '본문에 적힌 방문지 수가 실제 일정과 다름',
  'SLOT-TIME-CONFLICT': () => '시간대가 서로 겹침',
  'DURATION-CONTRADICTION': () => '본문의 소요시간 설명이 일정과 어긋남',
  'LUNCH-NOT-RESTAURANT': () => '점심 자리에 식당이 아닌 곳이 들어감',
  'CLOSED-VENUE': () => '문 닫은(폐업) 장소가 일정에 포함됨',
  'MISSING-POST': () => '일정이 가리키는 글이 없음',
  'MISSING-SLUG': () => '방문지 지정이 비어 있음',
  'MISSING-COORDS': () => '좌표가 없어 거리 계산 불가',
  'DRAFT-POST': () => '아직 공개되지 않은 글이 일정에 포함됨',
  'DUPLICATE-SLUG': () => '같은 장소가 일정에 중복으로 들어감',
  'RAIN-SWAP-DUPLICATE': () => '비 올 때 대체 장소가 중복됨',
  'RAIN-SWAP-IS-STOP': () => '비 올 때 대체 장소가 이미 일정에 있는 곳임',
  'PACKED-GATE-FAIL': () => '일정이 과도하게 빡빡함',
  'AREA-CLAIM-UNSUPPORTED': () => '본문의 동선 설명이 실제 위치와 맞지 않음',
  'UNIVERSAL-AREA-CLAIM': () => '"모두 같은 동네" 같은 단정 표현이 사실과 다름',
  'EMPTY-INTRO': () => '소개 문구가 비어 있음',
  'EMPTY-LABEL': () => '이름표가 비어 있음',
  'EMPTY-WHY': () => '추천 이유가 비어 있음',
  // 번역
  'PROSE-LEAK': (f) => `번역본에 원문 언어가 섞여 있음${f.lang ? ` (${f.lang})` : ''}`,
  'MISSING-COUNTRY': () => '국가 정보가 비어 있음 — 국가별 목록·기후·소셜 카드에서 누락됨',
  'PHOTO-WRONG-VENUE': (f) =>
    `사진이 다른 가게의 것${f.quoted[1] ? ` (글: ${f.quoted[0]} / 사진: ${f.quoted[1]})` : ''}`,
  'SAME-PHOTO-TWICE': () => '같은 사진이 한 글에 두 번 쓰임',
  // 디자인 통일성 (audit-design-uniformity) — 픽서님이 한 번씩 눈으로 잡아낸 이탈들
  'DESIGN-CROWD-PALETTE': () => '혼잡도 그래프 색이 되돌아감 (붐빔=빨강, 보통=베이지여야 함)',
  'DESIGN-NEWSLETTER-CQ': () => '뉴스레터가 좁은 지면에서 다시 글자 단위로 꺾임',
  // 아이콘 클래스는 where()가 이미 앞에 붙인다 — 여기서 또 넣으면 두 번 나온다.
  'DESIGN-ICON-PLATE': () => '카드 아이콘 배경판이 빠져 그 아이콘만 다르게 보임',
  'DESIGN-COLOR-SCHEME': () => '시스템 다크 모드에서 입력창·스크롤바가 흰색으로 뜸',
  'DESIGN-REGION-TILE': () => '사진 없는 도시 타일이 검은 상자로 보임 — backfill-region-covers 실행 필요',
  'DESIGN-DIST-STALE': () => '검사할 빌드 결과가 낡아 디자인 점검을 하지 못함 — 빌드 후 다시 확인 필요',
  'STALE-RATING': () => '평점 정보가 오래되어 실제와 다를 수 있음',
  'LOCAL-PHONE': () => '전화번호가 국내 형식 — 해외 유심에서 전화 연결 안 됨 (+국가번호 필요)',
  'BUSYNESS-OUTSIDE-HOURS': () => '한산/붐빔 시간이 영업시간 밖을 안내함 (repair-busyness-hours 실행 필요)',
  'STALE-RECHECK': () => '장소 정보 재점검이 너무 오래 끊김 — 주간 재점검(refresh) 작동 확인 필요',
  'PLACEHOLDER-TEXT': () => '자리표시 문구가 그대로 남아 있음',
  'STALE-TRANSLATION': () => '원문이 바뀐 뒤 번역이 갱신되지 않음',
  'ORPHAN-TRANSLATION': () => '원문 없는 번역 파일',
  // 공통
  'PARSE-ERROR': () => '파일을 읽지 못함 (형식 오류)',
};

// Stat labels used by the batch jobs' one-line RESULT summaries. Same reasoning
// as the issue codes: translate by label, and let an unknown label degrade to
// the label itself with its number, so a new counter still reports its count
// instead of vanishing from the message.
const STAT = {
  updated: '채움',
  attached: '좌표 붙임',
  'already-complete': '이미 완료',
  'no-new-data': '자료 없음',
  'no-place': '장소 정보 없음',
  'closed-quarantined': '폐업 확인·게시 중단',
  'quota-429': '한도 초과',
  'api-error': '오류',
  processed: '처리',
  skipped: '건너뜀',
  found: '찾음',
  fixed: '수정',
  replaced: '교체',
  failed: '실패',
  total: '전체',
};

/**
 * A job's English one-line RESULT summary → Korean.
 * e.g. "BACKFILL RESULT: updated 18, already-complete 1, … processed 21 of 22 (APPLIED)."
 */
export function koStatLine(raw) {
  const s = String(raw || '').trim();
  if (!s) return '결과를 읽지 못했어요 — 실행 로그를 확인해 주세요.';

  const dryRun = /dry.?run/i.test(s);
  const applied = /\(APPLIED\)/i.test(s);
  // "processed 21 of 22" / "skipped 2 of 9" — the trailing total belongs to the
  // counter right before "of", not to a counter of its own.
  const ofTotal = s.match(/([a-z][a-z0-9-]*)\s+(\d+)\s+of\s+(\d+)/i);

  const parts = [];
  for (const m of s.matchAll(/([a-z][a-z0-9-]*)\s+(\d+)/gi)) {
    const key = m[1].toLowerCase();
    if (key === 'of' || key === 'result') continue;
    if (ofTotal && key === ofTotal[1].toLowerCase() && m[2] === ofTotal[2]) continue;
    // An unmapped counter keeps its number and is marked 기타 rather than being
    // dropped — a counter nobody translated yet is still information.
    parts.push(STAT[key] ? `${STAT[key]} ${m[2]}` : `기타(${key}) ${m[2]}`);
  }
  if (ofTotal) parts.push(`${STAT[ofTotal[1].toLowerCase()] ?? ofTotal[1]} ${ofTotal[2]}/${ofTotal[3]}`);
  if (!parts.length) return '결과를 읽지 못했어요 — 실행 로그를 확인해 주세요.';

  const tail = dryRun ? ' (시험 실행, 실제 반영 안 함)' : applied ? ' (반영 완료)' : '';
  return parts.join(', ') + tail;
}

/** One raw validator line → one Korean line. Never returns English prose. */
// What each audit-i18n-leaks rule actually means, in plain Korean. A rule id
// added there without an entry here still reports — it just names the rule.
const LEAK_RULE = {
  'klook-en-US': '예약 링크가 영어(en-US) 페이지로 연결됨',
  'tickets-tours': '"Tickets & tours for" 문구가 영어 그대로',
  'price-Free': '요금 표시가 "Free"로 영어',
  'time-unit': '소요시간 단위(h/min)가 영어',
  'am-pm': '시간이 "9–10 AM" 식 영어 표기 (한국어는 "오전 9~10시")',
  'ui-where-to-stay': '"Where to stay in" 제목이 영어',
  'ui-plan-your-trip': '"Plan your trip" 제목이 영어',
  'ui-getting-there': '"Getting there" 항목이 영어',
  'ui-all-destinations': '"All destinations" 링크가 영어',
  'ui-when-to-go': '"When to go" 링크가 영어',
};

export function koIssueLine(raw) {
  // ✗/✘/× is the other glyph our audits mark a finding with (✓ is its clean
  // twin, filtered as chrome). Left unstripped, every ✗ line failed the CODE:
  // match below and arrived as "점검 항목 — 대상 미상".
  const line = String(raw).trim().replace(/^[•*\-❌✗✘×]\s*/, '').trim();
  if (!line) return '';

  // audit-i18n-leaks.mjs writes "ko/roundup — am-pm — dist/ko/…/index.html":
  // the rule id sits in the middle and is lower-case, so the CODE: form below
  // never matched and every leak arrived as "점검 항목 — 대상 미상".
  // The same audit's two ⚠️ shapes. "built pages missing" means a whole language
  // was not checked at all, which is the most important line it can print and
  // read as "대상 미상" until this existed.
  const noPages = line.match(/^⚠️?\s*(ko|ja|es|zh)(?:\/(\S+))?:\s*(built pages missing|no pages found)/);
  if (noPages) {
    const [, lang, type, kind] = noPages;
    return kind === 'built pages missing'
      ? `• ${lang} — 빌드된 페이지가 없어 이 언어는 검사조차 못 했습니다`
      : `• ${lang}/${type} — 해당 페이지가 하나도 없어 검사에서 빠졌습니다`;
  }

  const leak = line.match(/^(ko|ja|es|zh)\/(\S+)\s+—\s+([\w-]+)\s+—\s+(.+)$/);
  if (leak) {
    const [, lang, type, rule, path] = leak;
    const what = LEAK_RULE[rule] ?? `영어가 남아 있음 (${rule})`;
    const page = path.replace(/^dist\//, '').replace(/index\.html$/, '');
    return `• ${lang}/${type} · ${page} — ${what}`;
  }

  // validate-content.mjs writes most findings as an English PHRASE, not a
  // CODE: — "PLACEHOLDER/no image [restaurant]: file.md", "TILDE unescaped in
  // …". None matched below, so a night's warning arrived as five lines of
  // "점검 항목 — 대상 미상": a count with no content, about placeholder heroes
  // that were already live. Every phrase that script can print is mapped here;
  // one it can't maps to the fallback, which at least names the file.
  const PHRASES = [
    [/^PLACEHOLDER\/no image(?:\s*\[([^\]]+)\])?/, (mm) => `대표사진이 없음 — 자리표시 이미지로 발행됨${mm[1] ? ` (${mm[1]})` : ''}`],
    [/^TILDE unescaped/, () => '물결표(~)가 그대로 있어 본문 일부가 취소선으로 보임'],
    // 2026-08-02 저녁 보고가 "실행 로그 확인 필요" 18줄로 온 원인 — 어제 새로
    // 생긴 검사 코드 2종이 여기 미등록이었다. 새 검사를 추가하면 이 표도 함께.
    [/TRUNCATED-DESCRIPTION/, () => '검색 요약문이 문장 중간에서 잘림'],
    [/TOOL-SPILL/, () => 'AI 도구 출력이 글에 그대로 유출됨 (페이지 깨짐)'],
    [/ENDED-EVENT-FUTURE-TENSE/, () => '끝난 행사인데 본문이 아직 예정처럼 쓰여 있음'],
    [/^IMAGE MISMATCH suspect/, () => '대표사진이 주제와 무관해 보임'],
    [/^EVENT missing eventStartDate/, () => '행사 시작일이 비어 있음 — 정렬·만료·검색 노출 불가'],
    [/^NON-LATIN script in title/, () => '제목에 현지 문자가 섞여 있음'],
    [/^QUERY-LIKE title/, () => '제목이 검색어 덩어리처럼 보임'],
    [/^FILLER .*in title/, () => '제목에 상투 문구가 되살아남'],
    [/^CITY echoed/, () => '제목에 도시명이 두 번 반복됨'],
    [/^BROKEN TITLE/, () => '제목이 접속사에서 끊겨 있음'],
    [/^GARBLED place\.name/, () => '장소 이름이 검색어 덤프처럼 저장됨'],
    [/^DUPLICATE image/, () => '두 글이 같은 대표사진을 씀'],
    [/^DUPLICATE place\.id/, () => '같은 장소가 두 글로 발행됨'],
    [/^DUPLICATE event coverage/, () => '같은 행사를 두 글이 다룸'],
    [/^CONTRADICTORY event dates/, () => '같은 행사인데 글마다 날짜가 다름'],
    [/^SLASH in region/, () => '지역명에 "/"가 있어 주소가 깨짐'],
    [/^ESSENTIALS .*incomplete/, () => '국가 기본정보 페이지에 빠진 항목이 있음'],
    [/^WALL THUMB missing/, () => '카드 썸네일이 없어 빈 카드로 보임 (build-wall 실행 필요)'],
  ];
  for (const [re, render] of PHRASES) {
    const mm = line.match(re);
    if (mm) {
      const f = facts(line);
      return koLine(f, render(mm));
    }
  }

  const m = line.match(/^([A-Z][A-Z0-9-]{2,}):\s*([\s\S]*)$/);
  if (!m) {
    // A line with no code carries only prose we cannot trust to be Korean.
    const f = facts(line);
    return `• 점검 항목 — ${where(f)}`;
  }
  const [, code, rest] = m;
  const f = facts(rest);
  const body = T[code] ? T[code](f) : `점검 필요 (코드 ${code})`;
  return koLine(f, body);
}

/**
 * Full validator stdout → a Korean digest safe to send.
 *
 * Nothing is ever dropped. A filter that only forwards lines it recognises
 * would silence a real problem the day someone adds a new message format — the
 * warning simply would not arrive, and nobody would know it was missing. So
 * every non-empty line is accounted for: recognised ones are translated,
 * unrecognised ones still produce a Korean line carrying whatever identifying
 * facts they held, and the total count is always stated so a capped list can
 * never hide the rest.
 *
 * `max` only caps how many are SHOWN (Telegram's message limit); the count of
 * the remainder is always reported.
 */
export function koDigest(stdout, { max = 20 } = {}) {
  const all = String(stdout)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  // The validators' own tally, e.g. "❌ 7 itinerary issue(s) across …" — trusted
  // over our line count, so a format we parse badly still reports the true total.
  const declared = Number(all.find((l) => /^❌\s*\d+/.test(l))?.match(/\d+/)?.[0]) || null;

  // Skip only the validator's own headline/OK lines — never an issue line.
  // ✅ and 📋 were missing here, so audit-i18n-leaks.mjs — which ends a CLEAN run
  // with "📋 checked 224 page(s)…" and "✅ no English leaks" — produced "문제 2건"
  // out of its own success message. A false alarm teaches the owner to ignore
  // the alarms, which is worse than no alarm at all.
  // ❌ is used for BOTH the closing tally ("❌ 7 leak(s)") and for each individual
  // finding ("❌ ko/roundup — am-pm — path.html"). Treating every ❌ line as
  // chrome silenced the findings themselves: the owner got a count with no
  // content, for the exact audit — English leaking into Korean pages — he has
  // complained about most. Only the tally is chrome.
  const isChrome = (l) =>
    /^❌\s*\d/.test(l) || /^[✓✔️🌐✅📋]/.test(l) || /^-{3,}$/.test(l) ||
    /^\d+\s*type\(s\) had no pages/.test(l);
  const issues = all.filter((l) => !isChrome(l));

  if (!issues.length) {
    if (declared) {
      // The validator counted problems but printed them in a shape we did not
      // parse. Say so — never report "clean" on the strength of a parse miss.
      return `문제 ${declared}건이 보고됐지만 내용을 읽지 못했어요 — 실행 로그를 확인해 주세요.`;
    }
    // A clean run: a ✓ line and no ❌ tally. Distinct from "we read nothing".
    if (all.some((l) => /^[✓✔️✅]/.test(l))) return '';
    return '내용을 읽지 못했어요 — 실행 로그를 확인해 주세요.';
  }

  const total = declared ?? issues.length;
  const shown = issues.slice(0, max).map(koIssueLine).filter(Boolean);
  const hidden = total - shown.length;
  return (
    `문제 ${total}건\n` +
    shown.join('\n') +
    (hidden > 0 ? `\n… 외 ${hidden}건 (전체는 실행 로그에서 확인)` : '')
  );
}
