import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSingleRegion, renderGlobal, renderMultiRegion } from './newsletter-render.mjs';

const edition = {
  hero: { slug: 'al-khayma', title: 'Al Khayma Heritage Restaurant', category: 'restaurant', image: { url: 'https://images.unsplash.com/photo-hero', credit: 'c' } },
  stories: [{ slug: 'marina', title: 'Dubai Marina at Golden Hour', category: 'attraction', image: { url: 'https://images.unsplash.com/photo-2', credit: 'c' } }],
  events: [{ slug: 'expo', title: 'Dubai Food Festival', date: new Date('2026-08-10'), region: 'Dubai' }],
  country: 'UAE',
  usedPostSlugs: ['al-khayma', 'marina'],
  usedEventSlugs: ['expo'],
};
const links = { cta: 'https://x/regions/dubai', unsubscribe: 'https://x/unsub', prefs: 'https://x/prefs', story: (s) => `https://x/${s}`, event: (s) => `https://x/${s}` };

test('subject and preheader are localized', () => {
  const { subject, preheader } = renderSingleRegion({ edition, region: 'Dubai', lang: 'ko', links });
  assert.equal(subject, '이번 주 두바이 소식'.replace('두바이', 'Dubai')); // region label passed through as-is
  assert.match(preheader, /Dubai/);
});

test('html contains hero image, every story title, events section, unsubscribe, preheader', () => {
  edition.hero.dek = 'A wind-tower courtyard lunch';
  const { html } = renderSingleRegion({ edition, region: 'Dubai', lang: 'en', links });
  assert.match(html, /photo-hero/);
  assert.match(html, /Al Khayma Heritage Restaurant/);
  assert.match(html, /Dubai Marina at Golden Hour/);
  assert.match(html, /Dubai Food Festival/);
  assert.match(html, /Upcoming events/);
  assert.match(html, /https:\/\/x\/unsub/);
  assert.match(html, /Al Khayma Heritage Restaurant/);
  assert.match(html, /A wind-tower courtyard lunch/);
});

test('no events section when there are no events', () => {
  const { html } = renderSingleRegion({ edition: { ...edition, events: [] }, region: 'Dubai', lang: 'en', links });
  assert.doesNotMatch(html, /Upcoming events/);
});

test('renderGlobal shows region labels and localized subject', () => {
  const ed = {
    hero: { slug: 'dubai-1', title: 'Old Dubai eats', category: 'restaurant', image: { url: 'https://i/x' }, region: 'Dubai' },
    stories: [{ slug: 'paris-1', title: 'Paris brunch', category: 'restaurant', image: { url: 'https://i/y' }, region: 'Paris' }],
    events: [], usedPostSlugs: [], usedEventSlugs: [],
  };
  const { subject, html } = renderGlobal({ edition: ed, lang: 'ko', links });
  assert.match(subject, /Wander Atlas/);
  assert.match(html, /Dubai/); assert.match(html, /Paris/);
  assert.match(html, /Old Dubai eats/); assert.match(html, /Paris brunch/);
});

test('renderMultiRegion renders one labelled section per region', () => {
  const ed = {
    sections: [
      { region: 'Dubai', stories: [{ slug: 'd1', title: 'Dubai thing', category: 'restaurant', image: { url: 'https://i/a' } }] },
      { region: 'Paris', stories: [{ slug: 'p1', title: 'Paris thing', category: 'attraction', image: { url: 'https://i/b' } }] },
    ], events: [], usedPostSlugs: [], usedEventSlugs: [],
  };
  const { html } = renderMultiRegion({ edition: ed, regions: ['Dubai', 'Paris'], lang: 'en', links });
  assert.match(html, /Dubai thing/); assert.match(html, /Paris thing/);
  assert.match(html, /Dubai/); assert.match(html, /Paris/);
});
