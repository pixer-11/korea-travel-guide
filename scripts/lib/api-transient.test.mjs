import test from 'node:test';
import assert from 'node:assert/strict';
import { isTransientApiError, transientBackoffMs } from './api-transient.mjs';

test('rate limit, overload, 5xx and dropped connections are transient', () => {
  assert.equal(isTransientApiError({ status: 429, message: 'rate_limit_error' }), true);
  assert.equal(isTransientApiError({ status: 529, message: 'Overloaded' }), true);
  assert.equal(isTransientApiError({ status: 503 }), true);
  assert.equal(isTransientApiError(new Error('Connection error. ECONNRESET')), true);
  assert.equal(isTransientApiError({ name: 'APIConnectionError', message: 'Connection error.' }), true);
});

test('bad request, auth and usage-limit 400s are NOT transient', () => {
  assert.equal(isTransientApiError({ status: 400, message: 'invalid_request_error: usage limit' }), false);
  assert.equal(isTransientApiError({ status: 401, message: 'authentication_error' }), false);
  assert.equal(isTransientApiError(new Error('translation body is a stub')), false);
});

test('backoff is hard on a rate limit and grows with the attempt', () => {
  assert.equal(transientBackoffMs({ status: 429 }, 1), 15000);
  assert.equal(transientBackoffMs({ status: 429 }, 2), 30000);
  assert.equal(transientBackoffMs({ status: 503 }, 1), 3000);
});
