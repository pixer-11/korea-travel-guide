import test from 'node:test';
import assert from 'node:assert/strict';
import { shortArtist, shortCredit } from './photo-credit.mjs';

test('짧은 이름은 그대로 둔다', () => {
  assert.equal(shortArtist('Jakub Hałun'), 'Jakub Hałun');
  assert.equal(shortCredit('Photo: Jakub Hałun / Wikimedia Commons (CC BY-SA 3.0)'), 'Photo: Jakub Hałun / Wikimedia Commons (CC BY-SA 3.0)');
});

test('사용 조건 문단에서 촬영자 이름만 뽑는다', () => {
  assert.equal(shortArtist('This Photo was taken by Wolfgang Moroder. Feel free to use my photos, but please mention me as the author and send me a message. This image is not in the public domain.'), 'Wolfgang Moroder');
  assert.equal(shortArtist('This picture has been taken by Oleg Yunakov. Contact e-mail: yunakov@gmail.com. Image can be used in accordance with the terms of the CC-BY-SA license.'), 'Oleg Yunakov');
  assert.equal(shortArtist('Another one of my pictures: This photograph was taken by Medium69 (William Crochot) and released under the license stated below. You are free to use it for any purpose as long as you credit the author.'), 'Medium69');
});

test('출처와 라이선스 꼬리는 그대로 살린다', () => {
  const long = 'Photo: This Photo was taken by Supanut Arunoprayote. Feel free to use any of my images, but please mention me as the author and may send me a message. Please do not upload an updated image here. / Wikimedia Commons (CC BY 4.0)';
  assert.equal(shortCredit(long), 'Photo: Supanut Arunoprayote / Wikimedia Commons (CC BY 4.0)');
});

test('이름을 못 찾으면 첫 문장만 남기고, 모양이 다른 문자열은 건드리지 않는다', () => {
  const noName = 'Photo: ' + 'x'.repeat(200) + ' / Wikimedia Commons (CC BY 4.0)';
  assert.ok(shortCredit(noName).length < noName.length);
  const foursquare = 'Photo: Foursquare user content (Al Ain Oasis)';
  assert.equal(shortCredit(foursquare), foursquare);
});

test('이름 뒤에 바로 사용조건이 붙는 모양도 이름만 남긴다', () => {
  assert.equal(shortArtist('Ad Meskens You are free to use this picture for any purpose as long as you credit its author, Ad Meskens. Example: © Ad Meskens / Wikimedia Commons If you use this work outside Wikimedia.'), 'Ad Meskens');
  assert.equal(shortArtist("Ivan Ruggiero I'd appreciate if you could mail me (ivanrugg@example.com) if you want to use this picture out of the Wikimedia project scope. Please credit me."), 'Ivan Ruggiero');
});

test('합성 사진의 파일별 표기는 한 사람으로 모은다', () => {
  assert.equal(shortArtist('File:Chin Swee Caves Temple KL17.JPG: Gryffindor File:Chin Swee Caves Temple KL18.JPG: Gryffindor File:Chin Swee Caves Temple KL19.JPG: Gryffindor'), 'Gryffindor');
});

test('출처 꼬리는 문자열 끝에서 찾는다 — 본문에 "/ Wikimedia Commons" 가 또 있어도', () => {
  const tricky = 'Photo: Ad Meskens You are free to use this picture for any purpose as long as you credit its author, Ad Meskens. Example: © Ad Meskens / Wikimedia Commons If you use this work outside Wikimedia please say so. / Wikimedia Commons (CC BY-SA 4.0)';
  assert.equal(shortCredit(tricky), 'Photo: Ad Meskens / Wikimedia Commons (CC BY-SA 4.0)');
});
