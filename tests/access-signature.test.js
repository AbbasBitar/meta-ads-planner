import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { verifyAccessJWT } from '../worker/access.js';

const AUD = 'test-application-audience';
const ISSUER = 'https://abbasbitar68.cloudflareaccess.com';
const KID = 'test-signing-key';

function generateKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048
  });

  return {
    publicJwk: {
      ...publicKey.export({ format: 'jwk' }),
      kid: KID,
      alg: 'RS256',
      use: 'sig'
    },
    privateKey
  };
}

function createToken(privateKey) {
  const now = Math.floor(Date.now() / 1000);

  const header = Buffer.from(JSON.stringify({
    alg: 'RS256',
    kid: KID
  })).toString('base64url');

  const payload = Buffer.from(JSON.stringify({
    iss: ISSUER,
    aud: [AUD],
    iat: now - 60,
    exp: now + 3600
  })).toString('base64url');

  const input = `${header}.${payload}`;

  const signature = sign('RSA-SHA256', Buffer.from(input), privateKey)
    .toString('base64url');

  return `${input}.${signature}`;
}

test('accepts valid signature and rejects forged signature', async () => {
  const originalFetch = globalThis.fetch;
  const { publicJwk, privateKey } = generateKeys();

  globalThis.fetch = async () => new Response(
    JSON.stringify({ keys: [publicJwk] }),
    { status: 200 }
  );

  try {
    const validToken = createToken(privateKey);

    assert.equal(await verifyAccessJWT(validToken, AUD), true);

    const parts = validToken.split('.');
    const signature = parts[2];

    const changedCharacter = signature[0] === 'A' ? 'B' : 'A';
    parts[2] = changedCharacter + signature.slice(1);

    assert.equal(await verifyAccessJWT(parts.join('.'), AUD), false);

    const attackerKeys = generateKeys();
    const attackerToken = createToken(attackerKeys.privateKey);

    assert.equal(await verifyAccessJWT(attackerToken, AUD), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
