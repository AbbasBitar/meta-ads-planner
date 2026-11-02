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

async function sendRequest(email, options = {}) {
  const request = new Request(`${ORIGIN}/submit`, {
    method: 'POST',
    headers: {
      Origin: ORIGIN,
      'Content-Type': 'application/json',
      'Cf-Access-Jwt-Assertion': createToken(email)
    },
    body: options.body ?? '{}'
  });

  const env = {
    ACCESS_AUD: AUD,
    APPROVED_EMAILS: APPROVED,

    // Dummy test values; no external services are contacted.
    TURNSTILE_SECRET: 'test-turnstile-secret',
    TELEGRAM_BOT_TOKEN: 'test-telegram-token',
    TELEGRAM_CHAT_ID: 'test-chat-id',

    SUBMISSIONS: {
      get: async () => { options.kvReads?.(); return null; },
      put: async () => { options.kvWrites?.(); }
    },
    SUBMISSION_COORDINATOR: {
      idFromName: () => 'unused',
      get: () => { options.coordinatorGets?.(); return { fetch: async () => Response.json({}) }; }
    }
  };
  if(options.includePause!==false)env.SUBMISSIONS_PAUSED=options.pause??'false';
  return worker.fetch(request, env);
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
    const response = await sendRequest('unknown@gmail.com',{pause:'true'});

    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, 'Unauthorized');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('paused submissions return 503 after authentication and before validation or delivery work', async () => {
  const originalFetch=globalThis.fetch;
  let turnstileCalls=0,kvCalls=0,coordinatorCalls=0;
  globalThis.fetch=async url=>{
    if(String(url).includes('/access/certs'))return new Response(JSON.stringify({keys:[jwk]}),{status:200});
    if(String(url).includes('/siteverify'))turnstileCalls++;
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try{
    const response=await sendRequest('rep1@gmail.com',{
      pause:'true',
      kvReads:()=>kvCalls++,
      kvWrites:()=>kvCalls++,
      coordinatorGets:()=>coordinatorCalls++
    });
    assert.equal(response.status,503);
    assert.deepEqual(await response.json(),{
      error:'Submissions are temporarily paused for maintenance. Your recovery ID has been preserved; retry after submissions are re-enabled.',
      code:'submissions_paused',
      status:'maintenance'
    });
    assert.equal(turnstileCalls,0);
    assert.equal(kvCalls,0);
    assert.equal(coordinatorCalls,0);
  }finally{globalThis.fetch=originalFetch;}
});

test('unpaused configuration continues normal request validation', async () => {
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({keys:[jwk]}),{status:200});
  try{
    const response=await sendRequest('rep1@gmail.com',{pause:'false'});
    assert.equal(response.status,400);
    assert.equal((await response.json()).error,'Invalid request');
  }finally{globalThis.fetch=originalFetch;}
});

test('missing or invalid maintenance configuration fails closed', async () => {
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({keys:[jwk]}),{status:200});
  try{
    for(const options of [
      {includePause:false},
      {pause:''},
      {pause:'TRUE'},
      {pause:'yes'},
      {pause:false}
    ]){
      const response=await sendRequest('rep1@gmail.com',options);
      assert.equal(response.status,503);
      const result=await response.json();
      assert.equal(result.code,'maintenance_configuration_invalid');
      assert.equal(result.status,'maintenance');
    }
  }finally{globalThis.fetch=originalFetch;}
});

test('health remains available while submissions are paused or maintenance config is missing', async () => {
  const paused=await worker.fetch(new Request('https://api.example/health'),{SUBMISSIONS_PAUSED:'true'});
  const missing=await worker.fetch(new Request('https://api.example/health'),{});
  assert.equal(paused.status,200);
  assert.equal(missing.status,200);
  assert.deepEqual(await paused.json(),{status:'ok',service:'meta-ads-planner-api'});
});
