import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, validPostUrl } from '../src/planner.js';
import { checkSubmission } from '../worker/index.js';
import { generate } from '../worker/planner.js';

const data = {
  client: 'Test Business',
  page: 'Test Page',
  representative: 'Test Representative',
  product: 'Jewelry',
  locations: 'Beirut',
  audience: 'Women interested in jewelry',
  channels: ['Instagram Direct'],
  budget: '20',
  days: '4',
  minAge: '23',
  maxAge: '45',
  budgetType: 'lifetime',
  goal: 'messages',
  category: 'Jewelry',
  language: 'English',
  platform: 'boost',
  post: 'existing',
  gender: 'Women',
  creative: 'Single image'
};

const submission = data => ({
  data,
  turnstileToken: 'test-token',
  submissionId: '123e4567-e89b-42d3-a456-426614174000'
});

test('accepts valid Instagram post URL', () => {
  const d = {...data, postUrl: 'https://www.instagram.com/p/ABC123/'};
  assert.deepEqual(validate(d), []);
  assert.deepEqual(checkSubmission(submission(d)), []);
});

test('accepts Instagram Reels and Facebook post URLs', () => {
  for (const url of [
    'https://www.instagram.com/reel/ABC123/',
    'https://www.facebook.com/example/posts/123456',
    'https://fb.watch/ABC123/'
  ]) {
    assert.equal(validPostUrl(url), true);
    assert.deepEqual(checkSubmission(submission({...data, postUrl: url})), []);
  }
});

test('rejects existing post without URL', () => {
  assert.ok(validate(data).length);
  assert.ok(checkSubmission(submission(data)).length);
});

test('rejects invalid and malicious URLs', () => {
  for (const url of [
    'http://www.instagram.com/p/ABC123/',
    'https://instagram.com.evil.com/p/ABC123/',
    'https://example.com/post',
    'javascript:alert(1)',
    'https://www.instagram.com/',
    'https://user:pass@www.instagram.com/p/ABC123/'
  ]) {
    assert.equal(validPostUrl(url), false, url);
    assert.ok(checkSubmission(submission({...data, postUrl: url})).length, url);
  }
});

test('new ad does not require post URL', () => {
  const d = {...data, post: 'new'};
  assert.deepEqual(validate(d), []);
  assert.deepEqual(checkSubmission(submission(d)), []);
});

test('post URL appears in generated report data', () => {
  const url = 'https://www.instagram.com/p/ABC123/';
  assert.equal(generate({...data, postUrl: url}).postUrl, url);
});
