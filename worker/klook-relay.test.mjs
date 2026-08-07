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
  try { res = await fetch('https://klook.tpx.lv/2NXPH8MA', { redirect: 'manual' }); }
  catch (e) { return `SKIP(네트워크): ${e.message.slice(0, 40)}`; }
  const loc = res.headers.get('location') || '';
  if (!loc) return 'TP 가 Location 헤더를 주지 않음';
  const aid = new URL(loc).searchParams.get('aid');
  if (!aid) return `aid 파라미터 없음: ${loc.slice(0, 80)}`;
  return /\|13694\|[0-9a-f]{8,}-/.test(aid) ? null : `토큰 없는 aid: ${aid}`;
});

// ── SubID: 어느 페이지가 이 클릭을 만들었는가 ────────────────
// 클릭 94건 / 예약 0건인데 어느 페이지 몫인지 알 길이 없었다. Referer 로
// 출처를 알아내 sub_id 로 넘긴다 — 헤더는 조작 가능하므로 정규화가 방어선이다.
const { subIdFromReferer } = await import('./index.mjs');

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

