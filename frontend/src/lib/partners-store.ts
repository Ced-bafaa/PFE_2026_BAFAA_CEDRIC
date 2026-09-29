import type { Partner } from "@/lib/types";
import { EMPTY_PROFILE, type CompanyProfile } from "@/pages/settings/company/types";
import { apiJson, pushToServer } from "@/lib/api";

/**
 * Un partenaire partage désormais le MÊME modèle que l'entreprise
 * (CompanyProfile + id). Cela permet de le scorer et de recommander un
 * groupement de façon symétrique au personnel.
 */

const PARTNERS_STORAGE_KEY = "partners_data";

/** Le payload envoyé au backend = le profil complet (les champs inconnus sont ignorés côté DTO). */
function toPartnerPayload(p: Partner): Record<string, unknown> {
  return { ...p };
}

function splitList(s: unknown): string[] {
  if (typeof s !== "string") return [];
  return s
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Migre un ancien partenaire « plat » (companyName/coreDomains/…) vers le profil riche. */
function migrateLegacyPartner(item: Record<string, unknown>): Partner {
  const domaines = splitList(item["coreDomains"]);
  const strengths = [
    typeof item["strengths"] === "string" ? item["strengths"] : "",
    typeof item["references"] === "string" && item["references"].trim() && item["references"] !== "—"
      ? `Références : ${item["references"]}`
      : "",
  ]
    .filter(Boolean)
    .join(" — ");
  return {
    ...EMPTY_PROFILE,
    id: String(item["id"]),
    company_name: typeof item["companyName"] === "string" ? item["companyName"] : "",
    legal_form: typeof item["legalForm"] === "string" ? item["legalForm"] : "",
    country: typeof item["country"] === "string" ? item["country"] : "Cameroun",
    city: typeof item["city"] === "string" ? item["city"] : "",
    years_experience: typeof item["yearsExperience"] === "string" ? item["yearsExperience"] : "",
    financial_capacity_notes:
      typeof item["annualCapacity"] === "string" && item["annualCapacity"] !== "—"
        ? item["annualCapacity"]
        : "",
    domaines,
    domains_catalog: domaines,
    technical_qualifications:
      typeof item["certifications"] === "string" && item["certifications"] !== "—"
        ? item["certifications"]
        : "",
    strengths,
  };
}

function sanitizePartner(input: unknown): Partner | null {
  if (!input || typeof input !== "object") return null;
  const item = input as Record<string, unknown>;
  if (typeof item["id"] !== "string") return null;

  // Ancien format plat → migration vers le profil riche.
  if (typeof item["companyName"] === "string" && typeof item["company_name"] !== "string") {
    return migrateLegacyPartner(item);
  }

  // Format profil : on complète avec les valeurs par défaut.
  return { ...EMPTY_PROFILE, ...(item as Partial<CompanyProfile>), id: item["id"] } as Partner;
}

/** Partenaires de démonstration (graine initiale, profils enrichis pour la reco). */
const seedPartners: Partner[] = [
  {
    ...EMPTY_PROFILE,
    id: "P-001",
    company_name: "TechAfrique Solutions",
    legal_form: "SARL",
    country: "Cameroun",
    city: "Douala",
    years_experience: "8 ans en systèmes d'information",
    domaines: ["Systèmes d'information", "Cloud"],
    domains_catalog: ["Systèmes d'information", "Cloud"],
    technologies_catalog: ["docker", "kubernetes", "aws", "erp"],
    competencies: [
      { domain: "Systèmes d'information", keywords: ["erp", "intégration", "déploiement"], level: "expert" },
      { domain: "Cloud", keywords: ["aws", "docker", "kubernetes"], level: "senior" },
    ],
    strengths: "Déploiement, exploitation, support d'infrastructures critiques.",
  },
  {
    ...EMPTY_PROFILE,
    id: "P-002",
    company_name: "CyberShield",
    legal_form: "SARL",
    country: "Cameroun",
    city: "Yaoundé",
    years_experience: "5 ans en cybersécurité",
    domaines: ["Cybersécurité", "Audit IT"],
    domains_catalog: ["Cybersécurité", "Audit IT"],
    technologies_catalog: ["siem", "soc", "pentest"],
    certifications: [{ name: "ISO 27001", issuer: "—", year: "en cours" }],
    competencies: [
      { domain: "Cybersécurité", keywords: ["soc", "siem", "pentest", "iso 27001", "gouvernance ssi"], level: "expert" },
    ],
    strengths: "SOC, audit de sécurité, gouvernance SSI.",
  },
  {
    ...EMPTY_PROFILE,
    id: "P-003",
    company_name: "NetConnect Africa",
    legal_form: "SA",
    country: "Cameroun",
    city: "Douala",
    years_experience: "3 ans en télécommunications",
    domaines: ["Télécommunications", "Réseaux"],
    domains_catalog: ["Télécommunications", "Réseaux"],
    technologies_catalog: ["fibre optique", "routage", "lan", "wan"],
    competencies: [
      { domain: "Réseaux & télécoms", keywords: ["fibre optique", "lan", "wan", "routage", "maintenance"], level: "senior" },
    ],
    strengths: "Réseaux, déploiement fibre, maintenance.",
  },
  {
    ...EMPTY_PROFILE,
    id: "P-004",
    company_name: "DataVision Consulting",
    legal_form: "SARL",
    country: "Cameroun",
    city: "Yaoundé",
    years_experience: "6 ans en data & BI",
    domaines: ["Data Analytics", "BI", "Intelligence artificielle"],
    domains_catalog: ["Data Analytics", "BI", "Intelligence artificielle"],
    technologies_catalog: ["python", "etl", "bi", "machine learning"],
    competencies: [
      { domain: "Data & BI", keywords: ["etl", "bi", "machine learning", "python", "dataviz"], level: "senior" },
    ],
    strengths: "ETL, décisionnel, modèles d'IA.",
  },
];

export function getPartners(): Partner[] {
  try {
    const raw = localStorage.getItem(PARTNERS_STORAGE_KEY);
    if (!raw) return seedPartners;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return seedPartners;
    const normalized = parsed.map(sanitizePartner).filter((p): p is Partner => Boolean(p));
    if (normalized.length === 0) return seedPartners;
    // Persiste la normalisation silencieuse (migration).
    if (JSON.stringify(normalized) !== raw) {
      localStorage.setItem(PARTNERS_STORAGE_KEY, JSON.stringify(normalized));
    }
    return normalized;
  } catch {
    return seedPartners;
  }
}

export function savePartners(next: Partner[]) {
  const prev = getPartners();
  localStorage.setItem(PARTNERS_STORAGE_KEY, JSON.stringify(next));

  // Réplication serveur : diff par id (création / mise à jour / suppression).
  const prevById = new Map(prev.map((p) => [p.id, p]));
  const nextIds = new Set(next.map((p) => p.id));
  for (const p of next) {
    const before = prevById.get(p.id);
    if (!before) {
      pushToServer("/partners", { method: "POST", body: JSON.stringify(toPartnerPayload(p)) });
    } else if (JSON.stringify(before) !== JSON.stringify(p)) {
      pushToServer(`/partners/${encodeURIComponent(p.id)}`, { method: "PUT", body: JSON.stringify(toPartnerPayload(p)) });
    }
  }
  for (const p of prev) {
    if (!nextIds.has(p.id)) {
      pushToServer(`/partners/${encodeURIComponent(p.id)}`, { method: "DELETE" });
    }
  }
}

/** Hydratation au démarrage : le serveur fait foi, le cache local est remplacé. */
export async function hydratePartnersFromServer(): Promise<void> {
  const data = await apiJson<Partner[]>("/partners");
  if (Array.isArray(data)) {
    const normalized = data.map(sanitizePartner).filter((p): p is Partner => Boolean(p));
    localStorage.setItem(PARTNERS_STORAGE_KEY, JSON.stringify(normalized));
  }
}
