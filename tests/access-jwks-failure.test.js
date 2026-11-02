import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAccessJWT } from '../worker/access.js';

const AUD = 'jwks-failure-test-audience';

function createUnsignedTestToken() {
  const now = Math.floor(Date.now() / 1000);

  const encode = value =>
    Buffer.from(JSON.stringify(value)).toString('base64url');

  return [
    encode({ alg: 'RS256', kid: 'unavailable-test-key' }),
    encode({
      iss: 'https://abbasbitar68.cloudflareaccess.com',
      aud: [AUD],
      iat: now - 60,
      exp: now + 3600
    }),
    Buffer.alloc(256, 1).toString('base64url')
  ].join('.');
}

test('rejects JWT when JWKS endpoint is unavailable', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    throw new Error('Simulated JWKS network failure');
  };

  try {
    assert.equal(
      await verifyAccessJWT(createUnsignedTestToken(), AUD),
      false
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects JWT when JWKS endpoint returns HTTP 503', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response('Service Unavailable', { status: 503 });

  try {
    assert.equal(
      await verifyAccessJWT(createUnsignedTestToken(), AUD),
      false
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects JWT when JWKS response is malformed', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ keys: 'invalid' }), {
      status: 200
    });

  try {
    assert.equal(
      await verifyAccessJWT(createUnsignedTestToken(), AUD),
      false
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});