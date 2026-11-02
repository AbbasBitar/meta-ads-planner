import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import worker from '../worker/index.js';
import { SubmissionCoordinator } from '../worker/index.js';

const AUD = 'submission-idempotency-audience';
const ORIGIN = 'https://abbasbitar.github.io';
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = {
  ...publicKey.export({ format: 'jwk' }),
  kid: 'worker-idempotency-test',
  alg: 'RS256',
  use: 'sig'
};

function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = [
    encode({ alg: 'RS256', kid: jwk.kid }),
    encode({
      iss: 'https://abbasbitar68.cloudflareaccess.com',
      aud: [AUD],
      iat: now - 30,
      exp: now + 3600,
      email: 'rep@example.com'
    })
  ].join('.');
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
}

const data = {
  client: 'Test Client', page: 'Test Page', representative: 'Rep',
  product: 'Family photography', locations: 'Beirut', audience: 'Parents',
  channels: ['Instagram Direct'], budget: '20', days: '4', minAge: '23',
  maxAge: '45', budgetType: 'lifetime', goal: 'profile', category: 'Photography',
  language: 'English', platform: 'manager', post: 'new', gender: 'All',
  creative: 'Single image'
};

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalJson(value[key])]));
  }
  return value;
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonicalJson(value))).digest('hex');
}

class MemoryKV {
  values = new Map();
  async get(key) { return this.values.get(key) ?? null; }
  async put(key, value) { this.values.set(key, value); }
}

class MemoryStorage {
  values = new Map();
  async get(key) { return this.values.get(key); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
}

class CoordinatorNamespace {
  objects = new Map();
  constructor(env) { this.env = env; }
  idFromName(name) { return name; }
  get(id) {
    if (!this.objects.has(id)) {
      const storage = new MemoryStorage();
      this.objects.set(id, {
        storage,
        coordinator: new SubmissionCoordinator({ storage }, this.env)
      });
    }
    return { fetch: (input, init) => this.objects.get(id).coordinator.fetch(new Request(input, init)) };
  }
  seed(id, record) {
    const storage = new MemoryStorage();
    storage.values.set('submission', structuredClone(record));
    this.objects.set(id, { storage, coordinator: new SubmissionCoordinator({ storage }, this.env) });
  }
  getRecord(id) { return this.objects.get(id)?.storage.values.get('submission'); }
}

function request(submissionId, options = {}) {
  return new Request(`${ORIGIN}/submit`, {
    method: 'POST',
    headers: {
      Origin: ORIGIN,
      'Content-Type': 'application/json',
      'Cf-Access-Jwt-Assertion': accessToken()
    },
    body: JSON.stringify({
      submissionId,
      data: options.data ?? data,
      turnstileToken: options.token ?? 'valid-test-token'
    })
  });
}

function environment(SUBMISSIONS, verifyHandler = async () => Response.json({ success: true, hostname: 'abbasbitar.github.io' })) {
  const env = {
    ACCESS_AUD: AUD,
    APPROVED_EMAILS: 'rep@example.com',
    SUBMISSIONS_PAUSED: 'false',
    TURNSTILE_SECRET: 'test-secret',
    TELEGRAM_BOT_TOKEN: 'test-token',
    TELEGRAM_CHAT_ID: 'test-chat',
    SUBMISSIONS,
    verifyHandler
  };
  env.SUBMISSION_COORDINATOR = new CoordinatorNamespace(env);
  return env;
}

async function withFetch(telegramHandler, action, verifyHandler) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('/access/certs')) return Response.json({ keys: [jwk] });
    if (String(url).includes('/siteverify')) return verifyHandler ? verifyHandler(url, options) : Response.json({ success: true, hostname: 'abbasbitar.github.io' });
    if (String(url).includes('api.telegram.org')) return telegramHandler(url, options);
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try { return await action(); }
  finally { globalThis.fetch = originalFetch; }
}

test('Telegram caption contains the clipboard emoji, not mojibake', async () => {
  let telegramCaption = '';
  await withFetch(async (_url, options) => {
    telegramCaption = options.body.get('caption');
    return Response.json({ ok: true });
  }, async () => {
    const env = environment(new MemoryKV());
    const response = await worker.fetch(request('123e4567-e89b-42d3-a456-426614174009'), env, {});
    assert.equal(response.status, 200);
  });

  assert.ok(telegramCaption.startsWith('\u{1F4CB} NEW META ADS CAMPAIGN'));
  assert.equal(telegramCaption.includes('\u00f0\u0178\u201c\u2039'), false);
});

test('same submission ID retry returns the original success without redelivery', async () => {
  const kv = new MemoryKV();
  let telegramCalls = 0;
  await withFetch(async () => {
    telegramCalls++;
    return Response.json({ ok: true });
  }, async () => {
    const env = environment(kv);
    const id = '123e4567-e89b-42d3-a456-426614174001';
    const first = await worker.fetch(request(id), env, {});
    const firstResult = await first.json();
    const retry = await worker.fetch(request(id), env, {});
    const retryResult = await retry.json();

    assert.equal(first.status, 200);
    assert.equal(retry.status, 200);
    assert.equal(retryResult.reference, firstResult.reference);
    assert.equal(telegramCalls, 1);
    assert.equal(env.SUBMISSION_COORDINATOR.getRecord(id).status, 'delivered');
    assert.equal(env.SUBMISSION_COORDINATOR.getRecord(id).payloadDigest, digest(data));
  });
});

