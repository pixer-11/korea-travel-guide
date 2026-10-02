// The live checks' analytics block — it must stop every counter, and nothing else.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isAnalyticsRequest } from './live-analytics-block.mjs';

test('Cloudflare Web Analytics reports are stopped, on the site and on the old host', () => {
  // What the injected beacon (data-cf-beacon version 2024.11.0) actually posts to.
  assert.equal(isAnalyticsRequest('https://wanderatlasguides.com/cdn-cgi/rum?'), true);
  assert.equal(isAnalyticsRequest('https://wanderatlasguides.com/cdn-cgi/rum'), true);
  assert.equal(isAnalyticsRequest('https://cloudflareinsights.com/cdn-cgi/rum'), true);
  assert.equal(isAnalyticsRequest(new URL('http://localhost:4400/cdn-cgi/rum?x=1')), true);
});

test('Plausible and GA4 stay stopped', () => {
  assert.equal(isAnalyticsRequest('https://plausible.io/api/event'), true);
  assert.equal(isAnalyticsRequest('https://plausible.io/js/pa-8beY2XpeZiWKI7EzsoQ6f.js'), true);
  assert.equal(isAnalyticsRequest('https://www.googletagmanager.com/gtag/js?id=G-P6WETF9HNF'), true);
  assert.equal(isAnalyticsRequest('https://region1.google-analytics.com/g/collect?v=2'), true);
  assert.equal(isAnalyticsRequest('https://stats.g.doubleclick.net/g/collect'), true);
});

test('the beacon SCRIPT is let through — an emptied one fails its integrity hash and reds the check', () => {
  assert.equal(isAnalyticsRequest('https://static.cloudflareinsights.com/beacon.min.js/v31eddc5c8b8d4a8a9d8'), false);
});

test('the site itself is never blocked', () => {
  for (const u of [
    'https://wanderatlasguides.com/',
    'https://wanderatlasguides.com/ko/my-trip/',
    'https://wanderatlasguides.com/trip-data/ko/saved-cities.json',
    'https://wanderatlasguides.com/cdn-cgi/image/width=640/wall/a.webp',
    'https://wanderatlasguides.com/cdn-cgi/rumble',
    'https://wanderatlasguides.com/posts/rum-distillery-tour/',
    'https://upload.wikimedia.org/wikipedia/commons/a.jpg',
    'https://notplausible.io.example.com/x',
  ]) assert.equal(isAnalyticsRequest(u), false, u);
});
