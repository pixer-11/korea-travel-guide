import test from 'node:test';
import assert from 'node:assert/strict';
import { eventSchemaName, eventProperName } from './eventName.mjs';

test('drops the standard "(City)" article suffix', () => {
  assert.equal(
    eventSchemaName('Lollapalooza 2026: What to Know (Chicago)'),
    'Lollapalooza 2026',
  );
});

test('drops the "in City" variant', () => {
  assert.equal(
    eventSchemaName('Tour de France Femmes avec Zwift: What to Know in Nice'),
    'Tour de France Femmes avec Zwift',
  );
});

test('cuts at the suffix, not at the first colon in the event name', () => {
  assert.equal(
    eventSchemaName('UFC Fight Night: Ankalaev vs Rountree Jr: What to Know (Abu Dhabi)'),
    'UFC Fight Night: Ankalaev vs Rountree Jr',
  );
  assert.equal(
    eventSchemaName('Post Malone: The BIG ASS Stadium World Tour: What to Know (Bangkok)'),
    'Post Malone: The BIG ASS Stadium World Tour',
  );
});

test('handles an en-dash separator before the suffix', () => {
  assert.equal(
    eventSchemaName('Comic Market 108 – What to Know (Tokyo)'),
    'Comic Market 108',
  );
});

test('keeps a parenthesised sub-name that belongs to the event', () => {
  assert.equal(
    eventSchemaName('Comic Market 108 (Summer Comiket): What to Know in Tokyo'),
    'Comic Market 108 (Summer Comiket)',
  );
  assert.equal(
    eventSchemaName('XG Concert (AsiaWorld-Expo): What to Know (Hong Kong)'),
    'XG Concert (AsiaWorld-Expo)',
  );
});

test('keeps an en-dash that is part of the event name', () => {
  assert.equal(
    eventSchemaName('BTS World Tour – Arlington: What to Know (Arlington)'),
    'BTS World Tour – Arlington',
  );
});

test('titles with no article suffix pass through unchanged', () => {
  assert.equal(eventSchemaName('Mud Festival in Boryeong'), 'Mud Festival in Boryeong');
  assert.equal(eventSchemaName('Christmas in Alsace'), 'Christmas in Alsace');
});

test('a title that is only a suffix falls back to itself, never empty', () => {
  assert.equal(eventSchemaName('What to Know (Tokyo)'), 'What to Know (Tokyo)');
  assert.equal(eventSchemaName(''), '');
  assert.equal(eventSchemaName(undefined), '');
});

test('other guide-phrase suffixes are cut too', () => {
  assert.equal(eventSchemaName("La Tomatina: A Visitor's Guide (Buñol)"), 'La Tomatina');
  assert.equal(eventSchemaName('Hue Festival 2026: Complete Guide'), 'Hue Festival 2026');
});

test('does not eat a mid-title word that merely starts like the suffix', () => {
  assert.equal(
    eventSchemaName('What to Know Fest 2026: What to Know (Seoul)'),
    'What to Know Fest 2026',
  );
});

// ── eventProperName: what an image archive can actually match ────
// Each expectation below was checked against the Commons search API: the
// left-hand title returns nothing usable, the right-hand name returns real
// photographs of the act or the tournament.
test('strips tour branding after a dash', () => {
  assert.equal(eventProperName('Post Malone – BIG ASS World Tour: What to Know (Singapore)'), 'Post Malone');
  assert.equal(eventProperName('BTS World Tour – Arlington: What to Know (Arlington)'), 'BTS World Tour');
});

test('strips the edition year and the parenthetical', () => {
  assert.equal(eventProperName('EuroVolley Women 2026 (Final Stage): What to Know (Istanbul)'), 'EuroVolley Women');
  assert.equal(eventProperName('Comiket (Comic Market) 108: What to Know (Tokyo)'), 'Comiket');
  assert.equal(eventProperName('2026 China Open (Snooker): What to Know (Taiyuan)'), 'China Open');
  assert.equal(eventProperName('BWF World Championships 2026: What to Know (New Delhi)'), 'BWF World Championships');
});

test('the five-word cut never ends on a dangling conjunction', () => {
  // "Sun Moon Lake Music &" matched nothing on Commons (2026-08-22).
  assert.equal(eventProperName('2026 Sun Moon Lake Music & Fireworks Festival: What to Know (Nantou)'), 'Sun Moon Lake Music');
  assert.equal(eventProperName('Beer Wine Food Fun and Games Fest: What to Know (Lyon)'), 'Beer Wine Food Fun');
});

test('keeps a multi-word name that IS the event', () => {
  assert.equal(eventProperName('Formula 1 Spanish Grand Prix: What to Know (Madrid)'), 'Formula 1 Spanish Grand Prix');
  assert.equal(eventProperName('Aomori Nebuta Matsuri: What to Know (Aomori)'), 'Aomori Nebuta Matsuri');
});

test('caps the length so the archive still matches', () => {
  const out = eventProperName('One Two Three Four Five Six Seven: What to Know (X)');
  assert.equal(out.split(' ').length, 5, out);
});

test('never returns empty', () => {
  assert.equal(eventProperName(''), '');
  assert.ok(eventProperName('2026: What to Know (Seoul)').length > 0);
});

// The article suffix in use since 2026-08-07. The old "What to Know" corpus
// stays live, so BOTH must strip identically everywhere this module is used
// (Event schema name, the ics/md feeds).
test('strips the "Dates, Tickets & Venue" suffix the same as the old one', () => {
  assert.equal(
    eventSchemaName('Lollapalooza 2026: Dates, Tickets & Venue (Chicago)'),
    'Lollapalooza 2026',
  );
  assert.equal(
    eventSchemaName('UFC Fight Night: Ankalaev vs Rountree Jr: Dates, Tickets & Venue (Abu Dhabi)'),
    'UFC Fight Night: Ankalaev vs Rountree Jr',
  );
  assert.equal(
    eventProperName('EuroVolley Women 2026 (Final Stage): Dates, Tickets & Venue (Istanbul)'),
    'EuroVolley Women',
  );
});
