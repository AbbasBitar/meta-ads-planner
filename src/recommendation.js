const OUTCOMES = new Set([
  'profile_visits',
  'messages',
  'website_purchases',
  'awareness',
  'leads'
]);
const TOOLS = new Set(['manager', 'boost']);
const MESSAGE_DESTINATIONS = new Set(['instagram_direct', 'whatsapp']);
const TRACKING_STATUSES = new Set(['configured_tested', 'not_configured', 'unknown']);
const LEAD_CAPTURE_METHODS = new Set(['instant_form', 'website_form', 'messaging']);
const INPUT_KEYS = new Set([
  'requestedOutcome',
  'tool',
  'messageDestinations',
  'primaryMessagingDestination',
  'trackingStatus',
  'acceptTrafficFallback',
  'websiteUrl',
  'leadCaptureMethod'
]);

function makeResult(input, status, rationale, details = {}) {
  return {
    status,
    requestedOutcome: typeof input?.requestedOutcome === 'string' ? input.requestedOutcome : null,
    selectedTool: typeof input?.tool === 'string' ? input.tool : null,
    candidateMetaObjective: null,
    destination: null,
    performanceGoal: null,
    cta: null,
    rationale,
    assumptions: [],
    verificationRequirements: [],
    ...details
  };
}

function clarification(input, rationale, details = {}) {
  return makeResult(input, 'clarification_required', rationale, details);
}

function unsupported(input, rationale) {
  return makeResult(input, 'unsupported', rationale);
}

function isHttpsUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function resolveMessagingDestination(input) {
  const destinations = input.messageDestinations;
  if (destinations !== undefined &&
      (!Array.isArray(destinations) || destinations.some(value => !MESSAGE_DESTINATIONS.has(value)))) {
    return { error: 'unsupported', rationale: 'Message destinations must be Instagram Direct or WhatsApp.' };
  }

  const uniqueDestinations = [...new Set(destinations || [])];
  const primary = input.primaryMessagingDestination;

  if (primary && !MESSAGE_DESTINATIONS.has(primary)) {
    return { error: 'unsupported', rationale: 'The primary messaging destination is not supported.' };
  }
  if (!primary) {
    return {
      error: 'clarification_required',
      rationale: uniqueDestinations.length > 1
        ? 'Choose one primary messaging destination: Instagram Direct or WhatsApp.'
        : 'Select one primary messaging destination: Instagram Direct or WhatsApp.'
    };
  }
  if (destinations !== undefined && !uniqueDestinations.includes(primary)) {
    return {
      error: 'clarification_required',
      rationale: 'The primary messaging destination must be one of the selected message destinations.'
    };
  }

  return { destination: primary, additionalDestinations: uniqueDestinations.filter(value => value !== primary) };
}

function verificationRequirements(input, subject) {
  const requirements = [
    `Verify the candidate objective, destination, performance goal, and CTA are available for this campaign in the selected tool.`
  ];
  if (input.tool === 'boost') {
    requirements.push(
      `Instagram Boost options are unverified. Confirm ${subject} in the actual Instagram interface for this account and post before relying on the recommendation.`
    );
  }
  return requirements;
}

function recommended(input, values, subject) {
  return makeResult(input, 'recommended', values.rationale, {
    candidateMetaObjective: values.candidateMetaObjective,
    destination: values.destination,
    performanceGoal: values.performanceGoal,
    cta: values.cta,
    assumptions: values.assumptions || [],
    verificationRequirements: [
      ...verificationRequirements(input, subject),
      ...(values.verificationRequirements || [])
    ]
  });
}

/**
 * Recommend a candidate Meta campaign setup from explicit business intent.
 *
 * @param {object} input
 * @param {'profile_visits'|'messages'|'website_purchases'|'awareness'|'leads'} input.requestedOutcome
 * @param {'manager'|'boost'} input.tool
 * @param {string[]} [input.messageDestinations] Available messaging destinations.
 * @param {'instagram_direct'|'whatsapp'} [input.primaryMessagingDestination]
 * @param {'configured_tested'|'not_configured'|'unknown'} [input.trackingStatus]
 * @param {boolean} [input.acceptTrafficFallback] Explicit acceptance of visits instead of purchase optimization.
 * @param {string} [input.websiteUrl] HTTPS destination for website outcomes.
 * @param {'instant_form'|'website_form'|'messaging'} [input.leadCaptureMethod]
 * @returns {{status:string,requestedOutcome:string|null,selectedTool:string|null,candidateMetaObjective:string|null,destination:string|null,performanceGoal:string|null,cta:string|null,rationale:string,assumptions:string[],verificationRequirements:string[]}}
 */
