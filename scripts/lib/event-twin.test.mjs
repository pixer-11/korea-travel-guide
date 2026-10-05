// node --test scripts/lib/event-twin.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { eventKey, isEventTwin } from './event-twin.mjs';

const k = (title, region, country, start, end, venue) => eventKey({ title, region, country, start, end, venue });
const twin = (a, b) => isEventTwin(a, b) && isEventTwin(b, a);

test('the four live twins of 2026-10-05 are caught', () => {
  assert.ok(twin(
    k('EDC Korea (Electric Daisy Carnival): Dates, Tickets & Venue (Incheon)', 'Incheon', 'South Korea', '2026-10-03', '2026-10-04', 'INSPIRE Entertainment Resort'),
    k('Electric Daisy Carnival (EDC) Korea 2026: Dates, Tickets & Venue (Incheon)', 'Incheon', 'South Korea', '2026-10-11', '2026-10-11', 'INSPIRE Arena')));
  assert.ok(twin(
    k('Charlie Puth Seoul 2026: Dates, Tickets & Venue (Goyang)', 'Goyang', 'South Korea', '2026-10-11', '2026-10-11', 'Goyang Stadium'),
    k('Charlie Puth Concert: Dates, Tickets & Venue (Goyang)', 'Goyang', 'South Korea', '2026-10-17', '2026-10-18', 'Goyang Stadium')));
  assert.ok(twin(
    k("5SOS: Everyone's A Star! World Tour: Dates, Tickets & Venue (Manila)", 'Manila', 'Philippines', '2026-11-11', '2026-11-12', 'SM Mall of Asia Arena'),
    k("5 Seconds of Summer: Everyone's a Star! World Tour: Dates, Tickets & Venue (Pasay)", 'Pasay', 'Philippines', '2026-11-11', '2026-11-12', 'SM Mall of Asia Arena')));
  assert.ok(twin(
    k('Pertamina Grand Prix of Indonesia (MotoGP Mandalika): Dates, Tickets & Venue (Mandalika)', 'Mandalika', 'Indonesia', '2026-10-09', '2026-10-11', 'Pertamina Mandalika International Circuit'),
    k('MotoGP Indonesia (Pertamina Grand Prix of Indonesia): Dates, Tickets & Venue (Lombok)', 'Lombok', 'Indonesia', '2026-10-09', '2026-10-11', 'Pertamina Mandalika International Street Circuit')));
});

test('different events that share a city, a stadium or a generic word are not twins', () => {
  assert.ok(!twin(
    k('Istanbul Marathon: Dates, Tickets & Venue (Istanbul)', 'Istanbul', 'Turkey', '2026-11-01'),
    k('WTT Contender Istanbul: Dates, Tickets & Venue (Istanbul)', 'Istanbul', 'Turkey', '2026-11-10')));
  assert.ok(!twin(
    k('Palermo Marathon (Maratona Internazionale di Palermo): Dates, Tickets & Venue (Palermo)', 'Palermo', 'Italy', '2026-11-15'),
    k("Ravenna Marathon (Maratona di Ravenna Città d'Arte): Dates, Tickets & Venue (Ravenna)", 'Ravenna', 'Italy', '2026-11-07')));
  assert.ok(!twin(
    k('PLK Stade de France Concerts: What to Know (Paris)', 'Paris', 'France', '2026-09-04', '2026-09-05', 'Stade de France'),
    k('Jay-Z Stade de France 2026: Dates, Tickets & Venue (Saint-Denis)', 'Saint-Denis', 'France', '2026-09-10', '2026-09-10', 'Stade de France')));
  assert.ok(!twin(
    k('2026 Vietnam National Games: Dates, Tickets & Venue (Ho Chi Minh City)', 'Ho Chi Minh City', 'Vietnam', '2026-11-20', '2026-12-10'),
    k('Miss Charm 2026: Dates, Tickets & Venue (Ho Chi Minh City)', 'Ho Chi Minh City', 'Vietnam', '2026-12-05')));
  assert.ok(!twin(
    k('ITZY TUNNEL VISION World Tour – Taipei: What to Know (Taipei)', 'Taipei', 'Taiwan', '2026-09-05'),
    k('IVE World Tour 2026 "SHOW WHAT I AM" – Taipei: What to Know (Taipei)', 'Taipei', 'Taiwan', '2026-09-11')));
});

test('the same act in another country, or months later, is a different stop', () => {
  const a = k('The Weeknd After Hours Til Dawn Tour: Dates, Tickets & Venue (Singapore)', 'Singapore', 'Singapore', '2026-10-02');
  assert.ok(!twin(a, k('The Weeknd After Hours Til Dawn Tour: Dates, Tickets & Venue (Saitama)', 'Saitama', 'Japan', '2026-10-20')));
  assert.ok(!twin(a, k('The Weeknd After Hours Til Dawn Tour: Dates, Tickets & Venue (Singapore)', 'Singapore', 'Singapore', '2027-03-01')));
});
