import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import worker from '../worker/index.js';

const AUD = 'test-audience';
const ORIGIN = 'https://abbasbitar.github.io';
const APPROVED = 'rep1@gmail.com,rep2@gmail.com';

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048
});

const jwk = {
  ...publicKey.export({ format: 'jwk' }),
  kid: 'worker-email-test',
  alg: 'RS256',
  use: 'sig'
};

function createToken(email) {
  const now = Math.floor(Date.now() / 1000);
  const encode = value =>
    Buffer.from(JSON.stringify(value)).toString('base64url');

  const input = [
    encode({ alg: 'RS256', kid: jwk.kid }),
    encode({
      iss: 'https://abbasbitar68.cloudflareaccess.com',
      aud: [AUD],
      iat: now - 60,
      exp: now + 3600,
      email
    })
  ].join('.');

  const signature = sign(
    'RSA-SHA256',
    Buffer.from(input),
    privateKey
  ).toString('base64url');

  return `${input}.${signature}`;
}

async function sendRequest(email) {
  const request = new Request(`${ORIGIN}/submit`, {
    method: 'POST',
    headers: {
      Origin: ORIGIN,
      'Content-Type': 'application/json',
      'Cf-Access-Jwt-Assertion': createToken(email)
    },
    body: '{}'
  });

  return worker.fetch(request, {
    ACCESS_AUD: AUD,
    APPROVED_EMAILS: APPROVED,

    // Dummy test values; no external services are contacted.
    TURNSTILE_SECRET: 'test-turnstile-secret',
    TELEGRAM_BOT_TOKEN: 'test-telegram-token',
    TELEGRAM_CHAT_ID: 'test-chat-id',

    SUBMISSIONS: {
      get: async () => null,
      put: async () => {}
    }
  });
}

test('Worker accepts approved representative identity', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ keys: [jwk] }), {
      status: 200
    });

  try {
    const response = await sendRequest('rep1@gmail.com');

    // Authentication succeeds; invalid submission JSON is rejected next.
    assert.equal(response.status, 400);
    assert.notEqual((await response.json()).error, 'Unauthorized');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Worker rejects unapproved representative identity', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ keys: [jwk] }), {
      status: 200
    });

  try {
    const response = await sendRequest('unknown@gmail.com');

    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, 'Unauthorized');
  } finally {
    globalThis.fetch = originalFetch;
  }
});