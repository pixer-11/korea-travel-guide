import test from 'node:test';
import assert from 'node:assert/strict';
import { latinTitleName } from './titles.mjs';

test('latinTitleName drops only a bracket holding non-Latin letters', () => {
  assert.equal(latinTitleName('MandoWave Festival (曼波祭)'), 'MandoWave Festival');
  assert.equal(latinTitleName('Busan Festival（부산축제）2026'), 'Busan Festival 2026');
  assert.equal(latinTitleName('Fête de la Musique (Lyon)'), 'Fête de la Musique (Lyon)');
  assert.equal(latinTitleName('World Cup (Group A)'), 'World Cup (Group A)');
  assert.equal(latinTitleName('Merrie Monarch Festival (Hawaiʻi)'), 'Merrie Monarch Festival (Hawaiʻi)');
});

test('latinTitleName never empties a name written wholly in another script', () => {
  assert.equal(latinTitleName('(曼波祭)'), '(曼波祭)');
  assert.equal(latinTitleName('曼波祭'), '曼波祭');
});
