import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { SubmissionCoordinator } from '../worker/index.js';
import {
  LEGACY_CAMPAIGN_PAYLOAD,
  LEGACY_FORM_ENTRIES,
  LEGACY_PAYLOAD_DIGEST
} from './fixtures/legacy-campaign-payload.js';

function extract(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `expected ${startMarker} and ${endMarker} in source`);
  return source.slice(start, end);
}

function fixtureFormData() {
  return class MockFormData {
    constructor() { this.entries = LEGACY_FORM_ENTRIES.map(([key, value]) => [key, value]); }
    delete(key) { this.entries = this.entries.filter(([name]) => name !== key); }
    *keys() { for (const [key] of this.entries) yield key; }
    get(key) { return this.entries.find(([name]) => name === key)?.[1] ?? null; }
    getAll(key) { return this.entries.filter(([name]) => name === key).map(([, value]) => value); }
  };
}

function makeStorage() {
  const values = new Map();
  return {
    values,
    get length() { return values.size; },
    key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
}

function makeBrowserContext(storage, ids = { value: 0 }, legacyPayload = LEGACY_CAMPAIGN_PAYLOAD) {
  const source = readFileSync('app.js', 'utf8');
  const persistence = extract(source, 'let memoryPendingSubmission=', 'function getData()');
  return {
    context: vm.createContext({
      localStorage: storage,
      crypto: { subtle: webcrypto.subtle, randomUUID: () => `legacy-submission-${++ids.value}` },
      TextEncoder,
      navigator: { locks: { request: async (_name, _options, callback) => callback({}) } },
      Date: { now: () => 1_800_000_000_000 },
      legacyPayload
    }),
    persistence,
    ids
  };
}

async function callBrowserHelper(storage, body, ids = { value: 0 }, legacyPayload = LEGACY_CAMPAIGN_PAYLOAD) {
  const { context, persistence } = makeBrowserContext(storage, ids, legacyPayload);
  return vm.runInContext(`(async()=>{${persistence}${body}})()`, context);
}

test('legacy form serialization retains its exact structure and excludes recommendation inputs', () => {
  const source = readFileSync('app.js', 'utf8');
  const code = extract(source, 'function getData()', 'function money(');
  const context = vm.createContext({ FormData: fixtureFormData(), form: {} });
  const payload = JSON.parse(JSON.stringify(vm.runInContext(`${code}\ngetData()`, context)));

  assert.deepEqual(payload, LEGACY_CAMPAIGN_PAYLOAD);
  assert.equal(JSON.stringify(payload), JSON.stringify(LEGACY_CAMPAIGN_PAYLOAD));
  assert.deepEqual(Object.keys(payload), Object.keys(LEGACY_CAMPAIGN_PAYLOAD));
  for (const key of ['requestedOutcome', 'primaryMessagingDestination', 'trackingStatus', 'acceptTrafficFallback', 'leadCaptureMethod', 'recommendationVersion']) {
    assert.equal(Object.hasOwn(payload, key), false, `${key} must not enter the legacy payload`);
  }
});

test('legacy payload digest is stable across frontend retries and property-order changes', async () => {
  const storage = makeStorage();
  const ids = { value: 0 };
  const first = await callBrowserHelper(storage, `return await submissionIdFor(legacyPayload);`, ids);
  const reversed = Object.fromEntries(Object.entries(LEGACY_CAMPAIGN_PAYLOAD).reverse());
  const retry = await callBrowserHelper(storage, `return await submissionIdFor(legacyPayload);`, ids);
  const reorderedRetry = await callBrowserHelper(storage, `return await submissionIdFor(legacyPayload);`, ids, reversed);
  assert.equal(first, retry);
  assert.equal(retry, reorderedRetry);
  assert.equal(ids.value, 1);
  const records = [...storage.values.entries()];
  assert.equal(records.length, 1);
  assert.equal(records[0][0], `meta-ads-planner:pending:${LEGACY_PAYLOAD_DIGEST}`);
  assert.deepEqual(JSON.parse(records[0][1]), {
    id: first,
    digest: LEGACY_PAYLOAD_DIGEST,
    createdAt: 1_800_000_000_000
  });
  assert.notEqual(JSON.stringify(reversed), JSON.stringify(LEGACY_CAMPAIGN_PAYLOAD));
});

test('delivery_unknown blocks replacement IDs even when recommendation inputs are proposed', async () => {
  const storage = makeStorage();
  const ids = { value: 0 };
  const first = await callBrowserHelper(storage, `
    const id = await submissionIdFor(legacyPayload);
    markDeliveryUnknown(id);
    return id;
  `, ids);
  const blocked = await callBrowserHelper(storage, `
    return await submissionIdFor({ ...legacyPayload, requestedOutcome: 'profile_visits' });
  `, ids);

  assert.equal(blocked, null);
  assert.equal(ids.value, 1);
  assert.equal(storage.getItem('meta-ads-planner:unresolved-submission-id'), first);
});

test('Worker coordinator accepts the established digest for an already delivered legacy payload without redelivery', async () => {
  const reference = 'MAP-20261103-LEGACY01';
  const record = {
    payloadDigest: LEGACY_PAYLOAD_DIGEST,
    status: 'delivered',
    reference,
    updatedAt: 1_800_000_000_000
  };
  const values = new Map([['submission', record]]);
  const coordinator = new SubmissionCoordinator({ storage: {
    get: async key => values.get(key),
    put: async (key, value) => values.set(key, structuredClone(value))
  } }, {});

  const response = await coordinator.fetch(new Request('https://submission-coordinator.internal/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      submissionId: '123e4567-e89b-42d3-a456-426614174000',
      data: LEGACY_CAMPAIGN_PAYLOAD,
      turnstileToken: 'unused-for-delivered-retry'
    })
  }));
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(result, { success: true, reference });
  assert.deepEqual(values.get('submission'), record);
});
