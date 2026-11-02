import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { verifyAccessJWT } from '../worker/access.js';

const AUD = 'timestamp-test-audience';

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048
});

const jwk = {
  ...publicKey.export({ format: 'jwk' }),
  kid: 'timestamp-test-key',
  alg: 'RS256',
  use: 'sig'
};

function createToken(iat, exp) {
  const encode = value =>
    Buffer.from(JSON.stringify(value)).toString('base64url');

  const input = [
    encode({ alg: 'RS256', kid: jwk.kid }),
    encode({
      iss: 'https://abbasbitar68.cloudflareaccess.com',
      aud: [AUD],
      iat,
      exp
    })
  ].join('.');

  const signature = sign(
    'RSA-SHA256',
    Buffer.from(input),
    privateKey
  ).toString('base64url');

  return `${input}.${signature}`;
}

test('rejects JWT with issuance time equal to expiration', async () => {
  const now = Math.floor(Date.now() / 1000);

  assert.equal(
    await verifyAccessJWT(createToken(now + 30, now + 30), AUD),
    false
  );
});

test('rejects JWT with issuance time after expiration', async () => {
  const now = Math.floor(Date.now() / 1000);

  assert.equal(
    await verifyAccessJWT(createToken(now + 30, now + 10), AUD),
    false
  );
});

test('accepts correctly ordered JWT timestamps with valid signature', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ keys: [jwk] }), {
      status: 200
    });

  try {
    const now = Math.floor(Date.now() / 1000);

    assert.equal(
      await verifyAccessJWT(createToken(now - 60, now + 3600), AUD),
      true
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});