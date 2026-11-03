import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptLegacyObjective } from '../src/legacy-objective-adapter.js';

const tools = ['manager', 'boost'];

for (const tool of tools) {
  test(`legacy profile goal maps to profile_visits for ${tool}`, () => {
    const result = adaptLegacyObjective({ platform: tool, goal: 'profile' });
    assert.equal(result.status, 'mapped');
    assert.equal(result.tool, tool);
    assert.equal(result.requestedOutcome, 'profile_visits');
    assert.deepEqual(result.recommendationInput, { requestedOutcome: 'profile_visits', tool });
  });

  test(`legacy reach goal maps to awareness for ${tool}`, () => {
    const result = adaptLegacyObjective({ platform: tool, goal: 'reach' });
    assert.equal(result.status, 'mapped');
    assert.deepEqual(result.recommendationInput, { requestedOutcome: 'awareness', tool });
  });

  test(`legacy messages goal requires an explicit primary destination for ${tool}`, () => {
    const result = adaptLegacyObjective({
      platform: tool,
      goal: 'messages',
      channels: ['Instagram Direct', 'WhatsApp']
    });
    assert.equal(result.status, 'clarification_required');
    assert.deepEqual(result.missingRequirements, ['primaryMessagingDestination']);
    assert.equal(result.recommendationInput, null);
  });

  for (const primaryMessagingDestination of ['instagram_direct', 'whatsapp']) {
    test(`legacy messages maps explicit ${primaryMessagingDestination} for ${tool}`, () => {
      const result = adaptLegacyObjective({
        platform: tool,
        goal: 'messages',
        channels: ['Instagram Direct', 'WhatsApp'],
        primaryMessagingDestination
      });
      assert.equal(result.status, 'mapped');
      assert.deepEqual(result.recommendationInput, {
        requestedOutcome: 'messages',
        tool,
        primaryMessagingDestination
      });
    });
  }

  test(`legacy sales goal remains ambiguous for ${tool}`, () => {
    const result = adaptLegacyObjective({ platform: tool, goal: 'sales', channels: ['Website'] });
    assert.equal(result.status, 'clarification_required');
    assert.equal(result.requestedOutcome, null);
    assert.equal(result.recommendationInput, null);
    assert.ok(result.missingRequirements.includes('specificSalesOutcome'));
  });

  test(`legacy website goal preserves website traffic for ${tool}`, () => {
    const result = adaptLegacyObjective({ platform: tool, goal: 'website' });
    assert.equal(result.status, 'legacy_preserved');
    assert.equal(result.legacyBehavior, 'website_traffic');
    assert.equal(result.requestedOutcome, null);
    assert.equal(result.recommendationInput, null);
  });

  test(`legacy engagement goal preserves post engagement for ${tool}`, () => {
    const result = adaptLegacyObjective({ platform: tool, goal: 'engagement' });
    assert.equal(result.status, 'legacy_preserved');
    assert.equal(result.legacyBehavior, 'post_engagement');
    assert.equal(result.requestedOutcome, null);
    assert.equal(result.recommendationInput, null);
  });
}

test('legacy channels remain contextual and do not become an implicit primary destination', () => {
  const result = adaptLegacyObjective({
    platform: 'manager',
    goal: 'messages',
    channels: ['Instagram Direct']
  });
  assert.equal(result.status, 'clarification_required');
  assert.deepEqual(result.contextualChannels, ['Instagram Direct']);
  assert.deepEqual(result.missingRequirements, ['primaryMessagingDestination']);
});

test('invalid goal and platform return unsupported', () => {
  assert.equal(adaptLegacyObjective({ platform: 'manager', goal: 'followers' }).status, 'unsupported');
  assert.equal(adaptLegacyObjective({ platform: 'business_suite', goal: 'profile' }).status, 'unsupported');
  assert.equal(adaptLegacyObjective({ goal: 'profile' }).status, 'unsupported');
});

test('invalid primary messaging destination returns unsupported', () => {
  const result = adaptLegacyObjective({
    platform: 'manager',
    goal: 'messages',
    primaryMessagingDestination: 'messenger'
  });
  assert.equal(result.status, 'unsupported');
  assert.equal(result.recommendationInput, null);
});

test('adapter returns rationale and explicit missing requirements without mutating input', () => {
  const input = Object.freeze({
    platform: 'manager',
    goal: 'messages',
    channels: Object.freeze(['Instagram Direct', 'WhatsApp'])
  });
  const before = structuredClone(input);
  const result = adaptLegacyObjective(input);
  assert.equal(typeof result.rationale, 'string');
  assert.ok(Array.isArray(result.missingRequirements));
  assert.deepEqual(input, before);
  assert.deepEqual(result.contextualChannels, ['Instagram Direct', 'WhatsApp']);
  assert.notEqual(result.contextualChannels, input.channels);
});

test('adapter result is deterministic', () => {
  const input = { platform: 'boost', goal: 'messages', primaryMessagingDestination: 'whatsapp' };
  assert.deepEqual(adaptLegacyObjective(input), adaptLegacyObjective(input));
});
