import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendCampaignObjective } from '../src/recommendation.js';

const base = { requestedOutcome: 'profile_visits', tool: 'manager' };

const decisionCases = [
  {
    name: 'profile visits describe the measurable result without promising followers',
    input: base,
    expected: {
      status: 'recommended',
      candidateMetaObjective: 'OUTCOME_TRAFFIC',
      destination: 'instagram_profile',
      performanceGoal: 'instagram_profile_visits',
      cta: 'visit_instagram_profile'
    }
  },
  {
    name: 'Instagram Direct messages select one primary destination',
    input: { requestedOutcome: 'messages', tool: 'manager', primaryMessagingDestination: 'instagram_direct' },
    expected: {
      status: 'recommended',
      candidateMetaObjective: 'OUTCOME_ENGAGEMENT',
      destination: 'instagram_direct',
      performanceGoal: 'conversations',
      cta: 'send_message'
    }
  },
  {
    name: 'WhatsApp messages select one primary destination',
    input: { requestedOutcome: 'messages', tool: 'manager', primaryMessagingDestination: 'whatsapp' },
    expected: {
      status: 'recommended',
      candidateMetaObjective: 'OUTCOME_ENGAGEMENT',
      destination: 'whatsapp',
      performanceGoal: 'conversations',
      cta: 'send_message'
    }
  },
  {
    name: 'two messaging channels without a primary destination require clarification',
    input: {
      requestedOutcome: 'messages',
      tool: 'manager',
      messageDestinations: ['instagram_direct', 'whatsapp']
    },
    expected: { status: 'clarification_required', candidateMetaObjective: null, destination: null }
  },
  {
    name: 'two messaging channels with an explicit primary use only that destination',
    input: {
      requestedOutcome: 'messages',
      tool: 'manager',
      messageDestinations: ['instagram_direct', 'whatsapp'],
      primaryMessagingDestination: 'whatsapp'
    },
    expected: {
      status: 'recommended',
      candidateMetaObjective: 'OUTCOME_ENGAGEMENT',
      destination: 'whatsapp',
      performanceGoal: 'conversations',
      cta: 'send_message'
    },
    verify: result => assert.match(result.assumptions.join(' '), /excluded: Instagram Direct/)
  },
  {
    name: 'tracked website purchases require explicitly confirmed tested tracking',
    input: {
      requestedOutcome: 'website_purchases',
      tool: 'manager',
      trackingStatus: 'configured_tested',
      websiteUrl: 'https://shop.example.com'
    },
    expected: {
      status: 'recommended',
      candidateMetaObjective: 'OUTCOME_SALES',
      destination: 'website',
      performanceGoal: 'purchase',
      cta: 'shop_now'
    },
    verify: result => assert.match(result.assumptions.join(' '), /does not independently verify/)
  },
  {
    name: 'untracked website purchases do not suggest a fallback without acceptance',
    input: {
      requestedOutcome: 'website_purchases',
      tool: 'manager',
      trackingStatus: 'not_configured',
      websiteUrl: 'https://shop.example.com'
    },
    expected: { status: 'clarification_required', candidateMetaObjective: null, destination: null }
  },
  {
    name: 'explicitly accepted untracked purchase fallback is Traffic, not Sales',
    input: {
      requestedOutcome: 'website_purchases',
      tool: 'manager',
      trackingStatus: 'unknown',
      acceptTrafficFallback: true,
      websiteUrl: 'https://shop.example.com'
    },
    expected: {
      status: 'recommended',
      candidateMetaObjective: 'OUTCOME_TRAFFIC',
      destination: 'website',
      performanceGoal: 'landing_page_views',
      cta: 'learn_more'
    },
    verify: result => assert.match(result.rationale, /not purchase optimization/)
  },
  {
    name: 'awareness recommends no unselected performance goal or CTA',
    input: { requestedOutcome: 'awareness', tool: 'manager' },
    expected: {
      status: 'recommended',
      candidateMetaObjective: 'OUTCOME_AWARENESS',
      destination: null,
      performanceGoal: null,
      cta: null
    }
  },
  {
    name: 'instant-form leads return a candidate lead setup',
    input: { requestedOutcome: 'leads', tool: 'manager', leadCaptureMethod: 'instant_form' },
    expected: {
      status: 'recommended',
      candidateMetaObjective: 'OUTCOME_LEADS',
      destination: 'instant_form',
      performanceGoal: 'lead_submissions',
      cta: 'sign_up'
    }
  },
  {
    name: 'website-form leads require and use an HTTPS destination',
    input: {
      requestedOutcome: 'leads',
      tool: 'manager',
      leadCaptureMethod: 'website_form',
      websiteUrl: 'https://example.com/apply',
      trackingStatus: 'configured_tested'
    },
    expected: {
      status: 'recommended',
      candidateMetaObjective: 'OUTCOME_LEADS',
      destination: 'website_form',
      performanceGoal: 'lead_submissions',
      cta: 'learn_more'
    }
  },
  {
    name: 'messaging leads require a primary messaging destination',
    input: { requestedOutcome: 'leads', tool: 'manager', leadCaptureMethod: 'messaging' },
    expected: { status: 'clarification_required', candidateMetaObjective: null, destination: null }
  },
  {
    name: 'messaging leads identify tool availability as a verification requirement',
    input: {
      requestedOutcome: 'leads',
      tool: 'manager',
      leadCaptureMethod: 'messaging',
      primaryMessagingDestination: 'instagram_direct'
    },
    expected: {
      status: 'recommended',
      candidateMetaObjective: 'OUTCOME_LEADS',
      destination: 'instagram_direct',
      performanceGoal: 'lead_conversations',
      cta: 'send_message'
    },
    verify: result => assert.match(result.verificationRequirements.join(' '), /supports instagram_direct/)
  },
  {
    name: 'Boost candidates explicitly require verification in the Instagram interface',
    input: { requestedOutcome: 'messages', tool: 'boost', primaryMessagingDestination: 'whatsapp' },
    expected: {
      status: 'recommended',
      candidateMetaObjective: 'OUTCOME_ENGAGEMENT',
      destination: 'whatsapp',
      performanceGoal: 'conversations',
      cta: 'send_message'
    },
    verify: result => assert.match(result.verificationRequirements.join(' '), /actual Instagram interface/)
  }
];

