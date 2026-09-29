import type { Opportunity } from "@/lib/types";

/** Score Strategic Compass disponible (extraction + scoring terminés). */
export function hasDecisionScore(
  opp: Pick<Opportunity, "decisionVerdict" | "decisionScoredAt">,
): boolean {
  if (opp.decisionVerdict === "go" || opp.decisionVerdict === "no_go") {
    return true;
  }
  return Boolean(opp.decisionScoredAt);
}

export function effectiveDisplayScore(
  opp: Pick<Opportunity, "score" | "decisionVerdict" | "decisionConfidence">,
): number | null {
  if (!hasDecisionScore(opp)) return null;
  return typeof opp.score === "number" ? opp.score : null;
}

// ─── Bandes de score : SOURCE UNIQUE des seuils (alignés sur le MCDA :
//     GO ≥ 70, À ÉTUDIER ≥ 50). Tout affichage/filtre par score passe par ici
//     pour éviter les seuils dupliqués (badge, filtres Opportunités/Pertinent). ──
export const SCORE_HIGH = 70;
export const SCORE_MEDIUM = 50;

export type ScoreBand = "high" | "medium" | "low";

export function scoreBand(score: number): ScoreBand {
  if (score >= SCORE_HIGH) return "high";
  if (score >= SCORE_MEDIUM) return "medium";
  return "low";
}

export const SCORE_BAND_LABEL: Record<ScoreBand, string> = {
  high: "Élevé",
  medium: "Moyen",
  low: "Faible",
};

// ─── Types du pipeline de décision (miroir du backend) ────────────────────────

export type QualitativeCheck = {
  type: string;
  label: string;
  status: "ok" | "warning" | "blocking";
  exigence: string;
  profil: string;
  detail: string;
};

export type QualitativeAnalysis = {
  checks: QualitativeCheck[];
  score_qualitatif: number;
  points_forts: string[];
  points_bloquants: string[];
  resume: string;
  ollama_available: boolean;
};

// ─── Conformité : critères éliminatoires (financiers + personnel) ─────────────

export type EligibilityCriterion = {
  id: string;
  categorie: "financier" | "personnel";
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

// ─── Scoring MCDA (critères C1–C5, valeurs + poids AHP) ───────────────────────

export type McdaCriterion = {
  valeur: number;
  poids: number;
  detail?: string;
  jours?: number | null;
};

export type McdaResult = {
  score: number;
  prediction?: number;
  verdict: string;
  recommandation: string;
  eligible?: boolean;
  criteres: Record<string, McdaCriterion>;
};

// ─── Recommandation de personnel (adéquation à l'objet de l'AO) ───────────────

export type RecommendedExpert = {
  name: string;
  role?: string;
  fit: number;
  fit_brut?: number;
  base?: string;
  competences_match?: string[];
  disponibilite?: string | null;
};

// ─── Recommandation de partenaires (groupement, par complémentarité) ─────────

export type RecommendedPartner = {
  id: string;
  company_name?: string;
  fit: number;            // score global (adéquation + complémentarité)
  adequation?: number;    // adéquation à l'objet de l'AO
  base?: string;
  comble?: string[];      // lacunes de l'entreprise comblées par ce partenaire
  domaines_match?: string[];
};
