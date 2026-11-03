import { adaptLegacyObjective } from '../src/legacy-objective-adapter.js';
import { recommendCampaignObjective } from '../src/recommendation.js';

// Runs only in the private Worker; never expose the recommendation result to the browser.
export function privateObjectiveDecision(data) {
  const adapted = adaptLegacyObjective(data);
  if (adapted.status !== 'mapped') {
    return { status: adapted.status, rationale: adapted.rationale, missingRequirements: adapted.missingRequirements || [] };
  }
  const recommendation = recommendCampaignObjective(adapted.recommendationInput);
  return {
    status: recommendation.status,
    rationale: recommendation.rationale,
    candidateMetaObjective: recommendation.candidateMetaObjective,
    destination: recommendation.destination,
    performanceGoal: recommendation.performanceGoal,
    cta: recommendation.cta,
    assumptions: recommendation.assumptions,
    verificationRequirements: recommendation.verificationRequirements
  };
}

export function formatPrivateDecision(decision) {
  const lines = ['🔐 PRIVATE OBJECTIVE RECOMMENDATION', 'Decision status: ' + decision.status];
  if (decision.candidateMetaObjective) lines.push('Candidate Meta objective: ' + decision.candidateMetaObjective);
  if (decision.destination) lines.push('Destination: ' + decision.destination);
  if (decision.performanceGoal) lines.push('Performance goal: ' + decision.performanceGoal);
  if (decision.cta) lines.push('CTA: ' + decision.cta);
  lines.push('Rationale: ' + decision.rationale);
  for (const item of decision.missingRequirements || []) lines.push('Clarification needed: ' + item);
  for (const item of decision.assumptions || []) lines.push('Assumption: ' + item);
  for (const item of decision.verificationRequirements || []) lines.push('Verify in Meta: ' + item);
  return lines.join('\n');
}
