import test from 'node:test';
import assert from 'node:assert/strict';
import { privateObjectiveDecision, formatPrivateDecision } from '../worker/private-recommendation.js';

const base = { platform: 'boost', goal: 'profile', channels: ['Instagram Direct'] };

test('private Worker maps profile visits without promising followers', () => {
  const result = privateObjectiveDecision(base);
  assert.equal(result.status, 'recommended');
  assert.equal(result.candidateMetaObjective, 'OUTCOME_TRAFFIC');
  assert.equal(result.destination, 'instagram_profile');
  assert.match(formatPrivateDecision(result), /Verify in Meta:/);
});

test('messaging goal requires explicit primary destination; never infer from channels', () => {
  const result = privateObjectiveDecision({ ...base, goal: 'messages', channels: ['WhatsApp'] });
  assert.equal(result.status, 'clarification_required');
  assert.match(formatPrivateDecision(result), /primaryMessagingDestination/);
});

test('sales goal requires clarification rather than inventing purchase tracking', () => {
  const result = privateObjectiveDecision({ ...base, goal: 'sales', channels: ['WhatsApp'] });
  assert.equal(result.status, 'clarification_required');
  assert.equal(result.candidateMetaObjective, undefined);
});

test('legacy website traffic is preserved rather than labeled as tracked purchases', () => {
  const result = privateObjectiveDecision({ ...base, goal: 'website' });
  assert.equal(result.status, 'legacy_preserved');
  assert.match(result.rationale, /website-traffic/);
});

test('explicit messaging destination yields a private candidate', () => {
  const result = privateObjectiveDecision({ ...base, goal: 'messages', primaryMessagingDestination: 'whatsapp' });
  assert.equal(result.status, 'recommended');
  assert.equal(result.destination, 'whatsapp');
  assert.match(formatPrivateDecision(result), /OUTCOME_ENGAGEMENT/);
});
