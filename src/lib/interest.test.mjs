import test from 'node:test';
import assert from 'node:assert/strict';
import { interestFields } from './interest.mjs';

test('slugifies the region and passes lang/source through', () => {
  const f = interestFields({ region: 'Abu Dhabi', lang: 'ko', source: '/ko/abu-dhabi' });
  assert.equal(f.region, 'abu-dhabi');
  assert.equal(f.lang, 'ko');
  assert.equal(f.source, '/ko/abu-dhabi');
});

test('empty region becomes empty string (global)', () => {
  const f = interestFields({ lang: 'en', source: '/' });
  assert.equal(f.region, '');
  assert.equal(f.lang, 'en');
});

test('folds diacritics via canonical slugger', () => {
  assert.equal(interestFields({ region: 'Alcañiz', lang: 'en' }).region, 'alcaniz');
});
