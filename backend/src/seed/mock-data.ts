import type { OpportunityExtractedDetailsDto } from '../opportunities/opportunity-extracted-details.types';
import type { EligibilityResult, QualitativeAnalysis, McdaResult, RecommendedExpert, RecommendedPartner } from '../decision-engine/decision-engine.types';

export type Opportunity = {
  id: string;
  /**
   * Identifiant stable transverse (dédoublonnage multi-sources).
   * N'affecte pas l'identifiant primaire `id` stocké en base.
   */
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
  /** Portée du marché (heuristique). */
  scope?: 'National' | 'International';
  score: number;
  recommendation: 'soumission' | 'groupement' | 'non_recommande';
  status: 'nouveau' | 'en_analyse' | 'qualifie' | 'soumis' | 'gagne' | 'perdu';
  description: string;
  /** Nom du fichier PDF joint à la soumission (si présent). */
  justificatifFileName?: string | null;

  /**
   * Identifiant interne du PDF téléchargé (UUID).
   * Permet la traçabilité front → fichier stocké dans `ao_extractor/data/`.
   */
  internalFileId?: string;

  /**
   * Enrichissement (pipeline Python) : champs structurés extraits du PDF.
   * Stockage souple pour itérer vite.
   */
  enrichment?: Record<string, any>;

  /** Verdict Strategic Compass (après extraction PDF). */
  decisionVerdict?: 'go' | 'no_go';
  decisionConfidence?: number;
  decisionScoredAt?: string;
  decisionVerdictLabel?: string;
  decisionFeatures?: {
    ratio_ca: number;
    ratio_credit: number;
    poids_caution: number;
    score_tech: number;
  };

  /** Contributions SHAP (TreeSHAP) par feature pour la classe GO. */
  shapContributions?: {
    ratio_ca: number;
    ratio_credit: number;
    poids_caution: number;
    score_tech: number;
  } | null;

  /** Analyse qualitative Groq (points forts/bloquants + résumé). Disponible après extraction PDF. */
  qualitativeAnalysis?: QualitativeAnalysis | null;

  /** Conformité aux critères éliminatoires du DAO (financiers + personnel). */
  eligibility?: EligibilityResult | null;

  /** Scoring MCDA : critères (C1–C5), valeurs et poids AHP (transparence). */
  mcda?: McdaResult | null;

  /** Recommandation de personnel : experts les plus adéquats à l'objet de l'AO. */
  recommendedExperts?: RecommendedExpert[] | null;
  /** Recommandation de partenaires pour un groupement (par complémentarité). */
  recommendedPartners?: RecommendedPartner[] | null;

  /** Détails DAO issus de l’extraction PDF (fiche détail uniquement). */
  extractedDetails?: OpportunityExtractedDetailsDto;
};

/**
 * Un partenaire partage le MÊME modèle que le profil entreprise (mêmes champs)
 * afin d'être scoré et recommandé pour un groupement de façon symétrique.
 * Typé souplement (index signature) : le backend stocke/retourne le profil JSON
 * tel quel, la validation stricte est portée par UpsertPartnerDto.
 */
export type Partner = {
  id: string;
  company_name?: string;
  legal_form?: string;
  country?: string;
  city?: string;
  years_experience?: string;
  domaines?: string[];
  competencies?: Array<{ domain: string; keywords: string[]; level?: string }>;
  strengths?: string;
  [key: string]: unknown;
};

