import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { authorizeAccess } from '../worker/access.js';

const AUD = 'test-application-audience';
const ISSUER = 'https://abbasbitar68.cloudflareaccess.com';
const APPROVED = 'representative1@gmail.com,representative2@gmail.com';

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048
});

const jwk = {
  ...publicKey.export({ format: 'jwk' }),
  kid: 'authorization-test-key',
  alg: 'RS256',
  use: 'sig'
};

function createToken(email, overrides = {}) {
  const now = Math.floor(Date.now() / 1000);

  const header = Buffer.from(JSON.stringify({
    alg: 'RS256',
    kid: jwk.kid
  })).toString('base64url');

  const payload = Buffer.from(JSON.stringify({
    iss: ISSUER,
    aud: [AUD],
    iat: now - 60,
    exp: now + 3600,
    email,
    ...overrides
  })).toString('base64url');

  const input = `${header}.${payload}`;

  const signature = sign(
    'RSA-SHA256',
    Buffer.from(input),
    privateKey
  ).toString('base64url');

  return `${input}.${signature}`;
}

async function withMockKeys(callback) {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => new Response(
    JSON.stringify({ keys: [jwk] }),
    { status: 200 }
  );

  try {
    await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('authorizes first approved representative', async () => {
  await withMockKeys(async () => {
    assert.equal(
      await authorizeAccess(createToken('representative1@gmail.com'), AUD, APPROVED),
      true
    );
  });
});

test('authorizes second approved representative', async () => {
  await withMockKeys(async () => {
    assert.equal(
      await authorizeAccess(createToken('representative2@gmail.com'), AUD, APPROVED),
      true
    );
  });
});

test('rejects unapproved representative', async () => {
  await withMockKeys(async () => {
    assert.equal(
      await authorizeAccess(createToken('unknown@gmail.com'), AUD, APPROVED),
      false
    );
  });
});

test('rejects missing email claim', async () => {
  await withMockKeys(async () => {
    assert.equal(
      await authorizeAccess(createToken(undefined), AUD, APPROVED),
      false
    );
  });
});

test('rejects missing allowlist', async () => {
  await withMockKeys(async () => {
    assert.equal(
      await authorizeAccess(createToken('representative1@gmail.com'), AUD, ''),
      false
    );
  });
});

test('rejects expired approved representative token', async () => {
  await withMockKeys(async () => {
    assert.equal(
      await authorizeAccess(
        createToken('representative1@gmail.com', {
          exp: Math.floor(Date.now() / 1000) - 60
        }),
        AUD,
        APPROVED
      ),
      false
    );
  });
});