test('concurrent same-ID requests are serialized through one coordinator', async () => {
  const kv = new MemoryKV();
  let telegramCalls = 0;
  let releaseTelegram;
  const telegramGate = new Promise(resolve => { releaseTelegram = resolve; });
  await withFetch(async () => {
    telegramCalls++;
    await telegramGate;
    return Response.json({ ok: true });
  }, async () => {
    const env = environment(kv);
    const id = '123e4567-e89b-42d3-a456-426614174002';
    const firstPromise = worker.fetch(request(id), env, {});
    while (!env.SUBMISSION_COORDINATOR.objects.has(id)) await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    const concurrent = await worker.fetch(request(id), env, {});
    releaseTelegram();
    const first = await firstPromise;

    assert.equal(first.status, 200);
    assert.equal(concurrent.status, 409);
    assert.equal(telegramCalls, 1);
  });
});

test('same ID with different payload is rejected without another send', async () => {
  const kv = new MemoryKV();
  let telegramCalls = 0;
  await withFetch(async () => { telegramCalls++; return Response.json({ ok: true }); }, async () => {
    const env = environment(kv);
    const id = '123e4567-e89b-42d3-a456-426614174004';
    assert.equal((await worker.fetch(request(id), env, {})).status, 200);
    const changed = await worker.fetch(request(id, { data: { ...data, budget: '200' } }), env, {});
    assert.equal(changed.status, 409);
    assert.match((await changed.json()).error, /different campaign data/i);
    assert.equal(telegramCalls, 1);
  });
});

test('legacy KV references require reconciliation instead of an unverifiable success', async () => {
  const kv = new MemoryKV();
  const id = '123e4567-e89b-42d3-a456-426614174008';
  kv.values.set(`submission:${id}`, 'MAP-20261102-123E4567');
  let telegramCalls = 0;
  await withFetch(async () => { telegramCalls++; return Response.json({ ok: true }); }, async () => {
    const env = environment(kv);
    const response = await worker.fetch(request(id), env, {});
    const result = await response.json();
    assert.equal(response.status, 409);
    assert.equal(result.status, 'delivery_unknown');
    assert.match(result.error, /no stored payload digest/i);
    assert.equal(telegramCalls, 0);
  });
});

test('failed Turnstile verification remains retryable with a fresh token', async () => {
  const kv = new MemoryKV();
  let verificationCalls = 0;
  let telegramCalls = 0;
  await withFetch(async () => { telegramCalls++; return Response.json({ ok: true }); }, async () => {
    const env = environment(kv);
    const id = '123e4567-e89b-42d3-a456-426614174005';
    const rejected = await worker.fetch(request(id), env, {});
    assert.equal(rejected.status, 403);
    assert.equal(env.SUBMISSION_COORDINATOR.getRecord(id).status, 'validating');
    const accepted = await worker.fetch(request(id, { token: 'fresh-token' }), env, {});
    assert.equal(accepted.status, 200);
    assert.equal(verificationCalls, 2);
    assert.equal(telegramCalls, 1);
  }, async () => {
    verificationCalls++;
    return verificationCalls === 1
      ? Response.json({ success: false, hostname: 'abbasbitar.github.io' })
      : Response.json({ success: true, hostname: 'abbasbitar.github.io' });
  });
});

test('stale sending state becomes delivery_unknown and is not resent', async () => {
  const kv = new MemoryKV();
  let telegramCalls = 0;
  await withFetch(async () => { telegramCalls++; return Response.json({ ok: true }); }, async () => {
    const env = environment(kv);
    const id = '123e4567-e89b-42d3-a456-426614174006';
    env.SUBMISSION_COORDINATOR.seed(id, {
      payloadDigest: digest(data), status: 'sending', reference: 'MAP-20261102-123E4567', updatedAt: Date.now() - 60000
    });
    const response = await worker.fetch(request(id), env, {});
    assert.equal(response.status, 409);
    assert.equal((await response.json()).status, 'delivery_unknown');
    assert.equal(env.SUBMISSION_COORDINATOR.getRecord(id).status, 'delivery_unknown');
    assert.equal(telegramCalls, 0);
  });
});

test('uncertain Telegram outcome stays blocked for manual reconciliation', async () => {
  const kv = new MemoryKV();
  let telegramCalls = 0;
  await withFetch(async () => {
    telegramCalls++;
    throw new Error('connection lost after request was accepted');
  }, async () => {
    const env = environment(kv);
    const id = '123e4567-e89b-42d3-a456-426614174003';
    const first = await worker.fetch(request(id), env, {});
    const retry = await worker.fetch(request(id), env, {});
    const firstResult = await first.json();
    assert.equal(first.status, 502);
    assert.equal(firstResult.status, 'delivery_unknown');
    assert.match(firstResult.error, /campaign owner with this reference/i);
    assert.equal(retry.status, 409);
    assert.equal(telegramCalls, 1);
  });
});

test('known Telegram rejection can retry with same ID and a fresh token', async () => {
  const kv = new MemoryKV();
  let telegramCalls = 0;
  await withFetch(async () => {
    telegramCalls++;
    return telegramCalls === 1 ? Response.json({ ok: false, error_code: 400 }) : Response.json({ ok: true });
  }, async () => {
    const env = environment(kv);
    const id = '123e4567-e89b-42d3-a456-426614174007';
    assert.equal((await worker.fetch(request(id), env, {})).status, 502);
    assert.equal(env.SUBMISSION_COORDINATOR.getRecord(id).status, 'validating');
    assert.equal((await worker.fetch(request(id, { token: 'fresh-token' }), env, {})).status, 200);
    assert.equal(telegramCalls, 2);
  });
});
