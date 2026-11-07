export const CREATION_METHODS = Object.freeze(['Instagram Boost', 'Meta Ads Manager']);
export const AD_GOALS = Object.freeze(['More messages', 'More profile visits', 'More website visits', 'More reach', 'More engagement']);

export const ORDERING_CHANNELS = Object.freeze([
  'Instagram Direct',
  'WhatsApp',
  'Website',
  'Phone',
  'In person'
]);

const REQUIRED_FIELDS = Object.freeze([
  ['pageName', 'Page name'],
  ['pageUrl', 'Instagram/Facebook handle or page URL'],
  ['businessDescription', 'Business description'],
  ['products', 'Products or services'],
  ['locations', 'Target locations']
]);

export function calculateBudget(formData) {
  const total = Number(formData.budget);
  const duration = Number(formData.duration);
  return {
    total,
    duration,
    daily: total / duration
  };
}

export function validateCampaign(formData) {
  const problems = [];
  for (const [field, label] of REQUIRED_FIELDS) {
    if (typeof formData[field] !== 'string' || !formData[field].trim()) {
      problems.push({ field, message: `${label} is required.` });
    }
  }

  if (formData.creationMethod !== undefined && !CREATION_METHODS.includes(formData.creationMethod)) {
    problems.push({ field: 'creationMethod', message: 'Choose Instagram Boost or Meta Ads Manager.' });
  }
  if (formData.adGoal !== undefined && !AD_GOALS.includes(formData.adGoal)) {
    problems.push({ field: 'adGoal', message: 'Choose a supported advertising goal.' });
  }

  const minAge = Number(formData.minAge);
  const maxAge = Number(formData.maxAge);
  if (!['All', 'Women', 'Men'].includes(formData.gender)) {
    problems.push({ field: 'gender', message: 'Choose All, Women, or Men for the gender preference.' });
  }
  if (!Number.isInteger(minAge) || minAge < 18 || minAge > 65) {
    problems.push({ field: 'minAge', message: 'Minimum age must be a whole number from 18 to 65.' });
  }
  if (!Number.isInteger(maxAge) || maxAge < 18 || maxAge > 65) {
    problems.push({ field: 'maxAge', message: 'Maximum age must be a whole number from 18 to 65.' });
  }
  if (Number.isInteger(minAge) && Number.isInteger(maxAge) && minAge >= 18 && maxAge <= 65 && maxAge < minAge) {
    problems.push({ field: 'maxAge', message: 'Maximum age must be at least the minimum age.' });
  }

  const budget = Number(formData.budget);
  if (!Number.isFinite(budget) || budget <= 0) {
    problems.push({ field: 'budget', message: 'Total advertising budget must be greater than $0.' });
  }
  const duration = Number(formData.duration);
  if (!Number.isInteger(duration) || duration < 1) {
    problems.push({ field: 'duration', message: 'Campaign duration must be at least 1 whole day.' });
  }

  if (!ORDERING_CHANNELS.includes(formData.orderingChannel)) {
    problems.push({ field: 'orderingChannel', message: 'Choose how customers place orders.' });
  }

  const postUrl = String(formData.postUrl ?? '').trim();
  if (postUrl) {
    try {
      const url = new URL(postUrl);
      const allowedHost = /(^|\.)(instagram\.com|facebook\.com|fb\.watch)$/i.test(url.hostname);
      if (url.protocol !== 'https:' || !allowedHost || url.username || url.password || url.port) {
        throw new Error('Unsupported post URL');
      }
    } catch {
      problems.push({ field: 'postUrl', message: 'Enter a valid HTTPS Instagram or Facebook post URL, or leave it blank.' });
    }
  }

  return problems;
}

function promptValue(value) {
  return JSON.stringify(String(value ?? '').trim());
}

