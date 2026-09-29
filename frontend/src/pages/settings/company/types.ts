/**
 * Types et constantes du profil entreprise (Paramètres > Entreprise).
 * Référencés par la page, ses modules et la page de détail du personnel.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type Certification = {
  name: string;
  issuer?: string;
  year?: string;
  valid_until?: string;
  scope?: string;
};

export type Competency = {
  domain: string;
  keywords: string[];
  level?: string;
};

export type PersonnelDiploma = {
  degree: string;   // "Master", "Licence", "Ingénieur"
  field: string;    // "Informatique", "Cybersécurité"
  years_experience?: number; // années d'expérience dans ce domaine
  /** Scan du diplôme téléversé (PDF/image). */
  file?: { filename: string; originalname: string };
};

export type Personnel = {
  name: string;
  role: string;
  certifications?: string[];
  years_experience?: number;
  skills?: string[];
  education?: string;           // champ legacy, conservé pour compatibilité
  diplomas?: PersonnelDiploma[]; // diplômes structurés avec expérience par niveau
  location?: string;
  availability?: string;         // "Disponible" | "Occupé jusqu'au JJ/MM/AAAA"
  daily_rate_fcfa?: number;      // TJM en FCFA
  projects_count?: number;       // nombre de projets réalisés
  success_rate?: number;         // taux de réussite 0-100
  cv_files?: PersonnelCv[];      // jusqu'à 3 CVs
};

export type PersonnelCv = {
  filename: string;       // nom généré côté serveur
  originalname: string;   // nom original du fichier
  uploaded_at?: string;   // ISO date
};

/** Avancement d'un projet de référence. */
export type ProjectStatus = "en_cours" | "acheve";

export type PastProject = {
  title: string;
  client?: string;
  year?: string;
  budget_fcfa?: number;       // conservé pour compat données existantes
  domains?: string[];
  technologies?: string[];
  description?: string;
  personnel_names?: string[]; // experts rattachés à ce projet
  /** Avancement : « en cours » ou « achevé » (défaut : achevé pour les données existantes). */
  status?: ProjectStatus;
};

export type CompanyProfile = {
  company_name?: string;
  legal_form?: string;
  country?: string;
  city?: string;
  registration_ids?: string;
  annual_revenue?: number;
  available_cash?: number;
  credit_line?: number;
  description?: string;
  domaines?: string[];
  /** Référentiel central des technologies et domaines sélectionnables partout. */
  technologies_catalog?: string[];
  domains_catalog?: string[];
  certifications?: Certification[];
  competencies?: Competency[];
  personnel?: Personnel[];
  past_projects?: PastProject[];
  intervention_zones?: string;
  consortium_experience?: string;
  partnership_capacity?: string;
  languages?: string;
  years_experience?: string;
  staff_headcount?: string;
  fiscal_social_compliance?: string;
  insurance_coverage?: string;
  financial_capacity_notes?: string;
  equipment_major_assets?: string;
  technical_qualifications?: string;
  strengths?: string;
};

export const EMPTY_PROFILE: CompanyProfile = {
  company_name: "",
  legal_form: "",
  country: "Cameroun",
  city: "",
  registration_ids: "",
  annual_revenue: 0,
  available_cash: 0,
  credit_line: 0,
  description: "",
  domaines: [],
  technologies_catalog: [],
  domains_catalog: [],
  certifications: [],
  competencies: [],
  personnel: [],
  past_projects: [],
  intervention_zones: "",
  consortium_experience: "",
  partnership_capacity: "",
  languages: "Français, Anglais",
  years_experience: "",
  staff_headcount: "",
  fiscal_social_compliance: "",
  insurance_coverage: "",
  financial_capacity_notes: "",
  equipment_major_assets: "",
  technical_qualifications: "",
  strengths: "",
};

export const LEVEL_LABELS: Record<string, string> = {
  expert: "Expert",
  senior: "Senior",
  intermediaire: "Intermédiaire",
  debutant: "Débutant",
};

export const LEVEL_COLORS: Record<string, string> = {
  expert: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  senior: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  intermediaire: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  debutant: "bg-muted text-muted-foreground",
};

export const fmtFcfa = (n?: number) =>
  n ? new Intl.NumberFormat("fr-FR").format(n) + " FCFA" : "—";

// ─── Statut d'un projet (en cours / achevé) ────────────────────────────────────

/** Normalise le statut : absent/inconnu ⇒ « achevé » (projets de référence historiques). */
export function projectStatusOf(p: { status?: string }): ProjectStatus {
  return p?.status === "en_cours" ? "en_cours" : "acheve";
}

export const PROJECT_STATUS_META: Record<
  ProjectStatus,
  { label: string; badge: string; dot: string }
> = {
  en_cours: {
    label: "En cours",
    badge: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    dot: "bg-blue-500 animate-pulse",
  },
  acheve: {
    label: "Achevé",
    badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
};