/** Données de démonstration — insérées via POST /opportunities/seed-demo */
export const opportunitiesSeed: Opportunity[] = [
  {
    id: 'armp-aon-20260001',
    title: "Fourniture et déploiement d'un système de gestion intégré (ERP) au Ministère des Finances",
    source: 'armp.cm',
    publishedAt: '2026-05-10',
    deadline: '2026-06-25',
    budget: '185 000 000 FCFA',
    location: 'Yaoundé — Cameroun',
    domain: 'Systèmes d\'information',
    scope: 'National',
    score: 88,
    recommendation: 'soumission',
    status: 'qualifie',
    description: 'MO/AC : Ministère des Finances\nType : Appel d\'offres national ouvert\nRégion : Centre\nClôture : 25/06/2026\nFiche : https://www.armp.cm/details?type_publication=aon&id_publication=20260001\nPays : Cameroun',
  },
  {
    id: 'armp-aon-20260002',
    title: "Développement d'une plateforme e-gouvernement pour la dématérialisation des services publics — MINPOSTEL",
    source: 'armp.cm',
    publishedAt: '2026-05-12',
    deadline: '2026-06-30',
    budget: '320 000 000 FCFA',
    location: 'Yaoundé — Cameroun',
    domain: 'Transformation numérique',
    scope: 'National',
    score: 92,
    recommendation: 'soumission',
    status: 'qualifie',
    description: 'MO/AC : MINPOSTEL\nType : Appel d\'offres national ouvert\nRégion : Centre\nClôture : 30/06/2026\nFiche : https://www.armp.cm/details?type_publication=aon&id_publication=20260002\nPays : Cameroun',
  },
  {
    id: 'armp-aon-20260003',
    title: "Mise en place d'une infrastructure réseau et cybersécurité pour le CHU de Douala",
    source: 'armp.cm',
    publishedAt: '2026-05-14',
    deadline: '2026-06-20',
    budget: '95 000 000 FCFA',
    location: 'Douala — Cameroun',
    domain: 'Cybersécurité',
    scope: 'National',
    score: 79,
    recommendation: 'soumission',
    status: 'en_analyse',
    description: 'MO/AC : CHU de Douala\nType : Appel d\'offres ouvert\nRégion : Littoral\nClôture : 20/06/2026\nFiche : https://www.armp.cm/details?type_publication=aon&id_publication=20260003\nPays : Cameroun',
  },
  {
    id: 'armp-aon-20260004',
    title: "Acquisition et déploiement de solutions de cybersécurité pour la BEAC",
    source: 'armp.cm',
    publishedAt: '2026-05-08',
    deadline: '2026-06-15',
    budget: '275 000 000 FCFA',
    location: 'Yaoundé — Cameroun',
    domain: 'Cybersécurité',
    scope: 'National',
    score: 85,
    recommendation: 'soumission',
    status: 'qualifie',
    description: 'MO/AC : Banque des États de l\'Afrique Centrale\nType : Appel d\'offres international\nRégion : Centre\nClôture : 15/06/2026\nFiche : https://www.armp.cm/details?type_publication=aon&id_publication=20260004\nPays : Cameroun',
  },
  {
    id: 'armp-aon-20260005',
    title: "Développement d'une application mobile de collecte de données pour l'Institut National de la Statistique",
    source: 'armp.cm',
    publishedAt: '2026-05-18',
    deadline: '2026-07-05',
    budget: '45 000 000 FCFA',
    location: 'Yaoundé — Cameroun',
    domain: 'Applications mobiles',
    scope: 'National',
    score: 76,
    recommendation: 'soumission',
    status: 'nouveau',
    description: 'MO/AC : INS Cameroun\nType : Demande de cotation\nRégion : Centre\nClôture : 05/07/2026\nFiche : https://www.armp.cm/details?type_publication=dc&id_publication=20260005\nPays : Cameroun',
  },
  {
    id: 'armp-aon-20260006',
    title: "Fourniture de matériel informatique et logiciels bureautiques pour le MINESUP",
    source: 'armp.cm',
    publishedAt: '2026-05-20',
    deadline: '2026-06-28',
    budget: '62 000 000 FCFA',
    location: 'Yaoundé — Cameroun',
    domain: 'Infrastructure informatique',
    scope: 'National',
    score: 65,
    recommendation: 'groupement',
    status: 'nouveau',
    description: 'MO/AC : Ministère de l\'Enseignement Supérieur\nType : Appel d\'offres national ouvert\nRégion : Centre\nClôture : 28/06/2026\nFiche : https://www.armp.cm/details?type_publication=aon&id_publication=20260006\nPays : Cameroun',
  },
  {
    id: 'armp-aon-20260007',
    title: "Création et hébergement d'un portail web institutionnel — Mairie de Bafoussam",
    source: 'armp.cm',
    publishedAt: '2026-05-22',
    deadline: '2026-07-10',
    budget: '18 500 000 FCFA',
    location: 'Bafoussam — Cameroun',
    domain: 'Développement web',
    scope: 'National',
    score: 71,
    recommendation: 'soumission',
    status: 'nouveau',
    description: 'MO/AC : Communauté Urbaine de Bafoussam\nType : Demande de cotation\nRégion : Ouest\nClôture : 10/07/2026\nFiche : https://www.armp.cm/details?type_publication=dc&id_publication=20260007\nPays : Cameroun',
  },
  {
    id: 'armp-aon-20260008',
    title: "Déploiement d'un système de business intelligence et tableaux de bord — CAMTEL",
    source: 'armp.cm',
    publishedAt: '2026-05-05',
    deadline: '2026-06-12',
    budget: '148 000 000 FCFA',
    location: 'Yaoundé — Cameroun',
    domain: 'Big Data et Analytics',
    scope: 'National',
    score: 83,
    recommendation: 'soumission',
    status: 'en_analyse',
    description: 'MO/AC : CAMTEL\nType : Appel d\'offres national ouvert\nRégion : Centre\nClôture : 12/06/2026\nFiche : https://www.armp.cm/details?type_publication=aon&id_publication=20260008\nPays : Cameroun',
  },
  {
    id: 'armp-aon-20260009',
    title: "Audit et refonte du système d'information de la CNPS",
    source: 'armp.cm',
    publishedAt: '2026-05-16',
    deadline: '2026-07-01',
    budget: '210 000 000 FCFA',
    location: 'Douala — Cameroun',
    domain: 'Systèmes d\'information',
    scope: 'National',
    score: 90,
    recommendation: 'soumission',
    status: 'qualifie',
    description: 'MO/AC : Caisse Nationale de Prévoyance Sociale\nType : Appel d\'offres ouvert\nRégion : Littoral\nClôture : 01/07/2026\nFiche : https://www.armp.cm/details?type_publication=aon&id_publication=20260009\nPays : Cameroun',
  },
  {
    id: 'armp-aon-20260010',
    title: "Formation et certification des agents TIC du Ministère du Numérique — MINPOSTEL",
    source: 'armp.cm',
    publishedAt: '2026-05-25',
    deadline: '2026-07-15',
    budget: '28 000 000 FCFA',
    location: 'Yaoundé — Cameroun',
    domain: 'Formation TIC',
    scope: 'National',
    score: 68,
    recommendation: 'groupement',
    status: 'nouveau',
    description: 'MO/AC : MINPOSTEL\nType : Demande de cotation\nRégion : Centre\nClôture : 15/07/2026\nFiche : https://www.armp.cm/details?type_publication=dc&id_publication=20260010\nPays : Cameroun',
  },
  {
    id: 'armp-aon-20260011',
    title: "Développement d'un système de gestion des ressources humaines (SIRH) — MINFOPRA",
    source: 'armp.cm',
    publishedAt: '2026-05-28',
    deadline: '2026-07-20',
    budget: '135 000 000 FCFA',
    location: 'Yaoundé — Cameroun',
    domain: 'Systèmes d\'information',
    scope: 'National',
    score: 87,
    recommendation: 'soumission',
    status: 'nouveau',
    description: 'MO/AC : Ministère de la Fonction Publique\nType : Appel d\'offres national ouvert\nRégion : Centre\nClôture : 20/07/2026\nFiche : https://www.armp.cm/details?type_publication=aon&id_publication=20260011\nPays : Cameroun',
  },
  {
    id: 'armp-aon-20260012',
    title: "Numérisation et archivage électronique des actes d'état civil — BUNEC",
    source: 'armp.cm',
    publishedAt: '2026-05-02',
    deadline: '2026-06-10',
    budget: '78 000 000 FCFA',
    location: 'Yaoundé — Cameroun',
    domain: 'Transformation numérique',
    scope: 'National',
    score: 74,
    recommendation: 'soumission',
    status: 'soumis',
    description: 'MO/AC : Bureau National de l\'État Civil\nType : Appel d\'offres national ouvert\nRégion : Centre\nClôture : 10/06/2026\nFiche : https://www.armp.cm/details?type_publication=aon&id_publication=20260012\nPays : Cameroun',
  },
];

export const partnersSeed: Partner[] = [
  {
    id: 'P-001',
    company_name: 'CyberShield SARL',
    legal_form: 'SARL',
    country: 'Cameroun',
    city: 'Douala',
    years_experience: '8 ans en cybersécurité',
    domaines: ['Cybersécurité', 'Audit IT'],
    domains_catalog: ['Cybersécurité', 'Audit IT'],
    competencies: [
      { domain: 'Cybersécurité', keywords: ['soc', 'siem', 'pentest', 'iso 27001', 'audit'], level: 'expert' },
    ],
    financial_capacity_notes: '150 000 000 FCFA de capacité annuelle',
    strengths: 'Réactivité, expertise SOC.',
  },
];
