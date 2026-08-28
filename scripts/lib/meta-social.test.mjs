// meta-social 회귀 테스트 — 자동 게시의 순수 부품을 고정한다.
//
//   node --test scripts/lib/meta-social.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptStore, decryptStore, loadTokens, saveTokens, thPublish, pickThreadsOption, threadsText, isIgDay } from './meta-social.mjs';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 환경변수를 잠깐 바꿔 실행 — 금고는 SOCIAL_TOKEN_KEY 와 부트스트랩 시크릿을 읽는다.
async function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) { saved[k] = process.env[k]; process.env[k] = v; }
  try { return await fn(); }
  finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
const ENV = { SOCIAL_TOKEN_KEY: '테스트키', INSTAGRAM_ACCESS_TOKEN: 'boot-ig', THREADS_ACCESS_TOKEN: 'boot-th' };

const KEY = createHash('sha256').update('테스트키:wander-atlas-social-token').digest();

test('토큰 금고: 암호화 왕복 + 틀린 키는 실패', () => {
  const obj = { ig: { token: 'IGAAR...x', refreshedAt: '2026-08-27T05:00:00Z' }, th: { token: 'THAA...y', refreshedAt: '2026-08-27T05:00:00Z' } };
  const raw = encryptStore(obj, KEY);
  assert.deepEqual(decryptStore(raw, KEY), obj);
  const wrong = createHash('sha256').update('다른키').digest();
  assert.throws(() => decryptStore(raw, wrong));
});

test('스레드 문구: C(질문형) 우선, KO 줄은 섞이지 않는다', () => {
  const part = 'A: Tip text here.\nKO: 팁 요약\nB: Hook text.\nKO: 훅 요약\nC: Would you climb at dawn?\nKO: 질문 요약';
  assert.equal(pickThreadsOption(part), 'Would you climb at dawn?');
});

test('스레드 문구: C가 없으면 B→A로 물러선다', () => {
  assert.equal(pickThreadsOption('A: Only a tip.\nKO: 팁'), 'Only a tip.');
  assert.equal(pickThreadsOption('A: Tip.\nKO: 팁\nB: The hook.\nKO: 훅'), 'The hook.');
});

test('스레드 문구: 링크 포함 500자 상한을 절대 넘지 않는다', () => {
  const url = 'https://wanderatlasguides.com/posts/some-place/';
  const t = threadsText('x'.repeat(600), url);
  assert.ok(t.length <= 500, `${t.length}자`);
  assert.ok(t.endsWith(url));
});

test('인스타 요일: 월·수·금(KST)만 참', () => {
  // 2026-08-24 = 월요일
  const kst = (d) => new Date(Date.parse(d + 'T12:00:00+09:00') + 9 * 3600e3);
  assert.equal(isIgDay(kst('2026-08-24')), true);  // 월
  assert.equal(isIgDay(kst('2026-08-25')), false); // 화
  assert.equal(isIgDay(kst('2026-08-26')), true);  // 수
  assert.equal(isIgDay(kst('2026-08-27')), false); // 목
  assert.equal(isIgDay(kst('2026-08-28')), true);  // 금
  assert.equal(isIgDay(kst('2026-08-29')), false); // 토
});

// ── 2026-08-27 코덱스 감사 회귀 ──────────────────────────────

test('토큰 금고: 파일이 없을 때만 부트스트랩으로 시작한다', async () => {
  await withEnv(ENV, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ms-'));
    try {
      const t = await loadTokens(join(dir, 'missing.enc'));
      assert.equal(t.ig.token, 'boot-ig');
      assert.equal(t.th.token, 'boot-th');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

test('토큰 금고: 깨진 저장고는 부트스트랩으로 덮지 않고 실패한다', async () => {
  // 감사 지적: 복호화 실패 전부를 "첫 실행"으로 간주해 살아 있는 토큰을
  // 오래된 부트스트랩으로 갈아엎었다. 열쇠 오타 한 번이면 금고가 사라진다.
  await withEnv(ENV, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ms-'));
    try {
      const f = join(dir, 'store.enc');
      writeFileSync(f, 'this is not an encrypted store');
      await assert.rejects(() => loadTokens(f), /재초기화|refusing/i);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

test('토큰 금고: 반쪽짜리 저장고(토큰 누락)도 덮지 않고 실패한다', async () => {
  await withEnv(ENV, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ms-'));
    try {
      const f = join(dir, 'store.enc');
      writeFileSync(f, encryptStore({ ig: { token: 'only-ig' } }) + '\n');
      await assert.rejects(() => loadTokens(f), /재초기화|refusing/i);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

test('토큰 금고: 내용이 그대로면 다시 쓰지 않는다 (커밋 굳이 안 만든다)', async () => {
  // 감사 지적: IV 가 매번 새로 나와 안 바뀐 토큰도 매 실행 새 암호문 커밋을
  // 만들었다 — 멱등성이 푸시 타이밍에 걸린 워크플로에서 충돌 표면만 늘린다.
  await withEnv(ENV, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ms-'));
    try {
      const f = join(dir, 'store.enc');
      const tokens = { ig: { token: 'IG1', refreshedAt: '2026-08-27T00:00:00Z' }, th: { token: 'TH1', refreshedAt: '2026-08-27T00:00:00Z' } };
      await saveTokens(tokens, f);
      const first = readFileSync(f, 'utf8');
      await saveTokens(JSON.parse(JSON.stringify(tokens)), f);
      assert.equal(readFileSync(f, 'utf8'), first, '내용이 같은데 파일이 바뀌었다');
      tokens.th.token = 'TH2';
      await saveTokens(tokens, f);
      assert.notEqual(readFileSync(f, 'utf8'), first, '내용이 바뀌었는데 파일이 그대로다');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

test('스레드: 컨테이너 ERROR 는 그대로 실패한다 (삼키고 게시 강행 금지)', async () => {
  // 감사 지적: waitFinished 가 ERROR 를 정확히 판정해 던지는데 .catch 가 그걸
  // 삼키고 15초 뒤 게시를 강행했다. 터미널 오류는 터미널로 남아야 한다.
  const orig = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url); calls.push(u);
    const body =
      u.includes('/me/threads_publish') ? { id: 'p1' } :
      u.includes('/me/threads') ? { id: 'c1' } :
      u.includes('/c1') ? { status_code: 'ERROR' } : {};
    return { ok: true, status: 200, json: async () => body };
  };
  try {
    await assert.rejects(() => thPublish({ token: 't', text: 'hi', imageUrls: [] }), /ERROR state/);
    assert.ok(!calls.some((c) => c.includes('threads_publish')), 'ERROR 인데 게시를 강행했다');
  } finally { globalThis.fetch = orig; }
});
