import test from 'node:test';
import assert from 'node:assert/strict';
import { eventSchemaName } from './eventName.mjs';

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
