import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAccessJWT } from '../worker/access.js';

const AUD = 'test-application-audience';

function encodeJSON(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function makeToken(payload, header = { alg: 'RS256', kid: 'test-key' }) {
  return [
    encodeJSON(header),
    encodeJSON(payload),
    Buffer.from('invalid-signature').toString('base64url')
  ].join('.');
}

const now = Math.floor(Date.now() / 1000);

const validClaims = {
  iss: 'https://abbasbitar68.cloudflareaccess.com',
  aud: [AUD],
  iat: now - 60,
  exp: now + 3600
};

test('rejects missing JWT', async () => {
  assert.equal(await verifyAccessJWT('', AUD), false);
});

test('rejects malformed JWT', async () => {
  assert.equal(await verifyAccessJWT('invalid.token', AUD), false);
});

test('rejects missing application audience', async () => {
  assert.equal(await verifyAccessJWT(makeToken(validClaims), ''), false);
});

test('rejects incorrect issuer', async () => {
  const token = makeToken({ ...validClaims, iss: 'https://attacker.example' });
  assert.equal(await verifyAccessJWT(token, AUD), false);
});

test('rejects incorrect audience', async () => {
  const token = makeToken({ ...validClaims, aud: ['another-app'] });
  assert.equal(await verifyAccessJWT(token, AUD), false);
});

test('rejects expired JWT', async () => {
  const token = makeToken({ ...validClaims, exp: now - 60 });
  assert.equal(await verifyAccessJWT(token, AUD), false);
});

test('rejects future-issued JWT', async () => {
  const token = makeToken({ ...validClaims, iat: now + 3600 });
  assert.equal(await verifyAccessJWT(token, AUD), false);
});

test('rejects unsupported signing algorithm', async () => {
  const token = makeToken(validClaims, { alg: 'none', kid: 'test-key' });
  assert.equal(await verifyAccessJWT(token, AUD), false);
});
