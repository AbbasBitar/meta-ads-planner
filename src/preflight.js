import { calculateBudget, parsePostEntries, validate } from './intake.js';

// Representative-safe preflight only. Private objective decisions stay in the Worker.
export function preflightCampaign(data) {
  const blocking = validate(data);
  const warnings = [];
  const checks = [];
  const budget = calculateBudget(data);
  const average = budget.averageDaily;
  if (Number.isFinite(average) && average > 0 && average < 5)
    warnings.push('Average daily budget is below $5; delivery may be limited. This is guidance, not a Meta minimum.');
  if (data.post === 'multiple') {
    const posts = parsePostEntries(data.postEntries);
    if (posts) {
      checks.push('Confirm each post is eligible to advertise and the allocation is approved.');
      if (data.budgetType !== 'lifetime')
        blocking.push('Multiple-post allocations are lifetime amounts. Select Lifetime / total budget.');
    }
  }
  if (data.goal === 'sales' && !data.channels?.includes('Website'))
    warnings.push('Sales or bookings without a website purchase path require objective clarification. Confirm how conversions are measured.');
  if (data.goal === 'messages' && !data.channels?.some(c => c === 'Instagram Direct' || c === 'WhatsApp'))
    warnings.push('Messages objective selected without Instagram Direct or WhatsApp. Verify a supported messaging destination.');
  if (data.goal === 'website' && data.channels?.includes('Website'))
    checks.push('Verify landing page, tracking, consent, and destination compatibility before publishing.');
  if (data.category === 'Photography' && /newborn|baby|infant|child/i.test([data.product,data.audience].join(' ')))
    checks.push('Verify consent to use images of children in advertising.');
  checks.push('Confirm available objectives, targeting interests, placements, and CTA inside Meta before publishing.');
  return { blocking, warnings, checks };
}
