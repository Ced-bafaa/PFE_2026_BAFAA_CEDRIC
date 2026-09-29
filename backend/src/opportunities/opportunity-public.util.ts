import type { Opportunity } from '../seed/mock-data';
import { attachExtractedDetails } from './opportunity-extracted-details.util';
import { applyDecisionToPublicOpportunity } from './opportunity-decision.util';

/**
 * Réponse API : objet plain JSON (pas de méthodes / références circulaires).
 * Champs alignés sur le type `Opportunity` attendu par le front.
 */
export function toPublicOpportunity(o: Opportunity): Opportunity {
  const out: Opportunity = {
    id: o.id,
    title: o.title,
    source: o.source,
    publishedAt: o.publishedAt,
    ...(o.scrapedAt ? { scrapedAt: o.scrapedAt } : {}),
    deadline: o.deadline,
    budget: o.budget,
    location: o.location,
    domain: o.domain,
    score: o.score,
    recommendation: o.recommendation,
    status: o.status,
    description: o.description,
  };
  if (o.stableId != null && o.stableId !== '') {
    out.stableId = o.stableId;
  }
  if (o.scope != null) {
    out.scope = o.scope;
  }
  if (o.justificatifFileName !== undefined) {
    out.justificatifFileName = o.justificatifFileName;
  }
  if (o.internalFileId != null && o.internalFileId !== '') {
    out.internalFileId = o.internalFileId;
  }
  if (o.decisionVerdict != null) {
    out.decisionVerdict = o.decisionVerdict;
  }
  if (o.decisionConfidence != null) {
    out.decisionConfidence = o.decisionConfidence;
  }
  if (o.decisionScoredAt != null) {
    out.decisionScoredAt = o.decisionScoredAt;
  }
  // NB : les champs financiers (decisionFeatures) et SHAP (shapContributions)
  // sont des vestiges de l'ancien modèle XGBoost — le moteur de décision est
  // désormais le MCDA. Ils ne sont plus exposés au front.
  if (o.extractedDetails != null) {
    out.extractedDetails = o.extractedDetails;
  }
  if (o.eligibility !== undefined) {
    out.eligibility = o.eligibility;
  }
  if (o.qualitativeAnalysis !== undefined) {
    out.qualitativeAnalysis = o.qualitativeAnalysis;
  }
  // Scoring MCDA (5 critères + poids AHP) et personnel recommandé : LE cœur
  // décisionnel, désormais transmis au front (transparence de la décision).
  if (o.mcda != null) {
    out.mcda = o.mcda;
  }
  if (o.recommendedExperts != null) {
    out.recommendedExperts = o.recommendedExperts;
  }
  if (o.recommendedPartners != null) {
    out.recommendedPartners = o.recommendedPartners;
  }
  return out;
}

/** Réponse détail : champs publics + blocs extraction PDF (sans `enrichment` brut). */
export function toPublicOpportunityDetail(o: Opportunity): Opportunity {
  const withML = applyDecisionToPublicOpportunity(o);
  return toPublicOpportunity(attachExtractedDetails(withML));
}

export function toPublicOpportunityList(items: Opportunity[]): Opportunity[] {
  return items.map((o) => toPublicOpportunity(o));
}

/** Déduplication globale (multi-sources) sur stableId, sinon id. */
export function dedupeOpportunitiesByStableKey(
  opportunities: Opportunity[],
): Opportunity[] {
  const m = new Map<string, Opportunity>();
  for (const o of opportunities) {
    const key = (o.stableId ?? o.id).toLowerCase();
    const ex = m.get(key);
    if (
      !ex ||
      (o.description?.length ?? 0) > (ex.description?.length ?? 0)
    ) {
      m.set(key, o);
    }
  }
  return [...m.values()];
}
