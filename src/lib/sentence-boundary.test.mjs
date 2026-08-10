import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSentenceEnd, lastSentenceEnd, nextSentenceEnd, bracketsBalanced, closeDanglingBracket, endsInAbbreviation } from './sentence-boundary.mjs';

// The post that caused this file: the dot in the street abbreviation was read
// as the end of a sentence, so the description shipped clipped inside an
// address with the bracket left open.
const LYON = "Jardin des Curiosités is a small hilltop garden in Lyon's Fourvière district (8 Pl. de l'Abbé Larue, 69005) with sweeping views over the Saône and the city's rooftops. It's open daily 8am–10pm.";

test('an abbreviation dot is not a sentence end', () => {
  const i = LYON.indexOf('Pl.') + 2;
  assert.equal(LYON[i], '.');
  assert.equal(isSentenceEnd(LYON, i), false);
});

test('the bandung-wheels shape ("No. 65") is not a sentence end either', () => {
  const s = 'A rental counter on Jl. R.E. Martadinata No. 65 with helmets included.';
  for (const frag of ['Jl.', 'No.']) {
    const i = s.indexOf(frag) + frag.length - 1;
    assert.equal(isSentenceEnd(s, i), false, `${frag} treated as a sentence end`);
  }
});

test('a real sentence end still counts', () => {
  const i = LYON.indexOf('rooftops.') + 'rooftops'.length;
  assert.equal(isSentenceEnd(LYON, i), true);
});

test('a boundary that would strand an open bracket is rejected', () => {
  const s = 'A garden (open daily. Bring a picnic) above the river.';
  const i = s.indexOf('daily.') + 'daily'.length;
  assert.equal(isSentenceEnd(s, i), false);
});

test('lastSentenceEnd skips abbreviations and finds the real one', () => {
  const cut = LYON.slice(0, 175); // past the first sentence, short of the second
  const i = lastSentenceEnd(cut, 60);
  assert.equal(cut.slice(0, i + 1).trim().endsWith("city's rooftops."), true);
});

test('lastSentenceEnd returns -1 when only abbreviations are in range', () => {
  assert.equal(lastSentenceEnd(LYON.slice(0, 100), 60), -1);
});

test('nextSentenceEnd reaches past the budget to the first real end', () => {
  const i = nextSentenceEnd(LYON, 100);
  assert.equal(LYON.slice(0, i + 1).endsWith("city's rooftops."), true);
});

// The guard has to cut both ways: catch the clips, and stay quiet on the
// endings that legitimately close a sentence. Both shapes are live on the site.
test('endsInAbbreviation flags a clip', () => {
  for (const s of [
    'A leafy, patio-filled all-day café on Jl.',
    'An open-air food court on Jl. Gajah Mada No.',
    'Best visited around sunset for views over the park, Mt.',
    'A gated park built in 1721 and framed by St.',
    "A hilltop garden in Lyon's Fourvière district (8 Pl.",
  ]) assert.equal(endsInAbbreviation(s), true, s);
});

test('endsInAbbreviation stays quiet on real sentence ends', () => {
  for (const s of [
    'A five-round main event between Magomed Ankalaev and Khalil Rountree Jr.',
    'It sits at the northwest corner of Millennium Park, 201 E Randolph St.',
    'The market runs the length of Orchard Rd.',
    'A quiet grill house on Mina Street.',
  ]) assert.equal(endsInAbbreviation(s), false, s);
});

test('bracketsBalanced counts full-width brackets too', () => {
  assert.equal(bracketsBalanced('a (b) c'), true);
  assert.equal(bracketsBalanced('a (b c'), false);
  assert.equal(bracketsBalanced('京都（祇園）'), true);
});

test('closeDanglingBracket drops the unclosed tail and closes the sentence', () => {
  assert.equal(closeDanglingBracket('A hilltop garden (8 Pl'), 'A hilltop garden.');
  assert.equal(closeDanglingBracket('Already fine.'), 'Already fine.');
});
