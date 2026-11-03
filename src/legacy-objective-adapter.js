const LEGACY_TOOLS = new Set(['manager', 'boost']);
const LEGACY_GOALS = new Set(['profile', 'messages', 'sales', 'reach', 'engagement', 'website']);
const MESSAGE_DESTINATIONS = new Set(['instagram_direct', 'whatsapp']);

function result(input, status, rationale, details = {}) {
  return {
    status,
    legacyGoal: typeof input?.goal === 'string' ? input.goal : null,
    legacyPlatform: typeof input?.platform === 'string' ? input.platform : null,
    tool: null,
    requestedOutcome: null,
    recommendationInput: null,
    legacyBehavior: null,
    contextualChannels: Array.isArray(input?.channels) ? [...input.channels] : [],
    rationale,
    missingRequirements: [],
    ...details
  };
}

/**
 * Translate unambiguous legacy campaign selections without inferring intent
 * from the legacy contact/order channel list.
 *
 * @param {object} input Legacy fields: platform, goal, channels, and optionally
 *   an explicitly selected primaryMessagingDestination.
 * @returns {{status:string,legacyGoal:string|null,legacyPlatform:string|null,tool:string|null,requestedOutcome:string|null,recommendationInput:object|null,legacyBehavior:string|null,contextualChannels:unknown[],rationale:string,missingRequirements:string[]}}
 */
export function adaptLegacyObjective(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return result(null, 'unsupported', 'Legacy campaign input must be an object.');
  }

  if (!LEGACY_TOOLS.has(input.platform)) {
    return result(input, 'unsupported', 'The legacy advertising platform is missing or invalid.');
  }
  if (!LEGACY_GOALS.has(input.goal)) {
    return result(input, 'unsupported', 'The legacy campaign goal is missing or invalid.', {
      tool: input.platform
    });
  }

  const tool = input.platform;
  const mapped = {
    profile: {
      requestedOutcome: 'profile_visits',
      rationale: 'Legacy profile goal maps to measurable profile visits; follower growth is not guaranteed.'
    },
    reach: {
      requestedOutcome: 'awareness',
      rationale: 'Legacy reach goal maps to awareness; no specific performance goal or CTA is inferred.'
    }
  }[input.goal];

  if (mapped) {
    const recommendationInput = { requestedOutcome: mapped.requestedOutcome, tool };
    return result(input, 'mapped', mapped.rationale, {
      tool,
      requestedOutcome: mapped.requestedOutcome,
      recommendationInput
    });
  }

  if (input.goal === 'messages') {
    const primary = input.primaryMessagingDestination;
    if (primary === undefined || primary === null || primary === '') {
      return result(input, 'clarification_required', 'Choose one primary messaging destination; legacy contact channels do not determine the campaign destination.', {
        tool,
        missingRequirements: ['primaryMessagingDestination']
      });
    }
    if (!MESSAGE_DESTINATIONS.has(primary)) {
      return result(input, 'unsupported', 'The primary messaging destination must be Instagram Direct or WhatsApp.', { tool });
    }
    const recommendationInput = {
      requestedOutcome: 'messages',
      tool,
      primaryMessagingDestination: primary
    };
    return result(input, 'mapped', `Legacy messages goal maps to messages with explicitly selected ${primary} as the primary destination.`, {
      tool,
      requestedOutcome: 'messages',
      recommendationInput
    });
  }

  if (input.goal === 'sales') {
    return result(input, 'clarification_required', 'Clarify whether sales means tracked website purchases, website traffic, or messaging/bookings; the legacy goal does not specify the outcome or tracking readiness.', {
      tool,
      missingRequirements: ['specificSalesOutcome', 'trackingStatus', 'destination']
    });
  }

  if (input.goal === 'website') {
    return result(input, 'legacy_preserved', 'Keep the existing website-traffic behavior; this legacy goal is not a website-purchase recommendation.', {
      tool,
      legacyBehavior: 'website_traffic'
    });
  }

  return result(input, 'legacy_preserved', 'Keep the existing post-engagement behavior; no different canonical outcome is inferred.', {
    tool,
    legacyBehavior: 'post_engagement'
  });
}
