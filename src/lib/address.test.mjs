import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripPlusCode } from './address.mjs';

test('drops a leading plus code and its separator', () => {
  assert.equal(stripPlusCode('CC7W+96Q - Al Bustan - Ajman - United Arab Emirates'), 'Al Bustan - Ajman - United Arab Emirates');
  assert.equal(stripPlusCode('9H45+98Q Ayutthaya Historical Park, Tambon Pratuchai'), 'Ayutthaya Historical Park, Tambon Pratuchai');
  assert.equal(stripPlusCode('9H48+23V, Tha Wasukri, Phra Nakhon Si Ayutthaya'), 'Tha Wasukri, Phra Nakhon Si Ayutthaya');
  assert.equal(stripPlusCode('R7RQ+C9 Valensole, France'), 'Valensole, France');
});

test('leaves ordinary addresses alone, including ones with a + inside', () => {
  assert.equal(stripPlusCode('12 Via Garibaldi, 16124 Genova GE, Italy'), '12 Via Garibaldi, 16124 Genova GE, Italy');
  assert.equal(stripPlusCode('Block A+B, 5 Harbour Rd'), 'Block A+B, 5 Harbour Rd');
  assert.equal(stripPlusCode('서울특별시 종로구 사직로 161'), '서울특별시 종로구 사직로 161');
});

test('a bare plus code becomes empty, and non-strings become empty', () => {
  assert.equal(stripPlusCode('CC7W+96Q'), '');
  assert.equal(stripPlusCode(undefined), '');
  assert.equal(stripPlusCode(null), '');
});
