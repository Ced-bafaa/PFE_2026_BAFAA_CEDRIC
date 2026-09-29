/**
 * ProjectDetailPage — Page de détail d'un projet de référence
 * Route : /settings/projects/:title (le titre sert d'identifiant, comme le nom
 * pour le personnel).
 *
 * Matérialise la relation N↔N experts/projets : la page liste les experts
 * contributeurs (cartes cliquables → profil de l'expert), et le profil d'un
 * expert liste ses projets (cliquables → cette page).
 */
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { apiJson } from "@/lib/api";
import type {
  CompanyProfile,
  PastProject,
  Personnel,
} from "@/pages/settings/CompanySettingsPage";
import { fmtFcfa, PROJECT_STATUS_META, projectStatusOf } from "@/pages/settings/company/types";
import { PersonnelCard } from "@/pages/settings/company/personnel";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Banknote,
  Building2,
  Calendar,
  FolderOpen,
  Layers,
  Users,
} from "lucide-react";

type LocationState = {
  project?: PastProject;
  personnel?: Personnel[];
  past_projects?: PastProject[];
};

function SectionCard({
  title,
  icon,
  children,
  count,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b bg-muted/20">
        <span className="text-muted-foreground">{icon}</span>
        <h3 className="font-semibold text-sm flex-1">{title}</h3>
        {count != null && (
          <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">{count}</span>
        )}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

export default function ProjectDetailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { title: encodedTitle } = useParams<{ title: string }>();

  // Retour contextuel : revient à la page précédente (projet, paramètres,
  // autre profil…) ; retombe sur /settings si la page a été ouverte directement.
  const goBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    if (typeof idx === "number" && idx > 0) {
      navigate(-1);
    } else {
      navigate("/settings");
    }
  };

  const state = (location.state ?? {}) as LocationState;
  const [project, setProject] = useState<PastProject | null>(state.project ?? null);
  const [personnel, setPersonnel] = useState<Personnel[]>(state.personnel ?? []);
  const [pastProjects, setPastProjects] = useState<PastProject[]>(state.past_projects ?? []);
  const [loading, setLoading] = useState(!state.project);

  // Recharge le profil complet (source de vérité, et accès direct par URL)
  useEffect(() => {
    const decoded = decodeURIComponent(encodedTitle ?? "").trim().toLowerCase();
    apiJson<CompanyProfile>("settings/company")
      .then((profile) => {
        setPersonnel(profile.personnel ?? []);
        setPastProjects(profile.past_projects ?? []);
        const found = (profile.past_projects ?? []).find(
          (p) => p.title.trim().toLowerCase() === decoded,
        );
        setProject((prev) => found ?? prev ?? null);
      })
      .catch(() => {
        // Backend indisponible : on garde le state de navigation
      })
      .finally(() => setLoading(false));
  }, [encodedTitle]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Chargement…
      </div>
    );
  }

  if (!project) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12 text-center space-y-4">
        <p className="text-muted-foreground">Projet de référence introuvable.</p>
        <Button variant="outline" onClick={() => navigate("/settings")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Retour aux paramètres
        </Button>
      </div>
    );
  }

  // Relation N↔N : experts du profil rattachés à ce projet…
  const contributors = personnel.filter((p) =>
    (project.personnel_names ?? []).includes(p.name),
  );
  // …et noms rattachés ne correspondant plus à aucun expert (anciens membres)
  const formerNames = (project.personnel_names ?? []).filter(
    (name) => !personnel.some((p) => p.name === name),
  );

  const domains = project.domains ?? [];
  const technologies = project.technologies ?? [];

  return (
    <div className="min-h-screen bg-background">
      {/* ── Barre de navigation ── */}
      <div className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur-sm px-6 py-3 flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 h-8 text-muted-foreground hover:text-foreground"
          onClick={goBack}
        >
          <ArrowLeft className="h-4 w-4" />
          Retour
        </Button>
        <span className="text-muted-foreground/40 text-sm">/</span>
        <span className="text-sm text-muted-foreground">Projets de référence</span>
        <span className="text-muted-foreground/40 text-sm">/</span>
        <span className="text-sm font-medium truncate">{project.title}</span>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* ── Carte héro ── */}
        <div className="rounded-2xl border bg-card overflow-hidden">
          <div className="h-2 w-full bg-primary/60" />
          <div className="px-6 pt-6 pb-5">
            <div className="flex flex-col sm:flex-row sm:items-start gap-5">
              <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                <FolderOpen className="h-8 w-8 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <h1 className="text-xl font-bold leading-snug">{project.title}</h1>
                  {(() => {
                    const meta = PROJECT_STATUS_META[projectStatusOf(project)];
                    return (
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium shrink-0 ${meta.badge}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                        {meta.label}
                      </span>
                    );
                  })()}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-2 text-sm text-muted-foreground">
                  {project.client && (
                    <span className="inline-flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5 shrink-0" /> {project.client}
                    </span>
                  )}
                  {project.year && (
                    <span className="inline-flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5 shrink-0" /> {project.year}
                    </span>
                  )}
                  {project.budget_fcfa ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Banknote className="h-3.5 w-3.5 shrink-0" /> {fmtFcfa(project.budget_fcfa)}
                    </span>
                  ) : null}
                </div>
                {project.description && (
                  <p className="text-sm text-muted-foreground leading-relaxed mt-3 border-t pt-3">
                    {project.description}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Domaines & technologies ── */}
        {(domains.length > 0 || technologies.length > 0) && (
          <SectionCard title="Domaines et technologies" icon={<Layers className="h-4.5 w-4.5" />}>
            <div className="space-y-3">
              {domains.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1.5">Domaines</p>
                  <div className="flex flex-wrap gap-1">
                    {domains.map((d) => (
                      <span key={d} className="rounded-md bg-muted text-muted-foreground px-2 py-0.5 text-xs font-medium">{d}</span>
                    ))}
                  </div>
                </div>
              )}
              {technologies.length > 0 && (
                <div className={domains.length > 0 ? "border-t pt-3" : ""}>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1.5">Technologies</p>
                  <div className="flex flex-wrap gap-1">
                    {technologies.map((t) => (
                      <span key={t} className="rounded-md bg-primary/10 text-primary px-2 py-0.5 text-xs font-medium">{t}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </SectionCard>
        )}

        {/* ── Experts contributeurs (N↔N : carte cliquable → profil) ── */}
        <SectionCard
          title="Experts ayant contribué"
          icon={<Users className="h-4.5 w-4.5" />}
          count={contributors.length > 0 ? contributors.length : undefined}
        >
          {contributors.length === 0 && formerNames.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucun expert rattaché à ce projet. Le rattachement se fait dans
              Paramètres &gt; Entreprise &gt; Projets de référence, ou depuis le profil d'un expert.
            </p>
          ) : (
            <div className="space-y-4">
              {contributors.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {contributors.map((p) => (
                    <PersonnelCard
                      key={p.name}
                      p={p}
                      onEdit={() => {}}
                      onRemove={() => {}}
                      onView={() =>
                        navigate(`/settings/personnel/${encodeURIComponent(p.name)}`, {
                          state: { person: p, past_projects: pastProjects },
                        })
                      }
                      readOnly
                    />
                  ))}
                </div>
              )}
              {formerNames.length > 0 && (
                <div className={contributors.length > 0 ? "border-t pt-3" : ""}>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1.5">
                    Contributeurs ne figurant plus au personnel clé
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {formerNames.map((name) => (
                      <span key={name} className="rounded-md bg-muted text-muted-foreground px-2 py-0.5 text-xs font-medium">{name}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