export function generateChatGPTPrompt(formData) {
  const { total, daily, duration } = calculateBudget(formData);
  const postUrl = String(formData.postUrl ?? '').trim() || 'Not provided';
  const fields = [
    ['Campaign creation method', formData.creationMethod || 'Not specified; ask before giving interface steps'],
    ['Requested advertising goal', formData.adGoal || 'Not specified; recommend based on ordering channel'],
    ['Page name', formData.pageName],
    ['Instagram/Facebook handle or page URL', formData.pageUrl],
    ['Business description', formData.businessDescription],
    ['Products or services advertised', formData.products],
    ['Target locations', formData.locations],
    ['Minimum age preference', formData.minAge],
    ['Maximum age preference', formData.maxAge],
    ['Gender preference', formData.gender],
    ['Existing Instagram/Facebook post URL', postUrl],
    ['Total advertising budget (USD)', `$${total.toFixed(2)}`],
    ['Estimated daily budget (USD)', `$${daily.toFixed(2)} per day`],
    ['Campaign duration', `${duration} days`],
    ['How customers place orders', formData.orderingChannel]
  ];

  return [
    'Act as an experienced Meta Ads specialist. Analyze the campaign brief below and provide practical, clearly explained recommendations.',
    '',
    'CAMPAIGN INFORMATION',
    ...fields.map(([label, value]) => `- ${label}: ${promptValue(value)}`),
    '',
    'Please cover each item:',
    '1. Business and product analysis, including useful strengths and information gaps.',
    '2. Likely customer segments and the needs or behaviors that make them relevant.',
    '3. Recommended target audience, with a clear rationale tied to the brief.',
    '4. Suggested targeting interests, separating verified options currently available in Meta Ads Manager from unverified ideas that require confirmation.',
    '5. Recommended campaign objective, based on how customers actually place orders and the desired action.',
    '6. Recommended gender and age range; explain whether to keep or adjust the supplied preferences.',
    '7. Geographic targeting using the supplied locations; call out any locations that need clarification.',
    '8. Whether to start with broad or interest-based targeting, and why.',
    '9. Recommended messaging or conversion destination that matches the ordering channel.',
    '10. A suitable call to action (CTA).',
    '11. Daily and total budget recommendations. Preserve the supplied total budget and duration unless you clearly explain a suggested alternative.',
    '12. Campaign duration and any pacing considerations.',
    '13. A concise campaign configuration table with columns for campaign, ad set, and ad settings.',
    '14. A practical pre-publish checklist.',
    '15. Relevant assumptions, risks, missing details, and what should be verified before launch.',
    '16. Provide an exact configuration table for the SELECTED interface, including goal, audience, locations, age, gender, suggested interests, destination, total budget, duration, and CTA.',
    '17. Provide step-by-step instructions for the selected interface, ONE SCREEN AT A TIME. Stop after the current screen and wait for confirmation or a screenshot before moving on.',
    '',
    'GUIDANCE',
    '- Interface routing: Instagram Boost and Meta Ads Manager are DIFFERENT workflows. If Instagram Boost is selected, use only in-app Boost terminology and controls (for example More messages, audience, budget and duration); do not instruct the user to select Ads Manager campaign/ad-set conversion locations. If Ads Manager is selected, use its campaign, ad set, ad hierarchy and controls.',
    '- If the user selected Instagram Boost with an existing Reel, start from that Reel and Boost Reel/Boost post. Do not assume every Reel is eligible or every option appears.',
    '- For an Instagram Direct ordering channel, prefer a messages-focused goal and Instagram Direct destination when offered; explicitly verify the action opens a DM, not merely the Instagram profile. Distinguish More messages from More profile visits.',
    '- Treat the requested advertising goal as an input, not proof it is optimal. If it conflicts with how orders are placed, explain the mismatch and propose the suitable goal before proceeding.',
    '- Provide a short, prioritized list of specific, product-relevant interests the user can SEARCH FOR in the selected interface. Mark each as unverified until visibly available in their account. Do not claim any interest is confirmed without evidence. Recommend broad targeting if interests are absent or the audience is small; avoid stacking many interests.',
    '- Respect geographic precision: city and governorate/region are different. Ask for confirmation when Meta resolves a named city to a larger administrative area.',
    '- When Advantage+ audience is on, distinguish enforceable controls from suggestions such as gender and maximum age; never promise strict demographic exclusions unless the interface enforces them.',
    '- For a small lifetime budget, avoid unnecessary audience/ad-set fragmentation; keep the supplied total and duration. Check start/end dates and any platform fee or billing differences before publishing.',
    '- When using an existing post, verify it is selected and eligible. Review placements, messaging CTA, ad preview and pre-publish status.',
    '- Research online when useful, and cite sources for claims that depend on current information.',
    '- Distinguish verified facts from assumptions and recommendations.',
    '- Do not invent Meta targeting interests. Verify current availability where possible; mark every unverified interest as a suggestion that must be confirmed in Meta Ads Manager.',
    '- Do not guarantee sales, leads, reach, or any other advertising result.',
    '- The post URL is reference information only. Do not claim to have inspected the post or its contents unless you actually retrieved and reviewed them.',
    '- Recommend campaign objectives and destinations based on how customers actually place orders, not on a generic default.',
    '- If an important detail is missing, state the assumption or ask a focused follow-up question instead of making up a fact.'
  ].join('\n');
}
