import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { verifyAccessJWT } from '../worker/access.js';

test('refreshes JWKS after cache expiration', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048
  });

  const jwk = {
    ...publicKey.export({ format: 'jwk' }),
    kid: 'expiration-test-key',
    alg: 'RS256',
    use: 'sig'
  };

  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;

  let currentTime = originalNow();
  let fetchCount = 0;

  const createToken = () => {
    const now = Math.floor(Date.now() / 1000);
    const encode = value =>
      Buffer.from(JSON.stringify(value)).toString('base64url');

    const data = [
      encode({ alg: 'RS256', kid: jwk.kid }),
      encode({
        iss: 'https://abbasbitar68.cloudflareaccess.com',
        aud: ['cache-expiration-test'],
        iat: now - 60,
        exp: now + 3600
      })
    ].join('.');

    const signature = sign(
      'RSA-SHA256',
      Buffer.from(data),
      privateKey
    ).toString('base64url');

    return `${data}.${signature}`;
  };

  Date.now = () => currentTime;

  globalThis.fetch = async () => {
    fetchCount++;

    return new Response(
      JSON.stringify({ keys: [jwk] }),
      { status: 200 }
    );
  };

  try {
    assert.equal(
      await verifyAccessJWT(createToken(), 'cache-expiration-test'),
      true
    );
    assert.equal(fetchCount, 1);

    currentTime += 4 * 60 * 1000;

    assert.equal(
      await verifyAccessJWT(createToken(), 'cache-expiration-test'),
      true
    );
    assert.equal(fetchCount, 1);

    currentTime += 2 * 60 * 1000;

    assert.equal(
      await verifyAccessJWT(createToken(), 'cache-expiration-test'),
      true
    );
    assert.equal(fetchCount, 2);
  } finally {
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
  }
});
