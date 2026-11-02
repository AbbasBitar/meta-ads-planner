import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { verifyAccessJWT } from '../worker/access.js';

const AUD = 'cache-test-audience';
const ISS = 'https://abbasbitar68.cloudflareaccess.com';

function makeKey(kid) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048
  });

  return {
    privateKey,
    jwk: {
      ...publicKey.export({ format: 'jwk' }),
      kid,
      alg: 'RS256',
      use: 'sig'
    }
  };
}

function makeToken(key) {
  const now = Math.floor(Date.now() / 1000);
  const encode = value =>
    Buffer.from(JSON.stringify(value)).toString('base64url');

  const data = [
    encode({ alg: 'RS256', kid: key.jwk.kid }),
    encode({
      iss: ISS,
      aud: [AUD],
      iat: now - 60,
      exp: now + 3600
    })
  ].join('.');

  const signature = sign(
    'RSA-SHA256',
    Buffer.from(data),
    key.privateKey
  ).toString('base64url');

  return `${data}.${signature}`;
}

test('JWKS cache reuse, rotation, and unknown key rejection', async () => {
  const first = makeKey('cache-first');
  const second = makeKey('cache-second');
  const unknown = makeKey('cache-unknown');

  let fetchCount = 0;
  let activeKeys = [first.jwk];

  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    fetchCount++;

    return new Response(JSON.stringify({
      keys: activeKeys
    }), { status: 200 });
  };

  try {
    assert.equal(
      await verifyAccessJWT(makeToken(first), AUD),
      true
    );
    assert.equal(fetchCount, 1);

    // The second verification should reuse the cached key.
    assert.equal(
      await verifyAccessJWT(makeToken(first), AUD),
      true
    );
    assert.equal(fetchCount, 1);

    // Simulate Cloudflare rotating to a new signing key.
    activeKeys = [second.jwk];

    assert.equal(
      await verifyAccessJWT(makeToken(second), AUD),
      true
    );
    assert.equal(fetchCount, 2);

    // A key not published by Cloudflare must be rejected.
    assert.equal(
      await verifyAccessJWT(makeToken(unknown), AUD),
      false
    );
    assert.equal(fetchCount, 3);

  } finally {
    globalThis.fetch = originalFetch;
  }
});