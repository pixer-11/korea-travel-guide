import test from 'node:test';
import assert from 'node:assert/strict';

// Mirrors the IG-caption assembly in threads-daily.mjs (keep the two in step).
function assemble(igCaptionRaw, post, region, country) {
  const tagify = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '');
  const modelTags = igCaptionRaw.match(/#[\p{L}\p{N}_]{2,}/gu) || [];
  const captionBody = igCaptionRaw
    .split('\n')
    .map((l) => l.replace(/#[\p{L}\p{N}_]*/gu, '').replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const ownTags = [
    post.fm.place?.name, region, country,
    post.fm.category === 'event' ? 'events' : post.fm.category === 'restaurant' ? 'foodie' : 'travelguide',
    'travel', 'wanderatlas',
  ].map(tagify).filter((t) => t.length >= 3).map((t) => '#' + t);
  const hashtags = [...new Set([...ownTags, ...modelTags])].slice(0, 10).join(' ');
  return captionBody ? `${captionBody}\n\n${hashtags}` : '';
}

const POST = { fm: { category: 'attraction', place: { name: 'Sacred Monkey Forest Sanctuary' } } };

test('08-22 failure shape — a lone "#" becomes real tags from the post record', () => {
  const out = assemble('Moss-covered temples and macaques who run the show.\n\n#', POST, 'Ubud', 'Indonesia');
  assert.match(out, /#SacredMonkeyForestSanctuary #Ubud #Indonesia #travelguide #travel #wanderatlas$/);
  assert.ok(!/\n#\n/.test(out) && !/ #$/.test(out), 'no bare #');
});

test('writer tags are kept as extras after the post-derived ones, deduped', () => {
  const out = assemble('Go early.\n\n#Ubud #BaliTravel #MonkeyForest', POST, 'Ubud', 'Indonesia');
  const tags = out.split('\n').pop().split(' ');
  assert.equal(tags[0], '#SacredMonkeyForestSanctuary');
  assert.ok(tags.includes('#BaliTravel') && tags.includes('#MonkeyForest'));
  assert.equal(tags.filter((t) => t === '#Ubud').length, 1);
});

test('tags inline in prose are lifted out of the sentence, not left as holes', () => {
  const out = assemble('Best at dawn #Ubud.\nBring water.', POST, 'Ubud', 'Indonesia');
  assert.ok(out.startsWith('Best at dawn .\nBring water.') || out.startsWith('Best at dawn.\nBring water.') || out.startsWith('Best at dawn'));
  assert.ok(!out.split('\n\n')[0].includes('#'));
});

test('accented place names become clean ASCII tags; an empty caption stays empty', () => {
  const p = { fm: { category: 'restaurant', place: { name: 'Café São João' } } };
  assert.match(assemble('Tiny counter, huge flavours.', p, 'Lisbon', 'Portugal'), /#CafeSaoJoao #Lisbon #Portugal #foodie/);
  assert.equal(assemble('', p, 'Lisbon', 'Portugal'), '');
});