for (const { name, input, expected, verify } of decisionCases) {
  test(name, () => {
    const result = recommendCampaignObjective(input);
    for (const [key, value] of Object.entries(expected)) assert.equal(result[key], value, key);
    assert.equal(typeof result.rationale, 'string');
    assert.ok(Array.isArray(result.assumptions));
    assert.ok(Array.isArray(result.verificationRequirements));
    verify?.(result);
  });
}

const clarificationCases = [
  ['non-object input', null],
  ['missing outcome', { tool: 'manager' }],
  ['missing tool', { requestedOutcome: 'profile_visits' }],
  ['missing website URL', { requestedOutcome: 'website_purchases', tool: 'manager', trackingStatus: 'configured_tested' }],
  ['missing tracking confirmation', { requestedOutcome: 'website_purchases', tool: 'manager', websiteUrl: 'https://example.com' }],
  ['missing fallback acceptance', { requestedOutcome: 'website_purchases', tool: 'manager', trackingStatus: 'unknown', websiteUrl: 'https://example.com' }],
  ['missing lead capture method', { requestedOutcome: 'leads', tool: 'manager' }],
  ['missing website lead URL', { requestedOutcome: 'leads', tool: 'manager', leadCaptureMethod: 'website_form' }],
  ['missing website lead tracking readiness', { requestedOutcome: 'leads', tool: 'manager', leadCaptureMethod: 'website_form', websiteUrl: 'https://example.com/apply' }],
  ['primary destination not in selected channels', {
    requestedOutcome: 'messages', tool: 'manager', messageDestinations: ['instagram_direct'], primaryMessagingDestination: 'whatsapp'
  }]
];

for (const [name, input] of clarificationCases) {
  test(`${name} returns clarification_required`, () => {
    assert.equal(recommendCampaignObjective(input).status, 'clarification_required');
  });
}

const unsupportedCases = [
  ['invalid outcome', { requestedOutcome: 'followers', tool: 'manager' }],
  ['invalid tool', { requestedOutcome: 'profile_visits', tool: 'business_suite' }],
  ['invalid tracking enum', { requestedOutcome: 'website_purchases', tool: 'manager', trackingStatus: 'maybe' }],
  ['invalid lead capture enum', { requestedOutcome: 'leads', tool: 'manager', leadCaptureMethod: 'phone_call' }],
  ['invalid message destination', { requestedOutcome: 'messages', tool: 'manager', messageDestinations: ['messenger'] }],
  ['null message destinations are invalid under the optional-array contract', { requestedOutcome: 'messages', tool: 'manager', messageDestinations: null }],
  ['invalid primary messaging destination', { requestedOutcome: 'messages', tool: 'manager', primaryMessagingDestination: 'messenger' }],
  ['invalid website protocol', { requestedOutcome: 'website_purchases', tool: 'manager', trackingStatus: 'configured_tested', websiteUrl: 'http://example.com' }],
  ['unexpected input key', { requestedOutcome: 'profile_visits', tool: 'manager', objective: 'OUTCOME_SALES' }],
  ['non-boolean fallback acceptance', { requestedOutcome: 'website_purchases', tool: 'manager', acceptTrafficFallback: 'yes' }]
];

for (const trackingStatus of ['not_configured', 'unknown']) {
  test(`website-form lead measurement remains outstanding when tracking is ${trackingStatus}`, () => {
    const result = recommendCampaignObjective({
      requestedOutcome: 'leads',
      tool: 'manager',
      leadCaptureMethod: 'website_form',
      websiteUrl: 'https://example.com/apply',
      trackingStatus
    });
    assert.equal(result.status, 'recommended');
    assert.deepEqual(result.assumptions, []);
    assert.match(result.rationale, /measurement is unconfirmed/);
    assert.match(result.verificationRequirements.join(' '), /Configure and test lead measurement/);
  });
}

for (const [name, input] of unsupportedCases) {
  test(`${name} returns unsupported`, () => {
    assert.equal(recommendCampaignObjective(input).status, 'unsupported');
  });
}

test('recommendation is deterministic and does not mutate its input', () => {
  const input = Object.freeze({
    requestedOutcome: 'messages',
    tool: 'manager',
    messageDestinations: Object.freeze(['instagram_direct', 'whatsapp']),
    primaryMessagingDestination: 'instagram_direct'
  });
  const before = structuredClone(input);
  assert.deepEqual(recommendCampaignObjective(input), recommendCampaignObjective(input));
  assert.deepEqual(input, before);
});
