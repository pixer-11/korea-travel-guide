import test from 'node:test';
import assert from 'node:assert/strict';
import { eventFuturePromise, timelessRetryMessages } from './writer.mjs';

test('08-22 실제 사례 — quickAnswer·FAQ의 미래 약속을 잡는다', () => {
  assert.equal(eventFuturePromise({ quickAnswer: "Tickets and exact set times haven't been confirmed here, so check the official site.", body: '', faq: [] }), "haven't been confirmed");
  assert.equal(eventFuturePromise({ quickAnswer: 'x', body: '', faq: [{ q: 'Date?', a: 'Check the official site closer to the event for updates.' }] }), 'closer to the event');
  assert.equal(eventFuturePromise({ quickAnswer: 'x', body: 'Additional acts may be announced closer to the date.', faq: [] }), 'closer to the date');
});

test('시간 무관 문구는 통과한다 (태어날 때 깨끗한 글의 모양)', () => {
  assert.equal(eventFuturePromise({
    quickAnswer: 'Sonu Nigam plays Etihad Arena on August 21, 2026. Confirm timing and tickets on the official site.',
    body: 'Doors open at 6pm. Arrive early — Yas Island access roads fill fast on concert nights.',
    faq: [{ q: 'Is the date confirmed?', a: 'August 21 is the announced date; the official site is the authority for any change.' }],
  }), null);
});

// 2026-08-27: the retry conversation itself killed the run — the assistant
// turn ends in a tool_use, and the follow-up user message opened with plain
// text, so the API refused the whole request (400, "tool_use ids were found
// without tool_result"). Lock the shape: tool_result FIRST, matching id.
test('timeless retry answers the tool_use before asking again', () => {
  const firstMsg = { content: [{ type: 'tool_use', id: 'toolu_test1', name: 'submit_guide', input: {} }] };
  const msgs = timelessRetryMessages('PROMPT', firstMsg, 'toolu_test1', 'once released');
  assert.equal(msgs.length, 3);
  assert.equal(msgs[1].role, 'assistant');
  assert.equal(msgs[1].content, firstMsg.content);
  const last = msgs[2];
  assert.equal(last.role, 'user');
  assert.equal(last.content[0].type, 'tool_result');
  assert.equal(last.content[0].tool_use_id, 'toolu_test1');
  assert.equal(last.content[1].type, 'text');
  assert.match(last.content[1].text, /once released/);
  assert.match(last.content[1].text, /EVENT PAGES STAY ONLINE|timelessly/i);
});

