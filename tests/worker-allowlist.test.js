import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import worker from '../worker/index.js';

test('Worker rejects a valid Access JWT when email allowlist is missing', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048
  });

  const jwk = {
    ...publicKey.export({ format: 'jwk' }),
    kid: 'worker-allowlist-test',
    alg: 'RS256',
    use: 'sig'
  };

  const now = Math.floor(Date.now() / 1000);
  const audience = 'test-audience';

  const encode = value =>
    Buffer.from(JSON.stringify(value)).toString('base64url');

  const input = [
    encode({ alg: 'RS256', kid: jwk.kid }),
    encode({
      iss: 'https://abbasbitar68.cloudflareaccess.com',
      aud: [audience],
      iat: now - 60,
      exp: now + 3600,
      email: 'representative1@gmail.com'
    })
  ].join('.');

  const signature = sign(
    'RSA-SHA256',
    Buffer.from(input),
    privateKey
  ).toString('base64url');

  const token = `${input}.${signature}`;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ keys: [jwk] }), {
      status: 200
    });

  try {
    const request = new Request(
      'https://abbasbitar.github.io/submit',
      {
        method: 'POST',
        headers: {
          Origin: 'https://abbasbitar.github.io',
          'Content-Type': 'application/json',
          'Cf-Access-Jwt-Assertion': token
        },
        body: '{}'
      }
    );

    const response = await worker.fetch(request, {
      ACCESS_AUD: audience
      // APPROVED_EMAILS deliberately omitted
    });

    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, 'Unauthorized');
  } finally {
    globalThis.fetch = originalFetch;
  }
});