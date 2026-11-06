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
    '',
    'GUIDANCE',
    '- Research online when useful, and cite sources for claims that depend on current information.',
    '- Distinguish verified facts from assumptions and recommendations.',
    '- Do not invent Meta targeting interests. Verify current availability where possible; mark every unverified interest as a suggestion that must be confirmed in Meta Ads Manager.',
    '- Do not guarantee sales, leads, reach, or any other advertising result.',
    '- The post URL is reference information only. Do not claim to have inspected the post or its contents unless you actually retrieved and reviewed them.',
    '- Recommend campaign objectives and destinations based on how customers actually place orders, not on a generic default.',
    '- If an important detail is missing, state the assumption or ask a focused follow-up question instead of making up a fact.'
  ].join('\n');
}
