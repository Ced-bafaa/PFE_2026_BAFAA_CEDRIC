export type DecisionFeatures = {
  ratio_ca: number;
  ratio_credit: number;
  poids_caution: number;
  score_tech: number;
};

export type ShapContributions = {
  ratio_ca: number;
  ratio_credit: number;
  poids_caution: number;
  score_tech: number;
};

// ─── Analyse qualitative Groq ────────────────────────────────────────────────

export type CheckStatus = 'ok' | 'warning' | 'blocking';
export type CheckType   = 'certification' | 'personnel' | 'reference' | 'disqualification' | 'technique';

export type QualitativeCheck = {
  type: CheckType;
  label: string;
  status: CheckStatus;
  exigence: string;
  profil: string;
  detail: string;
};

export type QualitativeAnalysis = {
  checks: QualitativeCheck[];
  score_qualitatif: number;   // 0.0 – 1.0
  points_forts: string[];
  points_bloquants: string[];
  resume: string;
  ollama_available: boolean;
};

// ─── Fusion des scores ────────────────────────────────────────────────────────

export type ScoreFusion = {
  score_financier: number;    // XGBoost confidence / 100
  score_qualitatif: number;   // Groq score
  score_global: number;       // weighted average
  weights: { financial: number; qualitative: number };
  triggered_rules?: string[];
  justification_override: string | null;
};

// ─── Scoring MCDA (critères + poids AHP) et reco personnel ───────────────────

export type McdaCriterion = {
  valeur: number;        // valeur du critère, normalisée [0,1]
  poids: number;         // poids AHP
  detail?: string;       // explication (ex. cosinus)
  jours?: number | null; // pour le critère délai
};

export type McdaResult = {
  score: number;         // 0–100
  prediction: 0 | 1;
  verdict: string;
  recommandation: string; // soumettre | à étudier | écarter
  eligible: boolean;
  criteres: Record<string, McdaCriterion>;
};

export type RecommendedExpert = {
  name: string;
  role: string;
  fit: number;
  base: string;                  // semantique | recouvrement
  competences_match: string[];
  disponibilite?: string | null;
};

export type RecommendedPartner = {
  id: string;
  company_name?: string;
  fit: number;                   // score global (adéquation + complémentarité)
  adequation: number;            // adéquation à l'objet de l'AO
  base: string;                  // semantique | recouvrement
  comble: string[];              // lacunes de l'entreprise comblées par ce partenaire
  domaines_match: string[];      // domaines du partenaire évoqués par l'AO
};

// ─── Résultat complet /predict ────────────────────────────────────────────────

export type DecisionEnginePredictResult = {
  ref_dao: string;
  budget_fcfa: number;
  caution_fcfa: number;
  features: DecisionFeatures;
  rule_label: number;

  /** Score XGBoost brut */
  prediction: 0 | 1;
  confidence_go_pct: number;
  shap_contributions: ShapContributions | null;

  /** Analyse qualitative Groq (null si skip_qualitative=true) */
  qualitative: QualitativeAnalysis | null;

  /** Fusion financier + qualitatif */
  fusion: ScoreFusion | null;

  /** Conformité : critères éliminatoires (financiers + personnel) évalués par le decision engine */
  eligibility?: EligibilityResult | null;

  /** Verdict final (après fusion + forçage NO-GO si blocking) */
  verdict: string;
  prediction_final: 0 | 1;

  /** Scoring MCDA (critères + poids AHP) */
  mcda?: McdaResult | null;
  /** Recommandation de personnel (experts les plus adéquats à l'objet de l'AO) */
  recommended_experts?: RecommendedExpert[] | null;
  /** Recommandation de partenaires pour un groupement (par complémentarité) */
  recommended_partners?: RecommendedPartner[] | null;
};

// ─── Conformité (critères éliminatoires) ────────────────────────────────────

export type EligibilityCriterion = {
  id: string;
  categorie: 'financier' | 'personnel';
  libelle: string;
  exigence: string | number;
  capacite: string | number;
  satisfait: boolean;
  detail?: string;
};

export type PersonnelQualification = {
  applicable: boolean;
  required_count: number;
  covered_count: number;
  coverage: number | null;
  roles: Array<{
    poste: string;
    exigences: Record<string, unknown>;
    covered: boolean;
    qualified_experts: string[];
    candidates: Array<{ name: string; qualified: boolean; missing: string[] }>;
  }>;
};

export type EligibilityResult = {
  applicable: boolean;
  eligible: boolean | null;
  criteres: EligibilityCriterion[];
  non_satisfaits: string[];
  personnel: PersonnelQualification;
};

// ─── OpportunityDecision (stocké en base) ────────────────────────────────────

export type OpportunityDecision = {
  verdict: string;
  prediction: 0 | 1;
  prediction_final: 0 | 1;
  confidenceGoPct: number;
  scoreGlobal?: number;
  features: DecisionFeatures;
  shapContributions?: ShapContributions | null;
  qualitative?: QualitativeAnalysis | null;
  fusion?: ScoreFusion | null;
  eligibility?: EligibilityResult | null;
  budgetFcfa: number;
  cautionFcfa: number;
  ruleLabel: number;
  scoredAt: string;
  nomFichier?: string;
  /** Méthode de rattachement PDF→opportunité : filename | id | stableId | fuzzy(x.xx) | direct */
  matchedBy?: string;
  /** Scoring MCDA (critères + poids AHP) — transparence */
  mcda?: McdaResult | null;
  /** Recommandation de personnel par adéquation à l'objet de l'AO */
  recommendedExperts?: RecommendedExpert[] | null;
  /** Recommandation de partenaires pour un groupement (complémentarité aux lacunes) */
  recommendedPartners?: RecommendedPartner[] | null;
};
