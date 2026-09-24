import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { timelessRetryMessages, tellRetryMessages } from './writer.mjs';

// A retry must continue the conversation the model actually had. On Opus 5.5 a
// draft's thinking blocks are bound to that exact history; replaying a rebuilt
// first message (2026-09-24: the prompt without the tool-only note) returned 200
// and silently dropped them, so no ordinary run could have noticed.

const history = [
  { role: 'user', content: 'PROMPT\n\nAnswer ONLY by calling the submit_guide tool. Do not reply with plain text.' },
  { role: 'assistant', content: [{ type: 'text', text: 'prose instead of a tool call' }] },
  { role: 'user', content: 'Submit that guide by calling the submit_guide tool now. Do not reply with plain text.' },
];
const draft = { content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'tool_use', id: 'toolu_x', name: 'submit_guide', input: {} }] };

for (const [name, build, arg] of [
  ['timeless', timelessRetryMessages, 'once released'],
  ['tell', tellRetryMessages, 'in the heart of'],
]) {
  test(`${name} retry replays the prior turns exactly, then the draft, then the request`, () => {
    const msgs = build(history, draft, 'toolu_x', arg);
    assert.equal(msgs.length, history.length + 2);
    assert.deepEqual(msgs.slice(0, history.length), history);
    assert.equal(msgs[history.length].role, 'assistant');
    assert.equal(msgs[history.length].content, draft.content); // same object: thinking untouched
    const last = msgs.at(-1);
    assert.equal(last.content[0].type, 'tool_result');
    assert.equal(last.content[0].tool_use_id, 'toolu_x');
  });

  test(`${name} retry still accepts a bare prompt string as a one-turn history`, () => {
    const msgs = build('PROMPT', draft, 'toolu_x', arg);
    assert.deepEqual(msgs[0], { role: 'user', content: 'PROMPT' });
    assert.equal(msgs.length, 3);
  });
}

test('writeArticle hands the retries the history it sent, not a rebuilt prompt', () => {
  const src = readFileSync(new URL('./writer.mjs', import.meta.url), 'utf8');
  // The exact regression: building the retry from userPrompt re-creates turn one
  // without whatever was appended to it on the way out.
  assert.doesNotMatch(src, /RetryMessages\(\s*userPrompt\b/);
  assert.match(src, /timelessRetryMessages\(\s*history\b/);
  assert.match(src, /tellRetryMessages\(\s*history\b/);
  // And the first call sends that same history array.
  assert.match(src, /messages:\s*history\b/);
});
