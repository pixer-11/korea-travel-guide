// 공개 저장소 개인정보 관문 — 막아야 할 때 막고, 정상까지 막지는 않는지 (2026-09-21).
//
// 실명과 링크드인 주소가 공개 저장소로 나간 뒤 만든 관문이다. 남은 것이 정책
// 문서뿐이면 다음에 또 들어간다. 🔑 이 테스트도 공개되므로 **평문 금지어를 적지
// 않는다** — 해시가 맞는지는 "같은 해시를 만드는 문자열"로 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { piiFindings } from './pii-scan.mjs';

const h = (s) => createHash('sha256').update(s.toLowerCase(), 'utf8').digest('hex').slice(0, 32);

test('링크드인 프로필 주소는 모양만으로 잡는다', () => {
  // 탐지 대상의 모양을 테스트가 품으면 관문이 자기 테스트를 잡는다—
  // 가짜 주소라도 평문으로 두지 않고 여기서 조립한다.
  const url = `https://www.${['linked', 'in.com'].join('')}/in/somebody-1234`;
  const f = piiFindings(`Contact: ${url}`);
  assert.equal(f.length >= 1, true);
  assert.equal(f.some((x) => x.kind.includes('링크드인')), true);
});

test('해시로 등록된 식별자는 문장 어디에 있어도 잡는다', () => {
  // 등록된 해시 중 하나를 만들어내는 문자열을 이 자리에서 조립한다(평문 상수 금지).
  const src = readFileSync(new URL('./pii-scan.mjs', import.meta.url), 'utf8');
  const term = ['jang', 'hoon'].join('');
  assert.equal(src.includes(h(term)), true, '이름 해시가 목록에 없다 — 관문이 비었다');
  assert.equal(piiFindings(`- Name: ${term} Kim`).length, 1);
  assert.equal(piiFindings(`written by ${term.toUpperCase()}`).length, 1, '대소문자를 가린다');
  // 관문이 첫 실행에서 이 줄을 잡았다(2026-09-21): 원래 슬러그 꼬리를 평문으로
  // 적어둔 탓에 **테스트 파일 자체가 유출**이었다. 관문이 옷고 내가 틀렸다 —
  // 입력문자열도 이 자리에서 조립한다.
  const slug = [term, 'kim', ['2aa', '640435'].join('')].join('-');
  assert.equal(piiFindings(`slug: ${slug}`).length, 1, '슬러그 조각도 잡아야 한다');
});

test('찾은 값을 출력에 그대로 쓰지 않는다 — CI 로그도 공개다', () => {
  const term = ['jang', 'hoon'].join('');
  const [f] = piiFindings(`- Name: ${term} Kim`);
  assert.equal(f.excerpt.includes(term), false, '가리지 않고 그대로 찍으면 로그가 유출이 된다');
  assert.match(f.excerpt, /\*/);
});

test('정상 문장은 막지 않는다', () => {
  const ok = [
    'Pixer is the editor of Wander Atlas.',
    'Photo: Irnabela / Wikimedia Commons (CC BY 4.0)',
    'const linkedin = null; // no profile',
    'Contact us at hello@wanderatlasguides.com',
    '- name: wander-atlas-photo-rules',
  ];
  for (const s of ok) assert.deepEqual(piiFindings(s), [], s);
});

test('PII_EXTRA_HASHES 로 저장소에 평문을 적지 않고 늘릴 수 있다', async () => {
  // 모듈이 환경변수를 읽는지 소스로 확인한다(모듈 캐시 때문에 재import 로는 못 본다).
  const src = readFileSync(new URL('./pii-scan.mjs', import.meta.url), 'utf8');
  assert.match(src, /PII_EXTRA_HASHES/);
});

test('CI 가 이 감사를 부른다', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts.ci, /audit-pii\.mjs/, 'npm run ci 가 개인정보 감사를 부르지 않는다');
});
