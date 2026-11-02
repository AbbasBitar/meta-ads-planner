import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

test('getData excludes Turnstile response from customer data', () => {
  const source = readFileSync('app.js', 'utf8');

  const start = source.indexOf('function getData()');
  const end = source.indexOf('function money(', start);

  assert.ok(start >= 0 && end > start, 'getData function must exist');

  const code = source.slice(start, end);

  class MockFormData {
    constructor() {
      this.fields = new Map([
        ['client', 'Test Client'],
        ['description', 'Test business'],
        ['cf-turnstile-response', 'dummy-token'],
        ['channels', ['Instagram Direct']]
      ]);
    }

    delete(key) { this.fields.delete(key); }
    keys() { return this.fields.keys(); }
    get(key) { return this.fields.get(key); }
    getAll(key) { return this.fields.get(key) || []; }
  }

  const context = vm.createContext({
    FormData: MockFormData,
    form: {}
  });

  const result = vm.runInContext(code + '\ngetData()', context);

  assert.equal(result.client, 'Test Client');
  assert.equal(result.description, 'Test business');
  assert.equal(
    Object.hasOwn(result, 'cf-turnstile-response'),
    false
  );
  assert.equal(result.channels[0], 'Instagram Direct');
});

function makeLocks(){
  let held=false;
  return {request:async(_name,options,callback)=>{
    if(options?.ifAvailable&&held)return callback(null);
    if(held)return callback(null);
    held=true;
    try{return await callback({});}finally{held=false;}
  }};
}

function makeSubmissionContext(storage, clock, ids, locks = makeLocks()) {
  const source = readFileSync('app.js', 'utf8');
  const start = source.indexOf('let memoryPendingSubmission=');
  const end = source.indexOf('function getData()', start);
  assert.ok(start >= 0 && end > start, 'submission persistence helpers must exist');
  const context = vm.createContext({
    localStorage: storage,
    crypto: { subtle: webcrypto.subtle, randomUUID: () => `submission-${++ids.value}` },
    TextEncoder,
    navigator: locks===null ? {} : { locks },
    Date: { now: () => clock.now }
  });
  return { context, code: source.slice(start, end) };
}

function makeStorage(options = {}) {
  const values = new Map();
  let pendingReadBack=false;
  return {
    values,
    get length() { return values.size; },
    key: index => [...values.keys()][index] ?? null,
    getItem: key => {
      if(options.failRead)throw new Error('storage read denied');
      if(options.failReadKey===key)throw new Error('storage key read denied');
      if(options.failReadBack&&pendingReadBack&&key.startsWith('meta-ads-planner:pending:')){pendingReadBack=false;return null;}
      return values.get(key) ?? null;
    },
    setItem: (key, value) => {
      if(options.failWrite)throw new Error('storage write denied');
      values.set(key, value);
      if(options.failReadBack&&key.startsWith('meta-ads-planner:pending:'))pendingReadBack=true;
    },
    removeItem: key => values.delete(key)
  };
}

async function runSubmissionHelpers(storage, clock, ids, body, locks = undefined) {
  const { context, code } = makeSubmissionContext(storage, clock, ids, locks);
  return vm.runInContext(`(async()=>{ ${code} ${body} })()`, context);
}

test('persists only ID, SHA-256 digest, and timestamp; reloads reuse the ID', async () => {
  const storage = makeStorage(), clock = { now: 1_000_000 }, ids = { value: 0 };
  const saved = await runSubmissionHelpers(storage, clock, ids, `
    const id = await submissionIdFor({ client: 'Private Client A', budget: '937' });
    return id;
  `);
  const retry = await runSubmissionHelpers(storage, clock, ids, `
    return await submissionIdFor({ budget: '937', client: 'Private Client A' });
  `);
  assert.equal(saved, retry);
  const records = [...storage.values.entries()];
  assert.equal(records.length, 1);
  const record = JSON.parse(records[0][1]);
  assert.deepEqual(Object.keys(record).sort(), ['createdAt', 'digest', 'id']);
  assert.equal(record.id, saved);
  assert.equal(record.createdAt, clock.now);
  assert.match(record.digest, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(records), /Private Client|937/);
});

