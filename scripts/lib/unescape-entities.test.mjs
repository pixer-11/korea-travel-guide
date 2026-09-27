//   node --test scripts/lib/unescape-entities.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { unescapeEntities as u } from './unescape-entities.mjs';

test('the two titles that shipped escaped come back as plain text', () => {
  assert.equal(u('ITZY 세 번째 월드투어 &lt;TUNNEL VISION&gt;'), 'ITZY 세 번째 월드투어 <TUNNEL VISION>');
  assert.equal(u("칼리드(Khalid) &lt;It's Always Summer Somewhere&gt; 투어"), "칼리드(Khalid) <It's Always Summer Somewhere> 투어");
  assert.equal(u('Cheaper &amp; Better'), 'Cheaper & Better');
});

test('plain text and a lone ampersand are left alone', () => {
  assert.equal(u('Dates, Tickets & Venue'), 'Dates, Tickets & Venue');
  assert.equal(u('R&D 5&6'), 'R&D 5&6');
  assert.equal(u(undefined), undefined);
});

test('&amp; is decoded once, last', () => {
  assert.equal(u('&amp;lt;'), '&lt;');
  assert.equal(u('&#39;quoted&#39; &quot;x&quot; &#12354;'), '\'quoted\' "x" あ');
});
