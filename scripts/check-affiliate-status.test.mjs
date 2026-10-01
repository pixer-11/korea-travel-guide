// check-affiliate-status 회귀 테스트 (2026-09-29). 인터넷 없이 가짜 서버로만 돈다.
//
// 코덱스 리뷰가 첫 판에서 찾은 거짓 통과 두 가지와, 빨간불이 아닌데 잡을 죽이던
// 경우 하나를 고정한다: ① 추적 토큰이 빈 Klook 주소(api|13694|-754088)도 754088 이
// 보인다는 이유로 통과 ② 2.6KB 짜리 403 오류 페이지를 위젯으로 통과 ③ 헤더 뒤에
// 끊긴 연결이 잡히지 않은 예외로 새어 나감. 정상 링크가 통과하는지도 함께 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const GOOD_AID = 'api%7C13694%7Ce07882045e234650b32ac6a66-754088%7Cpid%7C754088';
const EMPTY_AID = 'api%7C13694%7C-754088%7Cpid%7C754088';

function server(mode) {
  const srv = http.createServer((req, res) => {
    if (req.url.startsWith('/go/klook')) {
      // hops: bounce through /hop/N first, to test the redirect limit.
      const target = mode.hops ? '/hop/1' : `https://affiliate.klook.com/redirect?aid=${mode.aid}${mode.tail ?? '&k_site=x'}`;
      res.writeHead(302, { Location: target });
      return res.end();
    }
    if (req.url.startsWith('/r?')) {
      // Tiqets deep link (tp.media/r). 'nomarker' = the program stopped crediting us.
      const tq = mode.tiqets === 'nomarker' ? '/end-without-marker' : mode.tiqets === 'stray' ? 'https://www.tiqets.com/en/?q=754088' : 'https://www.tiqets.com/en/?partner=travelpayouts.com&tq_campaign=abc-754088';
      res.writeHead(302, { Location: tq });
      return res.end();
    }
    if (req.url.startsWith('/hop/')) {
      const n = Number(req.url.split('/')[2]);
      res.writeHead(302, { Location: n < mode.hops ? `/hop/${n + 1}` : `https://affiliate.klook.com/redirect?aid=${mode.aid}&k_site=x` });
      return res.end();
    }
    if (mode.widget === 'comment') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('<!-- proxy error --><html>' + 'x'.repeat(2600)); }
    if (mode.widget === '403') { res.writeHead(403, { 'Content-Type': 'text/html' }); return res.end('<!doctype html>' + 'x'.repeat(2600)); }
    if (mode.widget === 'html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>' + 'x'.repeat(2600)); }
    if (mode.widget === 'drop') { res.writeHead(200); res.write('var a=1;'); setTimeout(() => res.destroy(), 30); return; }
    if (mode.widget === 'jsWithHtml') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end('var doc="<!doctype html><html><body></body></html>";' + 'x'.repeat(3000)); }
    res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end('/*widget*/' + 'x'.repeat(3000));
  });
  return new Promise((r) => srv.listen(0, () => r(srv)));
}

async function run(mode) {
  const srv = await server(mode);
  const base = `http://localhost:${srv.address().port}`;
  // A source tree with one widget and no shortlinks, so nothing leaves the machine.
  const src = mkdtempSync(join(tmpdir(), 'affsrc-'));
  writeFileSync(join(src, 'w.astro'), 'const w = `https://tpemd.com/content?a=1&promo_id=7879`;\n');
  try {
    return await new Promise((resolve) => {
      let out = '';
      const c = spawn(process.execPath, ['scripts/check-affiliate-status.mjs', src], {
        env: { ...process.env, SITE_URL: base, WIDGET_BASE: base, TIQETS_BASE: base },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      c.stdout.on('data', (d) => (out += d));
      c.stderr.on('data', (d) => (out += d));
      // 'close', not 'exit': exit can fire before the pipes are drained.
      c.on('close', (code) => resolve({ code, out }));
    });
  } finally {
    srv.close();
    rmSync(src, { recursive: true, force: true });
  }
}

test('정상 토큰 링크 + 정상 위젯은 통과한다', async () => {
  const r = await run({ aid: GOOD_AID, widget: 'ok' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /ok=3 broken=0/);
});

test('추적 토큰이 빈 Klook 주소는 754088 이 보여도 실패다', async () => {
  const r = await run({ aid: EMPTY_AID, widget: 'ok' });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /no click token/);
});

test('길이가 길어도 403 오류 페이지는 위젯이 아니다', async () => {
  const r = await run({ aid: GOOD_AID, widget: '403' });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /widget promo_id=7879 {2}— HTTP 403/);
});

test('200 이어도 HTML 페이지는 위젯이 아니다', async () => {
  const r = await run({ aid: GOOD_AID, widget: 'html' });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /HTML page instead of the widget/);
});

test('헤더 뒤에 끊긴 연결은 예외로 죽지 않고 못 잰 것으로 남는다', async () => {
  const r = await run({ aid: GOOD_AID, widget: 'drop' });
  assert.doesNotMatch(r.out, /Unhandled|TypeError|at async/);
  assert.match(r.out, /unmeasured=1/);
  assert.equal(r.code, 0, r.out);   // 호텔 링크는 쟀고 정상 — 못 잰 위젯 하나로 빨간불을 켜지 않는다
});

// ── 코덱스 2차(09-29)가 찾은 경계 사례 ─────────────────────────────
test('빈 aid 에 토큰 모양 글자를 다른 칸에 붙여도 속지 않는다', async () => {
  const r = await run({ aid: EMPTY_AID, tail: '&x=api%7C13694%7Ce07882045e234650b32ac6a66-754088', widget: 'ok' });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /no click token/);
});

test('주소에 % 가 섞여도 작업이 죽지 않고 정상 판정한다', async () => {
  const r = await run({ aid: GOOD_AID, tail: '&label=50%', widget: 'ok' });
  assert.doesNotMatch(r.out, /URIError/);
  assert.equal(r.code, 0, r.out);
});

test('주석으로 시작하는 HTML 오류 페이지도 위젯이 아니다', async () => {
  const r = await run({ aid: GOOD_AID, widget: 'comment' });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /HTML page instead of the widget/);
});

test('리다이렉트를 딱 8번 거쳐 정상 주소에 닿으면 통과한다', async () => {
  // /go/klook → /hop/1 → … → /hop/7 → klook = 8 redirects
  const r = await run({ aid: GOOD_AID, hops: 7, widget: 'ok' });
  assert.equal(r.code, 0, r.out);
});

test('9번째 리다이렉트가 필요하면 too many redirects 로 실패한다', async () => {
  const r = await run({ aid: GOOD_AID, hops: 8, widget: 'ok' });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /too many redirects/);
});

test('위젯 코드 안에 "<html>" 글자가 있어도 정상 위젯이다 (코덱스 3차)', async () => {
  const r = await run({ aid: GOOD_AID, widget: 'jsWithHtml' });
  assert.equal(r.code, 0, r.out);
});

test('마커 없이 도착하는 Tiqets 링크는 실패다', async () => {
  const r = await run({ aid: GOOD_AID, widget: 'ok', tiqets: 'nomarker' });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /tiqets-link\.mjs/);
  assert.match(r.out, /without marker 754088/);
});

test('754088 이 아무 데나 있을 뿐 제휴 꼬리표가 없는 Tiqets 도착지는 실패다 (코덱스 10-01)', async () => {
  const r = await run({ aid: GOOD_AID, widget: 'ok', tiqets: 'stray' });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /cannot be credited/);
});
