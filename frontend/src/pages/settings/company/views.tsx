/**
 * Vues en lecture des rubriques + carte de rubrique repliable/éditable
 * (SectionCard) et cartographie des champs par rubrique (SECTION_FIELDS).
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Building2, CheckCircle2, MapPin, Star, Briefcase, GraduationCap,
  Pencil, Save, Loader2, ChevronDown, ChevronUp, Search, X,
} from "lucide-react";
import type { CompanyProfile } from "./types";
import { fmtFcfa, LEVEL_LABELS, PROJECT_STATUS_META, projectStatusOf } from "./types";
import { LEVEL_META, LEVEL_ORDER, domainIcon } from "./fields";
import { PersonnelCard } from "./personnel";

// ─── Vues par rubrique ────────────────────────────────────────────────────────

export function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

export function IdentityView({ profile }: { profile: CompanyProfile }) {
  const companyInitial = profile.company_name?.trim()[0]?.toUpperCase() ?? null;
  const hasFinance = !!(profile.annual_revenue || profile.available_cash || profile.credit_line);
  const isEmpty = !profile.company_name && !profile.description && !hasFinance;

  if (isEmpty) return <EmptyHint>Identité non renseignée. Cliquez sur Modifier pour compléter cette rubrique.</EmptyHint>;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          {companyInitial
            ? <span className="text-xl font-bold text-primary">{companyInitial}</span>
            : <Building2 className="h-7 w-7 text-primary" />}
        </div>
        <div className="flex-1 min-w-0 pt-0.5">
          <h3 className="font-semibold text-base leading-snug">
            {profile.company_name || "Entreprise non renseignée"}
          </h3>
          {[profile.legal_form, profile.city, profile.country].filter(Boolean).length > 0 && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {[profile.legal_form, profile.city, profile.country].filter(Boolean).join(" · ")}
            </p>
          )}
          {(profile.years_experience || profile.staff_headcount) && (
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {profile.years_experience && (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 border px-2.5 py-0.5 text-[11px] text-muted-foreground">
                  <Briefcase className="h-3 w-3 shrink-0" /> {profile.years_experience}
                </span>
              )}
              {profile.staff_headcount && (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 border px-2.5 py-0.5 text-[11px] text-muted-foreground">
                  {profile.staff_headcount}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {profile.description && (
        <p className="text-sm text-muted-foreground leading-relaxed border-t pt-4">
          {profile.description}
        </p>
      )}

      {profile.registration_ids && (
        <div className="flex items-start gap-3 border-t pt-4">
          <CheckCircle2 className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Immatriculation</p>
            <p className="text-sm font-medium mt-0.5 break-all">{profile.registration_ids}</p>
          </div>
        </div>
      )}

      {hasFinance && (
        <div className="border-t pt-4 space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Capacité financière</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {profile.annual_revenue ? (
              <div className="rounded-lg bg-muted/40 border-l-2 border-primary/50 pl-3 pr-3 py-2.5">
                <p className="text-xs text-muted-foreground mb-1">Chiffre d'affaires</p>
                <p className="font-bold text-sm">{fmtFcfa(profile.annual_revenue)}</p>
              </div>
            ) : null}
            {profile.available_cash ? (
              <div className="rounded-lg bg-muted/40 border-l-2 border-emerald-400/60 pl-3 pr-3 py-2.5">
                <p className="text-xs text-muted-foreground mb-1">Trésorerie</p>
                <p className="font-bold text-sm">{fmtFcfa(profile.available_cash)}</p>
              </div>
            ) : null}
            {profile.credit_line ? (
              <div className="rounded-lg bg-muted/40 border-l-2 border-blue-400/60 pl-3 pr-3 py-2.5">
                <p className="text-xs text-muted-foreground mb-1">Ligne de crédit</p>
                <p className="font-bold text-sm">{fmtFcfa(profile.credit_line)}</p>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

export function CertificationsView({ profile }: { profile: CompanyProfile }) {
  const certs = profile.certifications ?? [];
  if (certs.length === 0 && !profile.technical_qualifications) {
    return <EmptyHint>Aucune certification renseignée.</EmptyHint>;
  }
  return (
    <div className="space-y-4">
      {certs.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {certs.map((c, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border bg-muted/20 px-3 py-2.5">
              <div className="h-7 w-7 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium leading-snug truncate">{c.name}</div>
                {(c.issuer || c.year) && (
                  <div className="text-xs text-muted-foreground truncate">
                    {[c.issuer, c.year].filter(Boolean).join(" · ")}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {profile.technical_qualifications && (
        <div className={certs.length > 0 ? "border-t pt-4" : ""}>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1">Qualifications réglementaires</p>
          <p className="text-sm leading-relaxed text-foreground/80">{profile.technical_qualifications}</p>
        </div>
      )}
    </div>
  );
}


export function CompetenciesView({ profile }: { profile: CompanyProfile }) {
  const competencies = profile.competencies ?? [];
  if (competencies.length === 0) return <EmptyHint>Aucun domaine de compétence renseigné.</EmptyHint>;

  // Tri par niveau décroissant (expert d'abord)
  const sorted = [...competencies].sort(
    (a, b) => LEVEL_ORDER.indexOf(a.level ?? "debutant") - LEVEL_ORDER.indexOf(b.level ?? "debutant"),
  );
  const counts = LEVEL_ORDER
    .map((lvl) => ({ lvl, n: competencies.filter((c) => (c.level ?? "debutant") === lvl).length }))
    .filter((x) => x.n > 0);

  return (
    <div className="space-y-3">
      {/* Synthèse + légende des niveaux */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          {competencies.length} domaine{competencies.length > 1 ? "s" : ""} d'expertise
        </span>
        <span className="text-muted-foreground/40">·</span>
        {counts.map(({ lvl, n }) => (
          <span key={lvl} className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${LEVEL_META[lvl].bar}`} />
            {n} {LEVEL_META[lvl].label.toLowerCase()}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {sorted.map((c, i) => {
          const meta = LEVEL_META[c.level ?? "debutant"] ?? LEVEL_META.debutant;
          const keywords = c.keywords ?? [];
          return (
            <div key={i} className="rounded-xl border bg-card p-4 space-y-3 transition-all hover:border-border/80 hover:shadow-sm">
              <div className="flex items-start gap-3">
                <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${meta.chip}`}>
                  {domainIcon(c.domain)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold leading-snug">{c.domain}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {keywords.length > 0
                      ? `${keywords.length} mot${keywords.length > 1 ? "s" : ""}-clé${keywords.length > 1 ? "s" : ""} alimentant le scoring`
                      : "Aucun mot-clé — n'alimente pas le scoring"}
                  </p>
                </div>
                <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium shrink-0 ${meta.chip}`}>
                  {meta.label}
                </span>
              </div>

              {/* Jauge de niveau de maîtrise */}
              <div
                className="h-1.5 w-full rounded-full bg-muted overflow-hidden"
                title={`Niveau de maîtrise : ${meta.label}`}
              >
                <div className={`h-full rounded-full ${meta.bar} transition-all duration-500`} style={{ width: `${meta.weight}%` }} />
              </div>

              {keywords.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {keywords.map((kw) => (
                    <span key={kw} className="rounded-md bg-primary/10 text-primary px-2 py-0.5 text-xs font-medium">{kw}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PersonnelView({ profile }: { profile: CompanyProfile }) {
  const navigate = useNavigate();
  const personnel = profile.personnel ?? [];
  if (personnel.length === 0) return <EmptyHint>Aucun membre du personnel renseigné.</EmptyHint>;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {personnel.map((p, i) => (
        <PersonnelCard
          key={i}
          p={p}
          onEdit={() => {}}
          onRemove={() => {}}
          onView={() => navigate(`/settings/personnel/${encodeURIComponent(p.name)}`, { state: { person: p, past_projects: profile.past_projects ?? [] } })}
          readOnly
        />
      ))}
    </div>
  );
}

export function ProjectsView({ profile }: { profile: CompanyProfile }) {
  const navigate = useNavigate();
  const projects = profile.past_projects ?? [];
  if (projects.length === 0) return <EmptyHint>Aucun projet de référence renseigné.</EmptyHint>;
  return (
    <div className="space-y-2">
      {projects.map((p, i) => (
        <div
          key={i}
          role="button"
          tabIndex={0}
          onClick={() =>
            navigate(`/settings/projects/${encodeURIComponent(p.title)}`, {
              state: { project: p, personnel: profile.personnel ?? [], past_projects: projects },
            })
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              navigate(`/settings/projects/${encodeURIComponent(p.title)}`, {
                state: { project: p, personnel: profile.personnel ?? [], past_projects: projects },
              });
            }
          }}
          title="Voir le détail du projet et ses contributeurs"
          className="rounded-xl border bg-muted/20 overflow-hidden cursor-pointer transition-all hover:border-border/80 hover:shadow-sm"
        >
          <div className="flex items-start gap-3 px-4 py-3">
            {p.year && (
              <div className="rounded-lg bg-primary/10 px-2.5 py-2 text-center shrink-0 min-w-[3.5rem]">
                <div className="text-xs font-bold text-primary leading-none">{p.year}</div>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-semibold leading-snug">{p.title}</div>
                {(() => {
                  const meta = PROJECT_STATUS_META[projectStatusOf(p)];
                  return (
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0 ${meta.badge}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                      {meta.label}
                    </span>
                  );
                })()}
              </div>
              {(p.client || p.budget_fcfa) && (
                <div className="text-xs text-muted-foreground mt-0.5">
                  {[p.client, p.budget_fcfa ? fmtFcfa(p.budget_fcfa) : ""].filter(Boolean).join(" · ")}
                </div>
              )}
              {p.description && (
                <p className="text-xs text-muted-foreground/80 mt-1 leading-relaxed line-clamp-2">{p.description}</p>
              )}
            </div>
          </div>
          {((p.technologies ?? []).length > 0 || (p.domains ?? []).length > 0) && (
            <div className="px-4 py-2 border-t bg-background/40 flex flex-wrap gap-1">
              {(p.domains ?? []).map((d) => (
                <span key={d} className="rounded-md bg-muted text-muted-foreground px-2 py-0.5 text-xs font-medium">{d}</span>
              ))}
              {(p.technologies ?? []).map((t) => (
                <span key={t} className="rounded-md bg-primary/10 text-primary px-2 py-0.5 text-xs">{t}</span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function ComplianceView({ profile }: { profile: CompanyProfile }) {
  const hasPresence = !!(profile.intervention_zones || profile.languages || profile.insurance_coverage);
  const hasCoop = !!(profile.consortium_experience || profile.partnership_capacity);
  const hasCompliance = !!(profile.fiscal_social_compliance || profile.financial_capacity_notes || profile.equipment_major_assets || profile.strengths);

  if (!hasPresence && !hasCoop && !hasCompliance) {
    return <EmptyHint>Aucune information renseignée pour cette rubrique.</EmptyHint>;
  }

  return (
    <div className="space-y-5">
      {hasPresence && (
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Présence &amp; langues</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
            {profile.intervention_zones && (
              <div className="flex items-start gap-3 sm:col-span-2">
                <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Zones d'intervention</p>
                  <p className="text-sm font-medium mt-0.5 leading-snug">{profile.intervention_zones}</p>
                </div>
              </div>
            )}
            {profile.languages && (
              <div className="flex items-start gap-3">
                <Star className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Langues de travail</p>
                  <p className="text-sm font-medium mt-0.5">{profile.languages}</p>
                </div>
              </div>
            )}
            {profile.insurance_coverage && (
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Assurances</p>
                  <p className="text-sm font-medium mt-0.5">{profile.insurance_coverage}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {hasCoop && (
        <div className={`space-y-3 ${hasPresence ? "pt-4 border-t" : ""}`}>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Coopération &amp; partenariats</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
            {profile.consortium_experience && (
              <div>
                <p className="text-xs text-muted-foreground">Expérience en groupement</p>
                <p className="text-sm font-medium mt-0.5 leading-snug">{profile.consortium_experience}</p>
              </div>
            )}
            {profile.partnership_capacity && (
              <div>
                <p className="text-xs text-muted-foreground">Sous-traitance / co-traitants</p>
                <p className="text-sm font-medium mt-0.5 leading-snug">{profile.partnership_capacity}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {hasCompliance && (
        <div className={`space-y-3 ${hasPresence || hasCoop ? "pt-4 border-t" : ""}`}>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Conformité &amp; capacité</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
            {profile.fiscal_social_compliance && (
              <div>
                <p className="text-xs text-muted-foreground">Conformité fiscale et sociale</p>
                <p className="text-sm font-medium mt-0.5 leading-snug">{profile.fiscal_social_compliance}</p>
              </div>
            )}
            {profile.financial_capacity_notes && (
              <div>
                <p className="text-xs text-muted-foreground">Capacité financière (cautions, bilan)</p>
                <p className="text-sm font-medium mt-0.5 leading-snug">{profile.financial_capacity_notes}</p>
              </div>
            )}
            {profile.equipment_major_assets && (
              <div>
                <p className="text-xs text-muted-foreground">Moyens matériels</p>
                <p className="text-sm font-medium mt-0.5 leading-snug">{profile.equipment_major_assets}</p>
              </div>
            )}
            {profile.strengths && (
              <div>
                <p className="text-xs text-muted-foreground">Atouts distinctifs</p>
                <p className="text-sm font-medium mt-0.5 leading-snug">{profile.strengths}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Surligne la partie du terme qui correspond à la recherche. */
export function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-amber-300/50 dark:bg-amber-500/30 text-inherit rounded-sm">
        {text.slice(i, i + query.length)}
      </mark>
      {text.slice(i + query.length)}
    </>
  );
}

export function CatalogView({ profile }: { profile: CompanyProfile }) {
  const [query, setQuery] = useState("");
  const techs = [...(profile.technologies_catalog ?? [])].sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));
  const doms = [...(profile.domains_catalog ?? [])].sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));

  if (techs.length === 0 && doms.length === 0) {
    return <EmptyHint>Référentiel vide. Ajoutez ici les technologies et domaines qui seront sélectionnables dans les projets, compétences et profils.</EmptyHint>;
  }

  const q = query.trim().toLowerCase();
  const filteredTechs = q ? techs.filter((t) => t.toLowerCase().includes(q)) : techs;
  const filteredDoms = q ? doms.filter((d) => d.toLowerCase().includes(q)) : doms;
  const total = filteredTechs.length + filteredDoms.length;
  const exact = q ? [...techs, ...doms].find((t) => t.toLowerCase() === q) : undefined;

  return (
    <div className="space-y-4">
      {/* Barre de recherche fine */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Vérifier si une technologie ou un domaine figure au référentiel…"
          className="h-8 pl-8 pr-8 text-xs"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            title="Effacer la recherche"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Verdict de la recherche */}
      {q && (
        total === 0 ? (
          <div className="rounded-lg border border-amber-300/60 bg-amber-50/60 dark:border-amber-800/40 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            « {query.trim()} » ne figure pas au référentiel. Cliquez sur <strong>Modifier</strong> pour l'ajouter.
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {total} résultat{total > 1 ? "s" : ""}
            {exact && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 text-[11px] font-medium">
                <CheckCircle2 className="h-3 w-3" /> « {exact} » est au référentiel
              </span>
            )}
          </p>
        )
      )}

      {/* Technologies */}
      {filteredTechs.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1.5">
            Technologies {q ? `(${filteredTechs.length}/${techs.length})` : `(${techs.length})`}
          </p>
          <div className="flex flex-wrap gap-1">
            {filteredTechs.map((t) => (
              <span key={t} className="rounded-md bg-primary/10 text-primary px-2 py-0.5 text-xs font-medium">
                <Highlight text={t} query={q} />
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Domaines */}
      {filteredDoms.length > 0 && (
        <div className={filteredTechs.length > 0 ? "border-t pt-4" : ""}>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1.5">
            Domaines {q ? `(${filteredDoms.length}/${doms.length})` : `(${doms.length})`}
          </p>
          <div className="flex flex-wrap gap-1">
            {filteredDoms.map((d) => (
              <span key={d} className="rounded-md bg-muted text-muted-foreground px-2 py-0.5 text-xs font-medium">
                <Highlight text={d} query={q} />
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Carte de rubrique éditable ───────────────────────────────────────────────

export type SectionKey =
  | "identity"
  | "certifications"
  | "catalog"
  | "competencies"
  | "personnel"
  | "projects"
  | "compliance";

/** Champs du profil couverts par chaque rubrique — seuls ces champs sont envoyés au PUT. */
export const SECTION_FIELDS: Record<SectionKey, (keyof CompanyProfile)[]> = {
  identity: [
    "company_name", "legal_form", "country", "city", "registration_ids",
    "annual_revenue", "available_cash", "credit_line", "description",
    "years_experience", "staff_headcount",
  ],
  certifications: ["certifications", "technical_qualifications"],
  catalog: ["technologies_catalog", "domains_catalog"],
  competencies: ["competencies"],
  personnel: ["personnel"],
  projects: ["past_projects"],
  compliance: [
    "intervention_zones", "languages", "insurance_coverage",
    "consortium_experience", "partnership_capacity",
    "fiscal_social_compliance", "financial_capacity_notes",
    "equipment_major_assets", "strengths",
  ],
};

export function SectionCard({
  title, description, isEditing, canEdit, saving, onEdit, onCancel, onSave, children,
}: {
  title: string;
  description?: string;
  isEditing: boolean;
  canEdit: boolean;
  saving: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  children: React.ReactNode;
}) {
  // Repliée par défaut : un clic sur le chevron (ou le titre) déroule la rubrique
  // en lecture, sans passer par le mode édition. L'édition force l'ouverture.
  // L'état est persisté en sessionStorage : au retour d'une page de détail
  // (expert, projet), la rubrique qu'on avait dépliée le reste.
  const storageKey = `kiama_rubrique_open:${title}`;
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(storageKey) === "1";
    } catch {
      return false;
    }
  });
  const toggle = (next: boolean) => {
    setOpen(next);
    try {
      sessionStorage.setItem(storageKey, next ? "1" : "0");
    } catch {
      // stockage indisponible (navigation privée) : état en mémoire seulement
    }
  };
  const expanded = open || isEditing;

  return (
    <div className={`rounded-xl border bg-card overflow-hidden transition-shadow ${isEditing ? "ring-1 ring-amber-400/60 border-amber-300/60" : ""}`}>
      <div className={`flex items-center justify-between gap-3 px-5 py-4 ${expanded ? "border-b" : ""} ${isEditing ? "bg-amber-50/60 dark:bg-amber-950/15" : ""}`}>
        <button
          type="button"
          onClick={() => { if (!isEditing) toggle(!open); }}
          className="min-w-0 flex-1 text-left cursor-pointer"
          title={expanded ? "Replier la rubrique" : "Dérouler la rubrique"}
        >
          <div className="font-semibold text-sm flex items-center gap-2">
            {isEditing && <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" />}
            {title}
          </div>
          {description && <div className="text-xs text-muted-foreground mt-0.5">{description}</div>}
        </button>
        {isEditing ? (
          <div className="flex gap-2 shrink-0">
            <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>Annuler</Button>
            <Button type="button" size="sm" onClick={onSave} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Sauvegarder
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1 shrink-0">
            <Button type="button" variant="outline" size="sm" onClick={() => { toggle(true); onEdit(); }} disabled={!canEdit} className="gap-2">
              <Pencil className="h-3.5 w-3.5" /> Modifier
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              onClick={() => toggle(!open)}
              title={expanded ? "Replier la rubrique" : "Dérouler la rubrique"}
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        )}
      </div>
      {expanded && <div className="px-5 py-4">{children}</div>}
    </div>
  );
}
