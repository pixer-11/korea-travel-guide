// node --test src/lib/eventCategory.test.mjs
// Every example is a real event title from src/content/posts (2026-09-24).
import test from 'node:test';
import assert from 'node:assert/strict';
import { eventCategory, EVENT_CATEGORIES } from './eventCategory.mjs';

const cat = (title, performer) =>
  eventCategory({ title, eventPerformer: performer ? { name: performer, kind: 'person' } : undefined });

test('a recorded performer makes it a concert, whatever the title says', () => {
  assert.equal(cat('Céline Dion Paris Residency: Dates, Tickets & Venue (Paris)', 'Céline Dion'), 'concerts');
  assert.equal(cat('Richard Marx: Dates, Tickets & Venue (Dubai)', 'Richard Marx'), 'concerts');
  // "SHOW" in the tour name must not turn a concert into an exhibition.
  assert.equal(cat('IVE World Tour 2026 "SHOW WHAT I AM" – Taipei: What to Know (Taipei)', 'IVE'), 'concerts');
});

test('sports', () => {
  for (const t of [
    'Formula 1 Singapore Grand Prix 2026: What to Know (Singapore)',
    'Pertamina Grand Prix of Indonesia (MotoGP Mandalika): Dates, Tickets & Venue (Mandalika)',
    'China Open (tennis): Dates, Tickets & Venue (Beijing)',
    'Billie Jean King Cup Finals: What to Know (Shenzhen)',
    'Chess Olympiad 2026: Dates, Tickets & Venue (Samarkand)',
    'Asian Games 2026: Dates, Tickets & Venue (Nagoya)',
    'September Grand Sumo Tournament (Aki Basho): What to Know (Tokyo)',
    'TCS New York City Marathon: Dates, Tickets & Venue (New York)',
    "Prix de l'Arc de Triomphe: Dates, Tickets & Venue (Paris)",
    'Rolex Shanghai Masters: Dates, Tickets & Venue (Shanghai)',
    "2026 Xi'an Grand Prix (Snooker): What to Know (Xi'an)",
    'CSIO Barcelona: Dates, Tickets & Venue (Barcelona)',
    'UFC Fight Night: Ankalaev vs Rountree Jr: What to Know (Abu Dhabi)',
    'CEV EuroVolley Women 2026 Istanbul: What to Know (Istanbul)',
    'Tour de France Femmes avec Zwift: What to Know (Nice)',
    'World Athletics Continental Tour Silver Meet (Indian Open): What to Know (Bhubaneswar)',
  ]) assert.equal(cat(t), 'sports', t);
});

test('festivals', () => {
  for (const t of [
    'La Mercè Festival: What to Know (Barcelona)',
    'Jidai Matsuri: Dates, Tickets & Venue (Kyoto)',
    'EDC Korea (Electric Daisy Carnival): Dates, Tickets & Venue (Incheon)',
    'Lantern Festival in Jinju',
    'Busan International Film Festival (BIFF): Dates, Tickets & Venue (Busan)',
    'Fête des Vendanges de Montmartre (Montmartre Grape Harvest Festival): Dates, Tickets & Venue (Paris)',
  ]) assert.equal(cat(t), 'festivals', t);
});

test('exhibitions', () => {
  assert.equal(cat('Indonesia Comic Con 2026: Dates, Tickets & Venue (Tangerang)'), 'exhibitions');
  assert.equal(cat('Tokyo Game Show 2026 (TGS): What to Know (Chiba)'), 'exhibitions');
  assert.equal(cat('Comic Market 108 (Summer Comiket): What to Know (Tokyo)'), 'exhibitions');
});

test('a tour or concert with no performer recorded is still a concert — but a sports tour is not', () => {
  assert.equal(cat('BTS World Tour – Arlington: What to Know (Arlington)'), 'concerts');
  assert.equal(cat('Stray Kids Concert: What to Know (Seoul)'), 'concerts');
  assert.equal(cat('David Byrne Live in Bangkok: What to Know (Bangkok)'), 'concerts');
  assert.equal(cat('2026 Tour de France (Final Stages & Paris Finish): What to Know (Paris)'), 'sports');
});

test('nothing recognisable → other, never a guess', () => {
  for (const t of [
    'Christmas in Alsace',
    'GITEX Vietnam: Dates, Tickets & Venue (Hanoi)',
    'Yoko Ono: Insound and Instructure: Dates, Tickets & Venue (Istanbul)',
    'Miss World 2026: Dates, Host Cities & Tickets (Vietnam)',
    'La Tomatina: What to Know (Buñol)',
    // A motorcycle RALLY is a gathering, not a race.
    'Sturgis Motorcycle Rally (86th Anniversary): What to Know (Sturgis)',
  ]) assert.equal(cat(t), 'other', t);
});

test('the SEO suffix never decides the category', () => {
  // "Venue", "Tickets", "Dates" and the city in the tail must not match anything.
  assert.equal(cat('Dekmantel x Potato Head: Dates, Tickets & Venue (Bali)'), 'other');
});

test('always one of the declared categories', () => {
  for (const t of ['', undefined, 'x']) assert.ok(EVENT_CATEGORIES.includes(eventCategory({ title: t })));
  assert.ok(EVENT_CATEGORIES.includes(eventCategory(undefined)));
});
