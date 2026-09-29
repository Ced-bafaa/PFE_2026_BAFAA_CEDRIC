/**
 * Profil entreprise stocké en local (Paramètres → Entreprise).
 * Champs calibrés pour le scoring / éligibilité face aux infos extraites des DAO
 * (critères techniques, financiers, références, agréments, zones…).
 */
export type CompanyProfile = {
  companyName: string;
  legalForm: string;
  country: string;
  city: string;
  /** RCCM, NIU, autres numéros d'immatriculation utiles aux dossiers administratifs */
  registrationIds: string;
  /** Ancienneté globale sur les métiers concernés */
  yearsExperience: string;
  /** Chiffre d'affaires ou volumes indicatifs (alignement critères financiers DAO) */
  annualCapacity: string;
  /** Effectifs permanents ou équivalent temps plein */
  staffHeadcount: string;
  /** Domaines d'activité / métiers */
  coreDomains: string;
  /** Mots-clés métiers, familles d'objets, codes CPV ou secteurs visés */
  sectorKeywords: string;
  certifications: string;
  /** Agréments techniques, qualifications réglementaires (BTP, santé, etc.) */
  technicalQualifications: string;
  references: string;
  /** Marchés publics similaires : objet, montant, maître d'ouvrage, année */
  similarPublicContracts: string;
  /** Moyens matériels et équipements majeurs */
  equipmentMajorAssets: string;
  /** Bilan, fonds propres, capacité de cautionnement ou avance */
  financialCapacityNotes: string;
  /** Assurances RC professionnelle, décennale, etc. */
  insuranceCoverage: string;
  /** Fiscalité, CNPS / cotisations sociales, régularité */
  fiscalSocialCompliance: string;
  /** Régions / pays où l'entreprise exécute habituellement */
  interventionZones: string;
  /** Chef de file ou membre de groupement sur marchés passés */
  consortiumExperience: string;
  /** Sous-traitance, mobilisation de co-traitants */
  partnershipCapacity: string;
  languages: string;
  strengths: string;
};

export const DEFAULT_COMPANY_PROFILE: CompanyProfile = {
  companyName: "",
  legalForm: "",
  country: "Cameroun",
  city: "",
  registrationIds: "",
  yearsExperience: "",
  annualCapacity: "",
  staffHeadcount: "",
  coreDomains: "",
  sectorKeywords: "",
  certifications: "",
  technicalQualifications: "",
  references: "",
  similarPublicContracts: "",
  equipmentMajorAssets: "",
  financialCapacityNotes: "",
  insuranceCoverage: "",
  fiscalSocialCompliance: "",
  interventionZones: "",
  consortiumExperience: "",
  partnershipCapacity: "",
  languages: "",
  strengths: "",
};

export const COMPANY_PROFILE_KEY = "company_profile";

export function mergeCompanyProfile(
  partial: Partial<CompanyProfile> | Record<string, unknown> | null | undefined,
): CompanyProfile {
  const base = { ...DEFAULT_COMPANY_PROFILE };
  if (!partial || typeof partial !== "object") return base;
  const out = { ...base };
  for (const key of Object.keys(base) as (keyof CompanyProfile)[]) {
    const v = partial[key as string];
    if (typeof v === "string") out[key] = v;
  }
  return out;
}

export type CompanyProfileFieldMeta = {
  key: keyof CompanyProfile;
  label: string;
  multiline?: boolean;
  placeholder: string;
};

export type CompanyProfileSectionMeta = {
  title: string;
  description?: string;
  fields: CompanyProfileFieldMeta[];
};

