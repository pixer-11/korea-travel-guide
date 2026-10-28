// Klook 중계 회귀 테스트.
//
// 이 경로는 사이트 최대 수익원(투어·티켓·"숙소" 블록 전체)의 클릭 추적을 담당한다.
// 2026-07-29~08-06 동안 추적 토큰이 비어 있었고, 링크는 멀쩡히 Klook 에 도착했기
// 때문에 아무도 눈치채지 못했다 — 예약이 일어나도 기록되지 않는 상태였다.
// 그래서 "조용히 망가지는" 세 가지를 고정한다: 경로(슬래시 유무), 토큰 판정,
// 실패 시 폴백.
//
//   node worker/klook-relay.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('./index.mjs', import.meta.url)), 'utf8');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('라우터가 슬래시 있는 형태도 받는다', () => {
  // 빌드의 trailing-slash 정규화가 모든 href 를 /go/klook/ 로 바꾼다. 슬래시
  // 없는 형태만 받으면 8,706개 링크가 전부 404 로 간다.
  const ok = /pathname === '\/go\/klook'\s*\|\|\s*pathname === '\/go\/klook\/'/.test(src);
  return ok ? null : '슬래시 있는 경로가 라우터에 없음';
});

t('목적지는 klook.com 으로만 보낸다', () => {
  // ?to= 는 사용자가 조작할 수 있다 — 열린 리다이렉트가 되면 안 된다.
  const ok = /\/\^https:\\\/\\\/\(www\\\.\)\?klook\\\.com\\\//.test(src);
  return ok ? null : '목적지 화이트리스트가 없음 (열린 리다이렉트 위험)';
});

t('토큰이 없는 aid 는 채택하지 않는다', () => {
  const ok = /\|13694\\\|\[0-9a-f\]\{8,\}-/.test(src);
  return ok ? null : '토큰 형식 검사가 없음';
});

