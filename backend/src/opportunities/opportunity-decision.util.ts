import type { Opportunity } from '../seed/mock-data';
import type { OpportunityDecision } from '../decision-engine/decision-engine.types';

export function decisionToRecommendation(
  decision: Pick<OpportunityDecision, 'prediction' | 'confidenceGoPct'>,
): Opportunity['recommendation'] {
  if (decision.prediction === 1) {
    return decision.confidenceGoPct >= 70 ? 'soumission' : 'groupement';
  }
  return 'non_recommande';
}

export function decisionToScore(
  decision: Pick<OpportunityDecision, 'prediction' | 'confidenceGoPct'>,
): number {
  if (decision.prediction === 1) {
    return Math.round(Math.max(50, Math.min(99, decision.confidenceGoPct)));
  }
  return Math.round(Math.max(10, Math.min(49, 100 - decision.confidenceGoPct)));
}

export function getDecisionFromEnrichment(
  enrichment: Record<string, unknown> | null | undefined,
): OpportunityDecision | null {
  const d = enrichment?.decision;
  if (!d || typeof d !== 'object') return null;
  return d as OpportunityDecision;
}

export function applyDecisionToPublicOpportunity(o: Opportunity): Opportunity {
  const decision = getDecisionFromEnrichment(o.enrichment as Record<string, unknown>);
  if (!decision) return o;

  return {
    ...o,
    score: decisionToScore(decision),
    recommendation: decisionToRecommendation(decision),
    decisionVerdict: decision.prediction === 1 ? 'go' : 'no_go',
    decisionConfidence: decision.confidenceGoPct,
    decisionScoredAt: decision.scoredAt,
    decisionFeatures: decision.features,
    decisionVerdictLabel: decision.verdict,
    shapContributions: decision.shapContributions ?? undefined,
    qualitativeAnalysis: decision.qualitative ?? null,
    eligibility: decision.eligibility ?? null,
    mcda: decision.mcda ?? null,
    recommendedExperts: decision.recommendedExperts ?? null,
    recommendedPartners: decision.recommendedPartners ?? null,
  };
}