/** Métadonnées UI : ordre et libellés pour formulaire et résumé */
export const COMPANY_PROFILE_SECTIONS: readonly CompanyProfileSectionMeta[] = [
  {
    title: "Identité et immatriculation",
    description:
      "Aligné avec les dossiers administratifs des DAO (identification du candidat).",
    fields: [
      {
        key: "companyName",
        label: "Raison sociale",
        placeholder: "Ex. KIAMA Technologies SARL",
      },
      {
        key: "legalForm",
        label: "Forme juridique",
        placeholder: "SARL, SA, GIE…",
      },
      { key: "country", label: "Pays", placeholder: "Cameroun" },
      { key: "city", label: "Ville / siège", placeholder: "Douala" },
      {
        key: "registrationIds",
        label: "RCCM, NIU et autres numéros",
        placeholder: "RCCM CM-DLA-… ; NIU M…",
      },
    ],
  },
  {
    title: "Capacité technique et expérience",
    description:
      "Répond aux critères « capacité technique » et « marchés similaires » fréquents dans les RC.",
    fields: [
      {
        key: "yearsExperience",
        label: "Années d'expérience (domaines visés)",
        placeholder: "Ex. 10 ans en systèmes d'information",
      },
      {
        key: "staffHeadcount",
        label: "Effectifs (permanent ou équivalent temps plein)",
        placeholder: "Ex. 25 dont 8 ingénieurs",
      },
      {
        key: "coreDomains",
        label: "Domaines d'intervention",
        multiline: true,
        placeholder:
          "Ex. développement logiciel, intégration SI, cybersécurité, réseaux…",
      },
      {
        key: "sectorKeywords",
        label: "Mots-clés / familles d'objets (scoring textuel)",
        multiline: true,
        placeholder:
          "Termes pour rapprocher l'objet du marché : maintenance, ERP, datacenter, fibre…",
      },
      {
        key: "equipmentMajorAssets",
        label: "Moyens matériels et équipements majeurs",
        multiline: true,
        placeholder: "Labs, véhicules, licences logicielles critiques…",
      },
      {
        key: "references",
        label: "Références clients / projets",
        multiline: true,
        placeholder: "Clients, secteurs, périmètre (sans obligation marchés publics)",
      },
      {
        key: "similarPublicContracts",
        label: "Marchés publics similaires",
        multiline: true,
        placeholder:
          "Objet, montant indicatif, année, maître d'ouvrage — comme demandé dans les DAO",
      },
    ],
  },
  {
    title: "Capacité financière et assurances",
    description:
      "Pour croiser budget de l'AO, cautions, avances et clauses financières.",
    fields: [
      {
        key: "annualCapacity",
        label: "Chiffre d'affaires ou volume annuel indicatif",
        placeholder: "Ex. 500 M FCFA / an",
      },
      {
        key: "financialCapacityNotes",
        label: "Capacité financière (bilan, fonds propres, cautions)",
        multiline: true,
        placeholder: "Décrit la capacité à couvrir cautions, avances, trésorerie",
      },
      {
        key: "insuranceCoverage",
        label: "Assurances",
        multiline: true,
        placeholder: "RC professionnelle, décennale, montants plafonds si connus",
      },
    ],
  },
  {
    title: "Agréments, certifications et conformité",
    description:
      "Pour les éliminatoires « agrément », ISO, régularité fiscale et sociale.",
    fields: [
      {
        key: "certifications",
        label: "Certifications (ISO, labels)",
        multiline: true,
        placeholder: "ISO 9001, 27001, CMMI…",
      },
      {
        key: "technicalQualifications",
        label: "Agréments techniques / qualifications réglementaires",
        multiline: true,
        placeholder: "Agrément catégorie X, habilitation secteur public…",
      },
      {
        key: "fiscalSocialCompliance",
        label: "Conformité fiscale et sociale",
        multiline: true,
        placeholder: "À jour des impôts, CNPS, attestations courantes",
      },
    ],
  },
  {
    title: "Zones géographiques et coopération",
    description:
      "Lieu d'exécution de l'AO, groupements et sous-traitance.",
    fields: [
      {
        key: "interventionZones",
        label: "Zones d'intervention habituelles",
        multiline: true,
        placeholder: "Régions, pays où vous déployez des équipes",
      },
      {
        key: "consortiumExperience",
        label: "Expérience en groupement",
        multiline: true,
        placeholder: "Chef de file ou membre sur quels types de marchés",
      },
      {
        key: "partnershipCapacity",
        label: "Sous-traitance et co-traitants",
        multiline: true,
        placeholder: "Capacité à mobiliser des partenaires pour répondre à l'AO",
      },
      {
        key: "languages",
        label: "Langues de travail",
        placeholder: "Français, anglais…",
      },
    ],
  },
  {
    title: "Synthèse",
    fields: [
      {
        key: "strengths",
        label: "Atouts pour la réponse (résumé)",
        multiline: true,
        placeholder: "Points forts distinctifs pour le scoring et la décision interne",
      },
    ],
  },
];