t('실패해도 독자는 Klook 에 도착한다', () => {
  const hasFallback = /const fallback = /.test(src) && /catch\s*\{\s*return Response\.redirect\(fallback/.test(src);
  return hasFallback ? null : '폴백 경로가 없음 — 오류 시 버튼이 죽는다';
});

t('실제 TP 응답에서 토큰을 뽑아낸다', async () => {
  // 네트워크 테스트. TP 가 형식을 바꾸면 여기서 먼저 드러난다. 다만 기본은
  // 꺼둔다 — CI 에서 TP 쪽 장애가 우리 빌드를 빨갛게 만들면, 사람은 곧 이
  // 워크플로를 무시하게 된다. 형식 확인이 필요할 때 NET=1 로 켠다.
  if (process.env.NET !== '1') return 'SKIP(NET=1 로 실행하면 실제 호출)';
  let res;
  try { res = await fetch('https://klook.tpx.lv/2NXPH8MA', { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WanderAtlasRelay/1.0; +https://wanderatlasguides.com)' } }); }
  catch (e) { return `SKIP(네트워크): ${e.message.slice(0, 40)}`; }
  const loc = res.headers.get('location') || '';
  if (!loc) return 'TP 가 Location 헤더를 주지 않음';
  const aid = new URL(loc).searchParams.get('aid');
  if (!aid) return `aid 파라미터 없음: ${loc.slice(0, 80)}`;
  return /\|13694\|[0-9a-f]{8,}-/.test(aid) ? null : `토큰 없는 aid: ${aid}`;
});

t('단축 링크 호출에 User-Agent 를 싣는다', () => {
  // 10-13부터 TP 단축 링크가 UA 없는 요청을 403 으로 막는다. 워커 fetch 는
  // UA 를 안 보내므로, 빠지면 모든 클릭이 토큰 없는 폴백으로 간다.
  const ok = /fetch\(shortLink, \{[^}]*headers: \{ 'User-Agent': relayUserAgent\(request\) \}/.test(src);
  return ok ? null : '단축 링크 fetch 에 User-Agent 가 없음';
});

// ── SubID: 어느 페이지가 이 클릭을 만들었는가 ────────────────
// 클릭 94건 / 예약 0건인데 어느 페이지 몫인지 알 길이 없었다. Referer 로
// 출처를 알아내 sub_id 로 넘긴다 — 헤더는 조작 가능하므로 정규화가 방어선이다.
const { subIdFromReferer, relayUserAgent } = await import('./index.mjs');

t('독자의 UA 를 그대로 싣고, 없을 때만 우리 UA', () => {
  const req = (ua) => ({ headers: new Headers(ua ? { 'user-agent': ua } : {}) });
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)';
  if (relayUserAgent(req(iphone)) !== iphone) return '독자 UA 를 바꿔 보냄';
  if (!/WanderAtlasRelay/.test(relayUserAgent(req(''))) ) return 'UA 없는 요청에 우리 UA 가 안 붙음';
  return null;
});

t('출처 경로가 SubID 가 된다', () => {
  const got = subIdFromReferer('https://wanderatlasguides.com/posts/seoul-gyeongbokgung-palace/');
  return got === 'posts_seoul_gyeongbokgung_palace' ? null : `got ${got}`;
});

t('홈은 home 으로', () => {
  const got = subIdFromReferer('https://wanderatlasguides.com/');
  return got === 'home' ? null : `got ${got}`;
});

t('남의 사이트 Referer 는 거부한다', () => {
  // 받아주면 남의 트래픽이 우리 SubID 로 기록된다.
  const evil = subIdFromReferer('https://evil.example.com/posts/x/');
  const lookalike = subIdFromReferer('https://wanderatlasguides.com.evil.example/x/');
  return evil === null && lookalike === null ? null : `evil=${evil} lookalike=${lookalike}`;
});

t('Referer 가 없거나 깨져도 죽지 않는다', () => {
  const a = subIdFromReferer(null), b = subIdFromReferer(''), c = subIdFromReferer('not a url');
  return a === null && b === null && c === null ? null : `${a} ${b} ${c}`;
});

t('SubID 는 영문·숫자·밑줄만, 80자 이하', () => {
  // TP 규칙: 숫자·라틴문자·"_" 만 허용.
  const got = subIdFromReferer('https://wanderatlasguides.com/ko/posts/' + 'a'.repeat(200) + '/?q=1');
  if (got === null) return 'null 을 반환함';
  if (!/^[a-z0-9_]+$/.test(got)) return `허용되지 않는 문자: ${got.slice(0, 40)}`;
  return got.length <= 80 ? null : `너무 김: ${got.length}자`;
});

t('현지화 경로는 언어별로 구분된다', () => {
  const ko = subIdFromReferer('https://wanderatlasguides.com/ko/tools/esim/');
  const en = subIdFromReferer('https://wanderatlasguides.com/tools/esim/');
  return ko !== en && ko === 'ko_tools_esim' ? null : `ko=${ko} en=${en}`;
});

t('중계가 SubID 를 숏링크에 붙인다', () => {
  // 토큰을 발급받는 그 요청이 TP 가 기록하는 클릭이다 — 여기 말고 붙일 곳이 없다.
  const ok = /sub_id=\$\{subId\}/.test(src) && /fetch\(shortLink/.test(src);
  return ok ? null : '숏링크 요청에 sub_id 가 붙지 않음';
});

// ── 독자만 클릭으로 센다 (10-18) ─────────────────────────────
// Travelpayouts 가 Klook 대신 "비정상 급증"을 물어 왔다. 워커 4분 로그에서
// 요청 21건 중 17건이 /go/klook — 싱가포르 호스팅·텐센트·MS 대역, Referer 없음
// 또는 /go/klook 자신, 브라우저처럼 보이는 UA. 10-13 UA 수리 뒤로 그 전부가
// TP 클릭으로 기록됐다. 독자는 항상 우리 페이지에서 온다.
const { isReaderClick } = await import('./index.mjs');
const reqOf = (ua, referer) => ({ headers: new Headers({ ...(ua ? { 'user-agent': ua } : {}), ...(referer ? { referer } : {}) }) });
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

t('우리 글에서 누른 브라우저는 독자다', () =>
  isReaderClick(reqOf(CHROME, 'https://wanderatlasguides.com/posts/shanghai-the-bund/')) &&
  isReaderClick(reqOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'https://wanderatlasguides.com/ko/'))
    ? null : '정상 클릭을 막는다 — 수익이 끊긴다');

t('Referer 없음·/go/ 자기참조·남의 사이트는 독자가 아니다', () => {
  const bad = [
    reqOf(CHROME, null),
    reqOf(CHROME, 'https://wanderatlasguides.com/go/klook/?to=https%3A%2F%2Fwww.klook.com'),
    reqOf(CHROME, 'https://evil.example.com/posts/x/'),
    reqOf(CHROME, 'https://wanderatlasguides.com.evil.example/x/'),
    reqOf(CHROME, 'not a url'),
  ].filter(isReaderClick);
  return bad.length ? `${bad.length}건을 독자로 셌다` : null;
});

t('봇 UA·UA 없음은 독자가 아니다', () => {
  const ref = 'https://wanderatlasguides.com/posts/x/';
  const bad = ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amazonbot/0.1)',
    'Mozilla/5.0 (compatible; bingbot/2.0)', 'python-requests/2.31', 'curl/8.4', '',
    'Mozilla/5.0 HeadlessChrome/120.0'].filter((ua) => isReaderClick(reqOf(ua, ref)));
  return bad.length ? `독자로 셈: ${bad.join(' | ')}` : null;
});

// ── 10-28 재발: Referer 를 위조한 봇 ──────────────────────────
// 10월 클룩 클릭 45,149회·예약 0. 워커 2분 로그: 베트남·요르단·남아공·파키스탄·
// 필리핀 가정용 회선, 크롬 UA, Referer "https://wanderatlasguides.com"(끝 / 없음),
// Sec-Fetch-Site "none". 브라우저는 이 조합을 보내지 않는다.
const reqH = (h) => ({ headers: new Headers({ 'user-agent': CHROME, ...h }) });
t('Referer 를 위조한 봇(10-28 로그 그대로)은 독자가 아니다', () => {
  const bad = [
    reqH({ referer: 'https://wanderatlasguides.com', 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate', 'sec-fetch-user': '?1' }),
    reqH({ referer: 'https://wanderatlasguides.com' }),
    reqH({ referer: 'https://wanderatlasguides.com/posts/x/', 'sec-fetch-site': 'none' }),
    reqH({ referer: 'https://wanderatlasguides.com/posts/x/', 'sec-fetch-site': 'cross-site' }),
    reqH({ referer: 'https://wanderatlasguides.com/posts/x/', 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' }),
    reqH({ referer: 'https://wanderatlasguides.com/posts/x/', 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'no-cors' }),
  ].filter(isReaderClick);
  return bad.length ? `${bad.length}건을 독자로 셌다` : null;
});
t('Sec-Fetch 를 보내는 진짜 클릭과 안 보내는 옛 브라우저는 독자다', () =>
  isReaderClick(reqH({ referer: 'https://wanderatlasguides.com/posts/x/', 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate', 'sec-fetch-user': '?1' })) &&
  isReaderClick(reqH({ referer: 'https://wanderatlasguides.com/' })) &&
  isReaderClick(reqH({ referer: 'https://wanderatlasguides.com/es/?q=1' }))
    ? null : '정상 클릭을 막는다 — 수익이 끊긴다');

t('독자가 아니면 TP 단축 링크를 부르기 전에 돌려보낸다', () => {
  // 순서가 핵심이다: fetch(shortLink) 자체가 TP 가 세는 클릭이다.
  const fn = src.match(/async function handleKlookGo[\s\S]*?\n}/)?.[0] ?? '';
  const gate = fn.indexOf('isReaderClick(request)'), call = fn.indexOf('fetch(shortLink');
  if (gate < 0) return '판정이 없다';
  if (!(gate < call)) return '판정이 단축 링크 호출보다 뒤에 있다 — 봇 클릭이 이미 기록된다';
  return /if \(!isReaderClick\(request\)\) return Response\.redirect\(dest, 302\)/.test(fn) ? null : '독자가 아닐 때 제휴 없는 Klook 으로 보내지 않는다';
});

// ── 명시적 sub_id ─────────────────────────────────────────────
// Referer 는 "어느 페이지"까지만 안다. 컴포넌트는 "그 페이지의 어느 블록"인지
// 알고, 투어 위젯과 하단 고정바를 구분하는 것이 다음 링크를 어디에 둘지 아는
// 유일한 방법이다. 쿼리 파라미터는 헤더만큼이나 조작 가능하므로 Referer 경로와
// 같은 알파벳으로 걸러야 한다.
t('명시적 sub_id 를 읽는다', () =>
  /searchParams\.get\('sub_id'\)/.test(src) ? null : 'handleKlookGo 가 ?sub_id= 를 읽지 않는다');

t('명시적 sub_id 가 Referer 보다 우선한다', () =>
  /explicitSubId\(reqUrl\)\s*\?\?\s*subIdFromReferer/.test(src)
    ? null
    : 'Referer 가 명시적 값을 덮어쓰거나 순서가 뒤바뀌었다');

t('명시적 sub_id 도 [a-z0-9_] 로 걸러진다', () => {
  // String.raw — 이 줄을 heredoc 으로 쓰다가 \n 이 실제 개행이 되어 정규식이
  // 통째로 깨졌다. lint-regex.mjs 가 감시하는 바로 그 함정.
  const body = new RegExp(String.raw`function explicitSubId[\s\S]*?\n}`);
  const fn = src.match(body)?.[0] ?? '';
  if (!fn) return 'explicitSubId 가 없다';
  if (!/\[\^a-z0-9\]\+/.test(fn)) return '문자 필터가 없다 — 임의 문자열이 URL 로 들어간다';
  if (!/slice\(0, *80\)/.test(fn)) return '길이 제한이 없다';
  return null;
});

let fail = 0;
for (const [name, fn] of cases) {
  let err;
  try { err = await fn(); } catch (e) { err = `threw: ${e.message}`; }
  if (typeof err === 'string' && err.startsWith('SKIP')) { console.log(`SKIP  ${name} — ${err}`); continue; }
  console.log(`${err ? 'FAIL' : 'PASS'}  ${name}${err ? ' — ' + err : ''}`);
  if (err) fail++;
}
console.log(`\n${cases.length - fail}/${cases.length} passed`);
process.exit(fail ? 1 : 0);