test('expires an ordinary pending ID after seven days and creates a new one', async () => {
  const storage = makeStorage(), clock = { now: 10_000 }, ids = { value: 0 };
  const first = await runSubmissionHelpers(storage, clock, ids, `return await submissionIdFor({ client: 'A' });`);
  clock.now += 7 * 24 * 60 * 60 * 1000 + 1;
  const afterExpiration = await runSubmissionHelpers(storage, clock, ids, `return await submissionIdFor({ client: 'A' });`);
  assert.notEqual(first, afterExpiration);
});

test('changed campaign data creates a distinct ID', async () => {
  const storage = makeStorage(), clock = { now: 10_000 }, ids = { value: 0 };
  const first = await runSubmissionHelpers(storage, clock, ids, `return await submissionIdFor({ client: 'A' });`);
  const changed = await runSubmissionHelpers(storage, clock, ids, `return await submissionIdFor({ client: 'B' });`);
  assert.notEqual(first, changed);
  assert.equal(storage.values.size, 2);
});

test('Web Locks serialize first-time ID creation across tabs when supported', async () => {
  const storage = makeStorage(), clock = { now: 10_000 }, ids = { value: 0 };
  let queue = Promise.resolve();
  const locks = { request: (_name, _options, callback) => {
    const result = queue.then(() => callback({}));
    queue = result.then(() => undefined, () => undefined);
    return result;
  } };
  const body = `return await submissionIdFor({ client: 'same campaign' });`;
  const [first, second] = await Promise.all([
    runSubmissionHelpers(storage, clock, ids, body, locks),
    runSubmissionHelpers(storage, clock, ids, body, locks)
  ]);
  assert.equal(first, second);
  assert.equal(first, 'submission-1');
  assert.equal(ids.value, 1);
});

test('blocks submission when Web Locks are unsupported instead of racing localStorage', async () => {
  const storage=makeStorage(),clock={now:10_000},ids={value:0};
  await assert.rejects(
    runSubmissionHelpers(storage,clock,ids,`return await submissionIdFor({ client: 'same campaign' });`,null),
    /cannot safely coordinate submissions across tabs/i
  );
  assert.equal(storage.values.size,0);
  assert.equal(ids.value,0);
});

test('concurrent tab submissions cannot both enter the locked submission section', async () => {
  const storage=makeStorage(),clock={now:10_000},ids={value:0},locks=makeLocks();
  let releaseFirst;
  const waitForRelease=new Promise(resolve=>{releaseFirst=resolve;});
  const firstContext=makeSubmissionContext(storage,clock,ids,locks);
  const secondContext=makeSubmissionContext(storage,clock,ids,locks);
  firstContext.context.entered=0;firstContext.context.waitForRelease=waitForRelease;
  secondContext.context.entered=0;
  const first=vm.runInContext(`(async()=>{${firstContext.code}await withSubmissionLock(async()=>{entered++;await waitForRelease;});})()`,firstContext.context);
  await new Promise(resolve=>setImmediate(resolve));
  const second=vm.runInContext(`(async()=>{${secondContext.code}await withSubmissionLock(async()=>{entered++;});})()`,secondContext.context);
  await assert.rejects(second,/already being processed in another tab/i);
  releaseFirst();
  await first;
  assert.equal(firstContext.context.entered,1);
  assert.equal(secondContext.context.entered,0);
  assert.equal(ids.value,0);
});

test('fails closed when localStorage writes fail', async () => {
  const storage=makeStorage({failWrite:true}),clock={now:10_000},ids={value:0};
  await assert.rejects(
    runSubmissionHelpers(storage,clock,ids,`return await submissionIdFor({ client: 'A' });`),
    /could not persist and verify the recovery ID.*No submission was sent/i
  );
  assert.equal(storage.values.size,0);
});

test('fails closed when the pending record cannot be read back after writing', async () => {
  const storage=makeStorage({failReadBack:true}),clock={now:10_000},ids={value:0};
  await assert.rejects(
    runSubmissionHelpers(storage,clock,ids,`return await submissionIdFor({ client: 'A' });`),
    /could not persist and verify the recovery ID.*No submission was sent/i
  );
});

