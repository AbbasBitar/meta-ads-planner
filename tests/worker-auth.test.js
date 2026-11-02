import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';

const AUD = 'test-application-audience';

test('rejects unauthenticated submission before processing', async () => {
  const request = new Request(
    'https://ads-planner.teckhub.net/submit',
    {
      method: 'POST',
      headers: {
        Origin: 'https://abbasbitar.github.io',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        submissionId: crypto.randomUUID(),
        data: {},
        turnstileToken: 'test-token'
      })
    }
  );

  const response = await worker.fetch(request, {
    ACCESS_AUD: AUD
  }, {});

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: 'Unauthorized'
  });
});

test('rejects requests with invalid Access JWT', async () => {
  const request = new Request(
    'https://ads-planner.teckhub.net/submit',
    {
      method: 'POST',
      headers: {
        Origin: 'https://abbasbitar.github.io',
        'Content-Type': 'application/json',
        'Cf-Access-Jwt-Assertion': 'invalid.jwt.token'
      },
      body: '{}'
    }
  );

  const response = await worker.fetch(request, {
    ACCESS_AUD: AUD
  }, {});

  assert.equal(response.status, 401);
});
