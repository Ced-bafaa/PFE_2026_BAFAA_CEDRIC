import type { OpportunityExtractedDetails } from "@/lib/extracted-details";
import type { EligibilityResult, QualitativeAnalysis, McdaResult, RecommendedExpert, RecommendedPartner } from "@/lib/opportunity-decision";
import type { CompanyProfile } from "@/pages/settings/company/types";

// Types métier partagés de l'application (anciennement `mock-data.ts`).
// Le catalogue réel provient de l'API (`fetchOpportunities()`), pas d'ici.

export type Opportunity = {
  id: string;
  /** Identifiant stable transverse (dédoublonnage multi-sources). */
  stableId?: string;
  /** Date ISO de dernier scraping (si connu). */
  scrapedAt?: string;
  title: string;
  source: string;
  publishedAt: string;
  deadline: string;
  budget: string;
  location: string;
  domain: string;
  scope?: "National" | "International";
  score: number;
  recommendation: "soumission" | "groupement" | "non_recommande";
  status: "nouveau" | "en_analyse" | "qualifie" | "soumis" | "gagne" | "perdu";
  description: string;
  /** Nom du fichier PDF justificatif de soumission (si présent). */
  justificatifFileName?: string | null;

  /** Strategic Compass — après extraction PDF + scoring décisionnel (MCDA). */
  decisionVerdict?: "go" | "no_go";
  decisionConfidence?: number;
  decisionScoredAt?: string;
  decisionVerdictLabel?: string;
  decisionFeatures?: {
    ratio_ca: number;
    ratio_credit: number;
    poids_caution: number;
    score_tech: number;
  };
  /** Déprécié : contributions SHAP (l'ancien XGBoost a été retiré du scoring ; toujours null). */
  shapContributions?: {
    ratio_ca: number;
    ratio_credit: number;
    poids_caution: number;
    score_tech: number;
  } | null;

  /** Analyse qualitative Groq : points forts/bloquants + résumé. Disponible après extraction PDF. */
  qualitativeAnalysis?: QualitativeAnalysis | null;

  /** Conformité aux critères éliminatoires du DAO (financiers + personnel). */
  eligibility?: EligibilityResult | null;

  /** Scoring MCDA : critères (C1–C5), valeurs et poids AHP (transparence). */
  mcda?: McdaResult | null;

  /** Recommandation de personnel : experts les plus adéquats à l'objet de l'AO. */
  recommendedExperts?: RecommendedExpert[] | null;
  /** Recommandation de partenaires pour un groupement (par complémentarité). */
  recommendedPartners?: RecommendedPartner[] | null;

  /** Extraction PDF (fiche détail — GET /opportunities/:id). */
  extractedDetails?: OpportunityExtractedDetails;
};

/**
 * Un partenaire est décrit EXACTEMENT comme l'entreprise (même profil riche),
 * afin de pouvoir le scorer et raisonner sur les groupements de façon symétrique.
 * Variante « groupement » : mêmes champs, sans les scans CV/diplômes (artefacts
 * RH internes non pertinents pour un partenaire).
 */
export type Partner = CompanyProfile & { id: string };
