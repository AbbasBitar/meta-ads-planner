import { adaptLegacyObjective } from '../src/legacy-objective-adapter.js';
import { recommendCampaignObjective } from '../src/recommendation.js';

export default {
  fetch() {
    const adapted = adaptLegacyObjective({
      platform: 'manager',
      goal: 'profile',
      channels: []
    });
    const recommendation = recommendCampaignObjective(adapted.recommendationInput);

    return new Response(JSON.stringify({
      adapterStatus: adapted.status,
      recommendationStatus: recommendation.status
    }), {
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }
};