export function recommendCampaignObjective(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return clarification(null, 'Provide campaign intent and a selected advertising tool.');
  }

  const unknownKeys = Object.keys(input).filter(key => !INPUT_KEYS.has(key));
  if (unknownKeys.length) {
    return unsupported(input, `Unsupported recommendation input: ${unknownKeys.sort().join(', ')}.`);
  }
  if (input.requestedOutcome != null && input.requestedOutcome !== '' && !OUTCOMES.has(input.requestedOutcome)) {
    return unsupported(input, 'The requested campaign outcome is not supported.');
  }
  if (input.tool != null && input.tool !== '' && !TOOLS.has(input.tool)) {
    return unsupported(input, 'The selected advertising tool is not supported.');
  }
  if (input.trackingStatus != null && input.trackingStatus !== '' && !TRACKING_STATUSES.has(input.trackingStatus)) {
    return unsupported(input, 'Tracking status must be configured_tested, not_configured, or unknown.');
  }
  if (input.leadCaptureMethod != null && input.leadCaptureMethod !== '' && !LEAD_CAPTURE_METHODS.has(input.leadCaptureMethod)) {
    return unsupported(input, 'The lead capture method is not supported.');
  }
  if (input.messageDestinations !== undefined &&
      (!Array.isArray(input.messageDestinations) || input.messageDestinations.some(value => !MESSAGE_DESTINATIONS.has(value)))) {
    return unsupported(input, 'Message destinations must be Instagram Direct or WhatsApp.');
  }
  if (input.primaryMessagingDestination && !MESSAGE_DESTINATIONS.has(input.primaryMessagingDestination)) {
    return unsupported(input, 'The primary messaging destination is not supported.');
  }
  if (input.acceptTrafficFallback !== undefined && typeof input.acceptTrafficFallback !== 'boolean') {
    return unsupported(input, 'Traffic fallback acceptance must be true or false.');
  }

  if (!input.requestedOutcome) {
    return clarification(input, 'Select the primary business outcome before choosing a campaign objective.');
  }
  if (!input.tool) {
    return clarification(input, 'Select Ads Manager or Instagram Boost before choosing a campaign setup.');
  }

  switch (input.requestedOutcome) {
    case 'profile_visits':
      return recommended(input, {
        candidateMetaObjective: 'OUTCOME_TRAFFIC',
        destination: 'instagram_profile',
        performanceGoal: 'instagram_profile_visits',
        cta: 'visit_instagram_profile',
        rationale: 'Profile visits are measurable; this recommendation does not promise or optimize for guaranteed followers.',
        assumptions: ['Profile visits are the intended measurable result; follower growth is not guaranteed.']
      }, 'the profile-visit objective, Instagram profile destination, performance goal, and CTA');

    case 'messages': {
      const choice = resolveMessagingDestination(input);
      if (choice.error === 'unsupported') return unsupported(input, choice.rationale);
      if (choice.error) return clarification(input, choice.rationale);
      const names = { instagram_direct: 'Instagram Direct', whatsapp: 'WhatsApp' };
      return recommended(input, {
        candidateMetaObjective: 'OUTCOME_ENGAGEMENT',
        destination: choice.destination,
        performanceGoal: 'conversations',
        cta: 'send_message',
        rationale: `Recommend conversations directed to ${names[choice.destination]}.`,
        assumptions: [
          `The campaign uses ${names[choice.destination]} as its one primary messaging destination.`,
          ...(choice.additionalDestinations.length
            ? [`Other selected messaging destinations are excluded: ${choice.additionalDestinations.map(value => names[value]).join(', ')}.`]
            : [])
        ]
      }, `the Engagement messaging setup, ${names[choice.destination]} destination, conversation goal, and Send message CTA`);
    }

    case 'website_purchases': {
      if (input.websiteUrl && !isHttpsUrl(input.websiteUrl)) {
        return unsupported(input, 'Website outcomes require a valid HTTPS website URL.');
      }
      if (!input.websiteUrl) {
        return clarification(input, 'Provide the website destination for the purchase campaign.');
      }
      if (!input.trackingStatus) {
        return clarification(input, 'Confirm whether purchase tracking is configured and tested before recommending purchase optimization.');
      }
      if (input.trackingStatus === 'configured_tested') {
        return recommended(input, {
          candidateMetaObjective: 'OUTCOME_SALES',
          destination: 'website',
          performanceGoal: 'purchase',
          cta: 'shop_now',
          rationale: 'Purchase optimization is a candidate because tracking was explicitly reported as configured and tested.',
          assumptions: ['The campaign owner confirmed purchase tracking is configured and tested; this engine does not independently verify events.']
        }, 'the Sales website-purchase setup, Purchase event, and Shop now CTA');
      }
      if (input.acceptTrafficFallback !== true) {
        return clarification(input, 'Purchase tracking is not confirmed. Accept a Traffic/landing-page-views fallback explicitly, or configure and test purchase tracking first.');
      }
      return recommended(input, {
        candidateMetaObjective: 'OUTCOME_TRAFFIC',
        destination: 'website',
        performanceGoal: 'landing_page_views',
        cta: 'learn_more',
        rationale: 'This is an explicitly accepted visits fallback; it is not purchase optimization.',
        assumptions: ['The requester accepted Traffic/landing-page views because purchase tracking is not confirmed.', 'Visits do not establish or optimize completed purchases.']
      }, 'the Traffic website destination, landing-page-views goal, and Learn more CTA');
    }

    case 'awareness':
      return recommended(input, {
        candidateMetaObjective: 'OUTCOME_AWARENESS',
        destination: null,
        performanceGoal: null,
        cta: null,
        rationale: 'Awareness is the candidate objective. A specific performance goal and CTA require selection and verification in the chosen tool.',
        assumptions: ['No reach, ad-recall, or other awareness performance goal is assumed.']
      }, 'the Awareness objective and any selected awareness performance goal or CTA');

    case 'leads': {
      if (!input.leadCaptureMethod) {
        return clarification(input, 'Choose instant form, website form, or messaging as the lead capture method.');
      }
      if (input.leadCaptureMethod === 'instant_form') {
        return recommended(input, {
          candidateMetaObjective: 'OUTCOME_LEADS',
          destination: 'instant_form',
          performanceGoal: 'lead_submissions',
          cta: 'sign_up',
          rationale: 'An instant form is the selected lead capture candidate; confirm it is available in the chosen tool.',
          assumptions: ['The campaign owner will review the form fields and follow-up process before launch.']
        }, 'the Leads instant-form destination, lead-submission goal, and Sign up CTA');
      }
      if (input.leadCaptureMethod === 'website_form') {
        if (input.websiteUrl && !isHttpsUrl(input.websiteUrl)) {
          return unsupported(input, 'Website lead capture requires a valid HTTPS website URL.');
        }
        if (!input.websiteUrl) {
          return clarification(input, 'Provide the website destination for the lead form.');
        }
        if (!input.trackingStatus) {
          return clarification(input, 'Confirm whether lead measurement is configured and tested, or leave it unconfirmed for manual verification.');
        }
        const measurementOutstanding = input.trackingStatus !== 'configured_tested';
        return recommended(input, {
          candidateMetaObjective: 'OUTCOME_LEADS',
          destination: 'website_form',
          performanceGoal: 'lead_submissions',
          cta: 'learn_more',
          rationale: measurementOutstanding
            ? 'A website form is the selected lead capture candidate; lead measurement is unconfirmed and must be verified before relying on lead-submission optimization.'
            : 'A website form is the selected lead capture candidate; the campaign owner reports lead measurement as configured and tested.',
          assumptions: measurementOutstanding
            ? []
            : ['The campaign owner reports lead measurement is configured and tested; this engine does not independently verify events.'],
          verificationRequirements: measurementOutstanding
            ? ['Configure and test lead measurement before relying on the lead-submission performance goal.']
            : []
        }, 'the Leads website-form destination, lead-submission goal, and CTA');
      }

      const choice = resolveMessagingDestination(input);
      if (choice.error === 'unsupported') return unsupported(input, choice.rationale);
      if (choice.error) return clarification(input, choice.rationale);
      return recommended(input, {
        candidateMetaObjective: 'OUTCOME_LEADS',
        destination: choice.destination,
        performanceGoal: 'lead_conversations',
        cta: 'send_message',
        rationale: 'Messaging is the selected lead-capture candidate; confirm that this lead setup is available for the selected messaging destination and tool.',
        assumptions: ['The selected messaging destination is used as the single primary lead channel.'],
        verificationRequirements: [
          `Verify the Leads objective supports ${choice.destination} as a lead destination in the selected tool and account.`,
          ...(choice.additionalDestinations.length
            ? [`Other selected messaging destinations are excluded: ${choice.additionalDestinations.join(', ')}.`]
            : [])
        ]
      }, `the Leads messaging destination ${choice.destination}, lead-conversation goal, and Send message CTA`);
    }

    default:
      return unsupported(input, 'The requested campaign outcome is not supported.');
  }
}
