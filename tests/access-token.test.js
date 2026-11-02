import test from 'node:test';
import assert from 'node:assert/strict';
import { getAccessToken } from '../worker/access.js';

const URL = 'https://ads-planner.teckhub.net/api/submit';

test('extracts Access JWT from header', () => {
  const request = new Request(URL, {
    headers: {
      'Cf-Access-Jwt-Assertion': 'header-token'
    }
  });

  assert.equal(getAccessToken(request), 'header-token');
});

test('extracts Access JWT from cookie', () => {
  const request = new Request(URL, {
    headers: {
      Cookie: 'session=abc; CF_Authorization=cookie-token; theme=dark'
    }
  });

  assert.equal(getAccessToken(request), 'cookie-token');
});

test('prefers Access header over cookie', () => {
  const request = new Request(URL, {
    headers: {
      'Cf-Access-Jwt-Assertion': 'header-token',
      Cookie: 'CF_Authorization=cookie-token'
    }
  });

  assert.equal(getAccessToken(request), 'header-token');
});

test('rejects missing authentication token', () => {
  const request = new Request(URL);

  assert.equal(getAccessToken(request), null);
});

test('does not accept similarly named cookies', () => {
  const request = new Request(URL, {
    headers: {
      Cookie: 'Fake_CF_Authorization=invalid; CF_Authorization_backup=invalid'
    }
  });

  assert.equal(getAccessToken(request), null);
});
