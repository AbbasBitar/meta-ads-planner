import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { verifyAccessJWT } from '../worker/access.js';

test('concurrent JWT verifications share one JWKS fetch', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048
  });

  const jwk = {
    ...publicKey.export({ format: 'jwk' }),
    kid: 'concurrency-test-key',
    alg: 'RS256',
    use: 'sig'
  };

  const now = Math.floor(Date.now() / 1000);
  const audience = 'concurrency-test-audience';

  const encode = value =>
    Buffer.from(JSON.stringify(value)).toString('base64url');

  const signedData = [
    encode({ alg: 'RS256', kid: jwk.kid }),
    encode({
      iss: 'https://abbasbitar68.cloudflareaccess.com',
      aud: [audience],
      iat: now - 60,
      exp: now + 3600
    })
  ].join('.');

  const signature = sign(
    'RSA-SHA256',
    Buffer.from(signedData),
    privateKey
  ).toString('base64url');

  const token = `${signedData}.${signature}`;

  const originalFetch = globalThis.fetch;
  let fetchCount = 0;

  globalThis.fetch = async () => {
    fetchCount++;

    await new Promise(resolve => setTimeout(resolve, 30));

    return new Response(JSON.stringify({ keys: [jwk] }), {
      status: 200
    });
  };

  try {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        verifyAccessJWT(token, audience)
      )
    );

    assert.deepEqual(results, Array(10).fill(true));
    assert.equal(fetchCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});