import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJudgeReply } from './translation-quality.mjs';

// The judge shipped on 2026-08-15 with no test and a 600-token budget. On
// 2026-08-16 the evening sweep found it had been answering "unavailable" for
// roughly a quarter of its calls: the model spends thinking tokens out of the
// same max_tokens budget, so a hard text produced content:[{type:'thinking'}]
// and nothing else. These cases pin the three replies the parser must tell
// apart — a usable verdict, a budget wall (retry BIGGER), and a genuinely
// broken reply (retry the same) — because getting that distinction wrong is
// what made 93 translations silently unjudged, 52 of them Chinese.

const reply = (blocks, stop_reason = 'end_turn') => ({ content: blocks, stop_reason });
const textBlock = (t) => ({ type: 'text', text: t });

// ── the verdict that must come through ──────────────────────────────────────
test('a compact JSON reply parses to a verdict', () => {
  const v = parseJudgeReply(reply([textBlock('{"translationese":2,"registerBreak":false,"worst":"어색한 문장"}')]));
  assert.deepEqual(v, { score: 2, registerBreak: false, worst: '어색한 문장' });
});

// Verbatim shape of a real claude-sonnet-5 reply: a thinking block FIRST, then
// the JSON. The old parser handled this fine — it only broke when the thinking
// block was all there was, so the happy path must keep working unchanged.
test('a thinking block before the JSON is ignored, not fatal', () => {
  const v = parseJudgeReply(reply([
    { type: 'thinking', thinking: 'Let me read this Chinese text carefully...' },
    textBlock('{"translationese":1,"registerBreak":false,"worst":"临海而设"}'),
  ]));
  assert.equal(v.score, 1);
});

test('prose wrapped around the JSON still yields the verdict', () => {
  const v = parseJudgeReply(reply([textBlock('Here is my judgment:\n{"translationese":3,"registerBreak":true,"worst":"x"}\nHope that helps.')]));
  assert.equal(v.score, 3);
  assert.equal(v.registerBreak, true);
});

test('worst is clipped so one runaway sentence cannot bloat the store', () => {
  const v = parseJudgeReply(reply([textBlock(`{"translationese":2,"registerBreak":false,"worst":"${'가'.repeat(400)}"}`)]));
  assert.equal(v.worst.length, 120);
});

// ── the budget wall: must be flagged truncated so the caller goes BIGGER ────
// This is the exact payload that broke the judge: zh/abu-dhabi-yana at
// max_tokens 600 returned blocks ["thinking"], stop_reason "max_tokens",
// output_tokens 600, text length 0. At 2000 the same text answered on the
// first try (965 tokens used, score 2).
test('thinking-only reply at the budget wall is reported as truncated', () => {
  assert.throws(
    () => parseJudgeReply(reply([{ type: 'thinking', thinking: 'x'.repeat(50) }], 'max_tokens')),
    (e) => e.truncated === true && /truncated/.test(e.message),
  );
});

test('JSON cut off mid-object at the wall is truncated, not malformed', () => {
  assert.throws(
    () => parseJudgeReply(reply([textBlock('{"translationese":2,"registerBr')], 'max_tokens')),
    (e) => e.truncated === true,
  );
});

// ── the other direction: a real breakage must NOT claim truncation ─────────
// If everything were treated as "retry bigger", a model that simply refuses or
// chats would burn the whole escalation ladder on every call. The guard has to
// hold in both directions, per the bidirectional-guard rule.
test('an empty reply that did NOT hit the wall is not truncated', () => {
  assert.throws(
    () => parseJudgeReply(reply([], 'end_turn')),
    (e) => e.truncated === false && /empty/.test(e.message),
  );
});

test('a complete reply with no JSON at all is not truncated', () => {
  assert.throws(
    () => parseJudgeReply(reply([textBlock('I cannot evaluate this text.')], 'end_turn')),
    (e) => e.truncated === false,
  );
});

test('valid JSON that is missing the score is rejected', () => {
  assert.throws(() => parseJudgeReply(reply([textBlock('{"registerBreak":false,"worst":"x"}')], 'end_turn')));
});
