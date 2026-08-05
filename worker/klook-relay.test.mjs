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