test('fails closed when localStorage reads fail', async () => {
  const storage=makeStorage({failRead:true}),clock={now:10_000},ids={value:0};
  await assert.rejects(
    runSubmissionHelpers(storage,clock,ids,`return await submissionIdFor({ client: 'A' });`),
    /could not be read safely.*No submission was sent/i
  );
});

test('fails closed when the unresolved-delivery marker cannot be read', async () => {
  const storage=makeStorage();
  storage.values.set('meta-ads-planner:unresolved-submission-id','uncertain-id');
  storage.getItem=key=>{
    if(key==='meta-ads-planner:unresolved-submission-id')throw new Error('marker read denied');
    return storage.values.get(key)??null;
  };
  const clock={now:10_000},ids={value:0};
  await assert.rejects(
    runSubmissionHelpers(storage,clock,ids,`return await submissionIdFor({ client: 'A' });`),
    /could not be read safely.*No submission was sent/i
  );
  assert.equal(ids.value,0);
});

test('maintenance responses clear only the in-flight marker and preserve the recovery ID', async () => {
  const storage=makeStorage(),clock={now:10_000},ids={value:0};
  const first=await runSubmissionHelpers(storage,clock,ids,`
    const id=await submissionIdFor({ client: 'A' });
    markDeliveryUnknown(id);
    const paused=deliveryIsUnknown({status:503},{code:'submissions_paused',status:'maintenance'});
    const invalid=deliveryIsUnknown({status:503},{code:'maintenance_configuration_invalid',status:'maintenance'});
    if(!paused&&!invalid)clearDeliveryUnknown(id);
    return {id,paused,invalid};
  `);
  const retry=await runSubmissionHelpers(storage,clock,ids,`return await submissionIdFor({ client: 'A' });`);
  assert.equal(first.paused,false);
  assert.equal(first.invalid,false);
  assert.equal(retry,first.id);
  assert.equal(ids.value,1);
  assert.equal(storage.getItem('meta-ads-planner:unresolved-submission-id'),null);
  assert.equal(storage.values.size,1);
});

test('confirmed success clears the pending record', async () => {
  const storage = makeStorage(), clock = { now: 10_000 }, ids = { value: 0 };
  const first = await runSubmissionHelpers(storage, clock, ids, `
    const id = await submissionIdFor({ client: 'A' });
    clearPendingSubmission();
    return id;
  `);
  assert.equal(storage.values.size, 0);
  const next = await runSubmissionHelpers(storage, clock, ids, `return await submissionIdFor({ client: 'A' });`);
  assert.notEqual(first, next);
});

test('uncertain delivery retains and blocks the ID, including after reload and payload changes', async () => {
  const storage = makeStorage(), clock = { now: 10_000 }, ids = { value: 0 };
  const first = await runSubmissionHelpers(storage, clock, ids, `
    const id = await submissionIdFor({ client: 'A' });
    markDeliveryUnknown(id);
    return id;
  `);
  const blocked = await runSubmissionHelpers(storage, clock, ids, `return await submissionIdFor({ client: 'B' });`);
  assert.equal(blocked, null);
  assert.equal(storage.getItem('meta-ads-planner:unresolved-submission-id'), first);
  assert.equal(storage.values.size, 2);
});

test('a replacement ID is created only after explicit reconciliation approval', async () => {
  const storage=makeStorage(),clock={now:10_000},ids={value:0};
  const first=await runSubmissionHelpers(storage,clock,ids,`const id=await submissionIdFor({ client: 'A' });markDeliveryUnknown(id);return id;`);
  const approved=await runSubmissionHelpers(storage,clock,ids,`
    approvedUnresolvedId='${first}';clearPendingSubmission('${first}');approvedUnresolvedId='${first}';
    return await submissionIdFor({ client: 'A' });
  `);
  assert.notEqual(approved,first);
  assert.equal(storage.getItem('meta-ads-planner:unresolved-submission-id'),null);
});
