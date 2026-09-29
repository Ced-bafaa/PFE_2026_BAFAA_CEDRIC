/**
 * PersonnelDetailPage — Page de détail d'un membre du personnel clé
 * Route : /settings/personnel/:name
 * Reçoit { person, past_projects } via location.state ; recharge toujours le
 * profil complet depuis l'API pour permettre l'édition (PUT partiel).
 *
 * Édition possible depuis cette page :
 *  - « Modifier le profil » : toutes les infos de l'expert (même formulaire que dans Paramètres).
 *  - « Rattacher à un projet » : assigner l'expert à des projets EXISTANTS uniquement —
 *    la création de projets se fait exclusivement dans Paramètres > Entreprise.
 */

import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { apiJson, getApiBaseUrl, getAuthHeaders, uploadPersonnelCv } from "@/lib/api";
import { hasRole } from "@/lib/auth";
import { toast } from "sonner";
import {
  PersonnelFormDialog,
  clonePersonnel,
} from "@/pages/settings/CompanySettingsPage";
import type {
  Personnel,
  PersonnelCv,
  PersonnelDiploma,
  PastProject,
  CompanyProfile,
} from "@/pages/settings/CompanySettingsPage";
import { PROJECT_STATUS_META, projectStatusOf } from "@/pages/settings/company/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ArrowLeft,
  MapPin,
  Star,
  GraduationCap,
  FileText,
  Download,
  Calendar,
  Award,
  Layers,
  FolderOpen,
  Users,
  Briefcase,
  Eye,
  Upload,
  Pencil,
  Plus,
  Loader2,
} from "lucide-react";

// ── Utilitaires ───────────────────────────────────────────────────────────────

function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** « Occupé » : mobilisé par un travail effectif ⇒ doit avoir un projet EN COURS. */
function isOccupiedValue(value?: string): boolean {
  return (value ?? "").toLowerCase().includes("occup");
}
/** « Indisponible-ish » : occupé OU indisponible (congé, maladie…). */
function isUnavailableValue(value?: string): boolean {
  const lower = (value ?? "").toLowerCase();
  return lower.includes("indispo") || lower.includes("occup");
}

type AccentConfig = {
  band: string;
  bg: string;
  text: string;
  ring: string;
  bar: string;
  gradient: string;
};

function accentConfig(name: string): AccentConfig {
  const configs: AccentConfig[] = [
    { band: "bg-blue-400",    bg: "bg-blue-500/15",    text: "text-blue-700 dark:text-blue-400",    ring: "ring-blue-300/60 dark:ring-blue-700/50",    bar: "bg-blue-500",    gradient: "from-blue-500/10 to-transparent" },
    { band: "bg-violet-400",  bg: "bg-violet-500/15",  text: "text-violet-700 dark:text-violet-400",  ring: "ring-violet-300/60 dark:ring-violet-700/50",  bar: "bg-violet-500",  gradient: "from-violet-500/10 to-transparent" },
    { band: "bg-emerald-400", bg: "bg-emerald-500/15", text: "text-emerald-700 dark:text-emerald-400", ring: "ring-emerald-300/60 dark:ring-emerald-700/50", bar: "bg-emerald-500", gradient: "from-emerald-500/10 to-transparent" },
    { band: "bg-orange-400",  bg: "bg-orange-500/15",  text: "text-orange-700 dark:text-orange-400",  ring: "ring-orange-300/60 dark:ring-orange-700/50",  bar: "bg-orange-500",  gradient: "from-orange-500/10 to-transparent" },
    { band: "bg-rose-400",    bg: "bg-rose-500/15",    text: "text-rose-700 dark:text-rose-400",    ring: "ring-rose-300/60 dark:ring-rose-700/50",    bar: "bg-rose-500",    gradient: "from-rose-500/10 to-transparent" },
    { band: "bg-cyan-400",    bg: "bg-cyan-500/15",    text: "text-cyan-700 dark:text-cyan-400",    ring: "ring-cyan-300/60 dark:ring-cyan-700/50",    bar: "bg-cyan-500",    gradient: "from-cyan-500/10 to-transparent" },
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return configs[h % configs.length];
}

function AvailabilityBadge({
  value,
  onClick,
  disabled = false,
}: {
  value?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  if (!value) return null;
  const lower = value.toLowerCase();
  // « Indisponible » contient « dispo » : tester l'indisponibilité en premier
  const isUnavail = lower.includes("indispo") || lower.includes("occup");
  const isPartial = !isUnavail && lower.includes("partiel");
  const isAvail = !isUnavail && !isPartial && lower.includes("dispo");
  const cls = isAvail
    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 ring-emerald-300/50 dark:ring-emerald-700/50"
    : isPartial
    ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 ring-amber-300/50 dark:ring-amber-700/50"
    : isUnavail
    ? "bg-rose-500/15 text-rose-700 dark:text-rose-400 ring-rose-300/50 dark:ring-rose-700/50"
    : "bg-muted text-muted-foreground ring-border";
  const dot = isAvail ? "bg-emerald-500" : isPartial ? "bg-amber-500" : isUnavail ? "bg-rose-500" : "bg-muted-foreground";

  const inner = (
    <>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {value}
    </>
  );

  // Sans onClick : simple badge d'affichage
  if (!onClick) {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full ring-1 px-3 py-1 text-xs font-medium ${cls}`}>
        {inner}
      </span>
    );
  }

  // Avec onClick : badge-bouton pour basculer le statut manuellement
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title="Cliquer pour basculer Disponible / Indisponible"
      className={`inline-flex items-center gap-1.5 rounded-full ring-1 px-3 py-1 text-xs font-medium transition-opacity hover:opacity-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${cls}`}
    >
      {inner}
    </button>
  );
}

// ── Composants de section ─────────────────────────────────────────────────────

function SectionCard({
  title,
  icon,
  children,
  count,
  action,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b bg-muted/20">
        <span className="text-muted-foreground">{icon}</span>
        <h3 className="font-semibold text-sm flex-1">{title}</h3>
        {count != null && (
          <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">{count}</span>
        )}
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────

type LocationState = {
  person?: Personnel;
  past_projects?: PastProject[];
};

export default function PersonnelDetailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { name: encodedName } = useParams<{ name: string }>();

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
  const [person, setPerson] = useState<Personnel | null>(state.person ?? null);
  const [pastProjects, setPastProjects] = useState<PastProject[]>(state.past_projects ?? []);
  // Liste complète du personnel — indispensable pour sauvegarder (PUT du tableau entier)
  const [personnel, setPersonnel] = useState<Personnel[] | null>(null);
  const [catalogTechs, setCatalogTechs] = useState<string[]>([]);
  const [loading, setLoading] = useState(!state.person);
  const [saving, setSaving] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignDraft, setAssignDraft] = useState<PastProject[]>([]);

  // Recharge toujours le profil complet (source de vérité pour l'édition)
  useEffect(() => {
    const decodedName = decodeURIComponent(encodedName ?? "");
    apiJson<CompanyProfile>("/settings/company")
      .then((profile) => {
        const list = profile.personnel ?? [];
        setPersonnel(list);
        setPastProjects(profile.past_projects ?? []);
        setCatalogTechs(profile.technologies_catalog ?? []);
        const found = list.find((p) => p.name === decodedName);
        setPerson((prev) => found ?? prev ?? null);
      })
      .catch(() => {
        // Backend indisponible : on garde les données du state de navigation (lecture seule)
      })
      .finally(() => setLoading(false));
  }, [encodedName]);

  // ── Sauvegarde du profil modifié ────────────────────────────────────────────
  const savePerson = async (updated: Personnel) => {
    if (!person || !personnel) return;

    // Règle métier : un personnel qui DEVIENT « occupé » doit être rattaché à au
    // moins un projet EN COURS (un projet achevé n'occupe plus personne).
    // « Indisponible » (congé, maladie…) reste permis sans projet — simple
    // avertissement. L'inverse n'est jamais imposé : être sur un projet ne rend
    // pas indisponible et n'empêche pas d'autres rattachements.
    const ongoingLinked = pastProjects.filter(
      (p) => (p.personnel_names ?? []).includes(person.name) && projectStatusOf(p) === "en_cours",
    ).length;
    const becomesOccupied =
      isOccupiedValue(updated.availability) && !isOccupiedValue(person.availability);
    if (becomesOccupied && ongoingLinked === 0) {
      toast.error(
        "Un personnel « occupé » doit être rattaché à au moins un projet en cours. Rattachez-le d'abord à un projet en cours, ou choisissez « Indisponible ».",
      );
      openAssign();
      return;
    }

    setSaving(true);
    try {
      const renamed = updated.name !== person.name;
      const nextPersonnel = personnel.map((p) => (p.name === person.name ? updated : p));
      const payload: Record<string, unknown> = { personnel: nextPersonnel };

      // Si le nom change, propager dans les rattachements de projets
      let nextProjects = pastProjects;
      if (renamed) {
        nextProjects = pastProjects.map((proj) => ({
          ...proj,
          personnel_names: (proj.personnel_names ?? []).map((n) =>
            n === person.name ? updated.name : n,
          ),
        }));
        payload.past_projects = nextProjects;
      }

      await apiJson("/settings/company", { method: "PUT", body: JSON.stringify(payload) });
      setPersonnel(nextPersonnel);
      setPerson(updated);
      setPastProjects(nextProjects);
      toast.success("Profil mis à jour.");
      if (renamed) {
        navigate(`/settings/personnel/${encodeURIComponent(updated.name)}`, {
          replace: true,
          state: { person: updated, past_projects: nextProjects },
        });
      }
    } catch {
      toast.error("Erreur lors de la sauvegarde du profil.");
    } finally {
      setSaving(false);
    }
  };

  // ── Bascule manuelle du statut de disponibilité (clic sur le badge) ────────
  const toggleAvailability = () => {
    if (!person) return;
    // Bascule rapide Disponible ↔ Occupé (le « busy » lié au travail). Les états
    // nuancés « Indisponible » (congé) et « Partiel » se règlent via le formulaire.
    // Le passage vers « Occupé » sans projet en cours est bloqué par savePerson.
    const unavailish = isUnavailableValue(person.availability);
    void savePerson({ ...person, availability: unavailish ? "Disponible" : "Occupé" });
  };

  // ── Gestion des CVs depuis la page de détail ────────────────────────────────
  const MAX_CV = 3;
  const cvInputRef = useRef<HTMLInputElement>(null);
  const [cvUploading, setCvUploading] = useState(false);

  const handleCvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !person) return;
    setCvUploading(true);
    try {
      const { filename, originalname } = await uploadPersonnelCv(file);
      const newCv: PersonnelCv = {
        filename,
        originalname,
        uploaded_at: new Date().toISOString(),
      };
      await savePerson({ ...person, cv_files: [...(person.cv_files ?? []), newCv] });
    } catch {
      toast.error("Échec de l'upload du CV (PDF, 10 Mo max).");
    } finally {
      setCvUploading(false);
      if (cvInputRef.current) cvInputRef.current.value = "";
    }
  };

  /** Téléchargement forcé (le lien direct ouvrirait le PDF dans l'onglet). */
  const downloadFile = async (url: string, name: string) => {
    try {
      const res = await fetch(url, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      toast.error("Téléchargement impossible (backend indisponible ?).");
    }
  };

  // ── Rattachement à des projets existants (pas de création ici) ─────────────
  const openAssign = () => {
    setAssignDraft(pastProjects.map((p) => ({ ...p, personnel_names: [...(p.personnel_names ?? [])] })));
    setAssignOpen(true);
  };

  const toggleAssign = (idx: number) => {
    if (!person) return;
    setAssignDraft((list) =>
      list.map((proj, i) => {
        if (i !== idx) return proj;
        const names = proj.personnel_names ?? [];
        return {
          ...proj,
          personnel_names: names.includes(person.name)
            ? names.filter((n) => n !== person.name)
            : [...names, person.name],
        };
      }),
    );
  };

  const saveAssign = async () => {
    // Si le personnel est « occupé », il doit conserver au moins un projet EN COURS.
    if (person && isOccupiedValue(person.availability)) {
      const ongoingInDraft = assignDraft.filter(
        (p) => (p.personnel_names ?? []).includes(person.name) && projectStatusOf(p) === "en_cours",
      ).length;
      if (ongoingInDraft === 0) {
        toast.error(
          "Ce personnel est « occupé » : il doit rester rattaché à au moins un projet en cours. Rendez-le disponible/indisponible, ou conservez un projet en cours.",
        );
        return;
      }
    }
    setSaving(true);
    try {
      await apiJson("/settings/company", {
        method: "PUT",
        body: JSON.stringify({ past_projects: assignDraft }),
      });
      setPastProjects(assignDraft);
      setAssignOpen(false);
      toast.success("Rattachements mis à jour.");
    } catch {
      toast.error("Erreur lors de la sauvegarde des rattachements.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Chargement…
      </div>
    );
  }

  if (!person) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12 text-center space-y-4">
        <p className="text-muted-foreground">Profil introuvable.</p>
        <Button variant="outline" onClick={() => navigate("/settings")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Retour aux paramètres
        </Button>
      </div>
    );
  }

  const accent   = accentConfig(person.name);
  const initials = avatarInitials(person.name);
  const diplomas = person.diplomas ?? [];
  const skills   = person.skills ?? [];
  const certs    = person.certifications ?? [];
  const cvFiles  = person.cv_files ?? [];
  // Seul l'admin système peut éditer ; les autres rôles sont en lecture seule.
  const isAdmin  = hasRole("admin_systeme");
  const canEdit  = personnel !== null && isAdmin; // profil chargé ET droits d'édition

  // ── Métriques dérivées de données réelles ──────────────────────────────────
  // Projets de l'entreprise dans lesquels ce personnel est référencé
  const linkedProjects = pastProjects.filter((proj) =>
    (proj.personnel_names ?? []).includes(person.name)
  );
  // Répartition par avancement (en cours / achevé)
  const ongoingCount = linkedProjects.filter((p) => projectStatusOf(p) === "en_cours").length;
  const doneCount = linkedProjects.length - ongoingCount;
  // Période d'activité couverte par ces projets (années min – max)
  const projectYears = linkedProjects
    .map((p) => parseInt(p.year ?? "", 10))
    .filter((n) => Number.isFinite(n));
  const minYear = projectYears.length ? Math.min(...projectYears) : null;
  const maxYear = projectYears.length ? Math.max(...projectYears) : null;
  const activitySpan =
    minYear != null ? (minYear === maxYear ? `${minYear}` : `${minYear} – ${maxYear}`) : null;
  // Clients distincts servis sur ces projets
  const distinctClients = Array.from(
    new Set(linkedProjects.map((p) => (p.client ?? "").trim()).filter(Boolean)),
  );
  // Domaines et technologies réellement pratiqués sur les projets rattachés
  const projectTechs = Array.from(new Set(linkedProjects.flatMap((p) => p.technologies ?? [])));
  const projectDomains = Array.from(new Set(linkedProjects.flatMap((p) => p.domains ?? [])));
  // Adéquation : part des technologies des projets couverte par les compétences déclarées
  const skillSet = new Set(skills.map((s) => s.toLowerCase()));
  const coveredTechs = projectTechs.filter((t) => skillSet.has(t.toLowerCase()));
  const techCoverage = projectTechs.length
    ? Math.round((coveredTechs.length / projectTechs.length) * 100)
    : null;
  // Expérience : valeur déclarée, sinon déduite du diplôme le plus expérimenté
  const diplomaExp = diplomas.reduce((m, d) => Math.max(m, d.years_experience ?? 0), 0);
  const experienceYears = person.years_experience ?? (diplomaExp > 0 ? diplomaExp : null);

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
        <span className="text-sm text-muted-foreground">Personnel clé</span>
        <span className="text-muted-foreground/40 text-sm">/</span>
        <span className="text-sm font-medium truncate flex-1">{person.name}</span>
        {isAdmin ? (
          <Button
            variant="outline"
            size="sm"
            className="gap-2 h-8 shrink-0"
            onClick={() => setEditOpen(true)}
            disabled={!canEdit || saving}
            title={canEdit ? "Modifier les informations de ce profil" : "Profil complet en cours de chargement…"}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />}
            Modifier le profil
          </Button>
        ) : (
          <span className="text-[11px] px-2 py-1 rounded-full border border-border text-muted-foreground shrink-0">
            Lecture seule
          </span>
        )}
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* ── Carte héro ── */}
        <div className="rounded-2xl border bg-card overflow-hidden">
          <div className={`h-2 w-full ${accent.band}`} />
          <div className={`bg-gradient-to-b ${accent.gradient} px-6 pt-6 pb-5`}>
            <div className="flex flex-col sm:flex-row sm:items-end gap-5">
              <div className={`h-20 w-20 rounded-2xl flex items-center justify-center text-2xl font-bold shrink-0 ring-2 ${accent.ring} ${accent.bg} ${accent.text}`}>
                {initials}
              </div>
              <div className="flex-1 min-w-0 pb-1">
                <h1 className="text-2xl font-bold leading-tight">{person.name}</h1>
                <p className="text-muted-foreground mt-0.5">{person.role}</p>
                <div className="flex flex-wrap items-center gap-3 mt-3">
                  <AvailabilityBadge
                    value={person.availability?.trim() || "Disponible"}
                    onClick={isAdmin ? toggleAvailability : undefined}
                    disabled={!canEdit || saving}
                  />
                  {person.location && (
                    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      {person.location}
                    </span>
                  )}
                </div>
              </div>

              {/* Compteur projets réalisés */}
              {linkedProjects.length > 0 && (
                <div className="flex flex-col items-center shrink-0 rounded-xl border bg-card/60 px-5 py-3 gap-1">
                  <p className="text-2xl font-bold tabular-nums">{linkedProjects.length}</p>
                  <p className="text-xs text-muted-foreground whitespace-nowrap">
                    {linkedProjects.length > 1 ? "Projets rattachés" : "Projet rattaché"}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Statistiques — valeurs réelles ou dérivées des projets ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {experienceYears != null && (
            <div
              className="rounded-xl border bg-card p-4 flex flex-col items-center text-center gap-1"
              title={person.years_experience != null
                ? "Années d'expérience déclarées sur le profil"
                : "Déduit du diplôme avec le plus d'années d'expérience"}
            >
              <p className="text-2xl font-bold leading-none tabular-nums">{experienceYears}</p>
              <p className="text-xs text-muted-foreground">années</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 uppercase tracking-wide">
                {person.years_experience != null ? "Expérience (déclarée)" : "Expérience (diplômes)"}
              </p>
            </div>
          )}

          <div
            className="rounded-xl border bg-card p-4 flex flex-col items-center text-center gap-1"
            title="Nombre de projets de référence de l'entreprise auxquels ce profil est rattaché"
          >
            <p className="text-2xl font-bold leading-none tabular-nums">{linkedProjects.length}</p>
            <p className="text-xs text-muted-foreground">{activitySpan ?? "aucune année renseignée"}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 uppercase tracking-wide">Projets entreprise</p>
          </div>

          {distinctClients.length > 0 && (
            <div
              className="rounded-xl border bg-card p-4 flex flex-col items-center text-center gap-1"
              title={distinctClients.join(", ")}
            >
              <p className="text-2xl font-bold leading-none tabular-nums">{distinctClients.length}</p>
              <p className="text-xs text-muted-foreground">maîtres d'ouvrage</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 uppercase tracking-wide">Clients servis</p>
            </div>
          )}

          {techCoverage != null && (
            <div
              className="rounded-xl border bg-card p-4 col-span-2 lg:col-span-1 flex flex-col gap-2"
              title={`${coveredTechs.length} technologie(s) sur ${projectTechs.length} utilisées dans ses projets figurent dans ses compétences déclarées`}
            >
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Adéquation techno</p>
                <p className="text-2xl font-bold tabular-nums">{techCoverage}%</p>
              </div>
              <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full ${accent.bar} transition-all duration-700`}
                  style={{ width: `${techCoverage}%` }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Compétences couvrant les technologies de ses projets
              </p>
            </div>
          )}
        </div>

        {/* ── Contenu en deux colonnes ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* Colonne principale (2/3) */}
          <div className="lg:col-span-2 space-y-5">

            {/* Projets réalisés — rattachement à des projets existants uniquement */}
            <SectionCard
              title="Projets rattachés"
              icon={<FolderOpen className="h-4.5 w-4.5" />}
              count={linkedProjects.length > 0 ? linkedProjects.length : undefined}
              action={
                isAdmin ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1 shrink-0"
                    onClick={openAssign}
                    disabled={!canEdit || saving}
                  >
                    <Plus className="h-3.5 w-3.5" /> Rattacher à un projet
                  </Button>
                ) : undefined
              }
            >
              {isUnavailableValue(person.availability) && ongoingCount === 0 && (
                <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  <span aria-hidden>⚠</span>
                  <span>
                    {isOccupiedValue(person.availability) ? (
                      <>Ce personnel est marqué <strong>occupé</strong> mais n'a aucun projet <strong>en cours</strong>.</>
                    ) : (
                      <>Ce personnel est <strong>indisponible</strong> et n'a aucun projet en cours.</>
                    )}
                    {isAdmin && " Rattachez-le à un projet en cours, ou ajustez sa disponibilité."}
                  </span>
                </div>
              )}
              {linkedProjects.length > 0 ? (
                <div className="space-y-3">
                  {/* Répartition par avancement */}
                  {(ongoingCount > 0 || doneCount > 0) && (
                    <div className="flex flex-wrap items-center gap-2">
                      {ongoingCount > 0 && (
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${PROJECT_STATUS_META.en_cours.badge}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${PROJECT_STATUS_META.en_cours.dot}`} />
                          {ongoingCount} en cours
                        </span>
                      )}
                      {doneCount > 0 && (
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${PROJECT_STATUS_META.acheve.badge}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${PROJECT_STATUS_META.acheve.dot}`} />
                          {doneCount} achevé{doneCount > 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  )}
                  {linkedProjects.map((proj, i) => {
                    const statusMeta = PROJECT_STATUS_META[projectStatusOf(proj)];
                    return (
                    <div
                      key={i}
                      role="button"
                      tabIndex={0}
                      onClick={() =>
                        navigate(`/settings/projects/${encodeURIComponent(proj.title)}`, {
                          state: { project: proj, personnel: personnel ?? [], past_projects: pastProjects },
                        })
                      }
                      title="Voir le détail du projet et ses contributeurs"
                      className="rounded-xl border bg-muted/20 overflow-hidden cursor-pointer transition-all hover:border-border/80 hover:shadow-sm"
                    >
                      <div className="flex items-start gap-3 px-4 py-3">
                        {proj.year && (
                          <div className={`rounded-lg px-2.5 py-1.5 text-center shrink-0 min-w-[3.5rem] ${accent.bg}`}>
                            <p className={`text-xs font-bold leading-none ${accent.text}`}>{proj.year}</p>
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-semibold text-sm leading-snug">{proj.title}</p>
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0 ${statusMeta.badge}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${statusMeta.dot}`} />
                              {statusMeta.label}
                            </span>
                          </div>
                          {proj.client && (
                            <p className="text-xs text-muted-foreground mt-0.5">{proj.client}</p>
                          )}
                          {proj.description && (
                            <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2 leading-relaxed">
                              {proj.description}
                            </p>
                          )}
                        </div>
                      </div>
                      {((proj.domains ?? []).length > 0 || (proj.technologies ?? []).length > 0) && (
                        <div className="px-4 py-2.5 border-t bg-background/40 flex flex-wrap gap-1.5">
                          {(proj.domains ?? []).map((d) => (
                            <span key={d} className="rounded-md bg-muted text-muted-foreground px-2 py-0.5 text-xs">{d}</span>
                          ))}
                          {(proj.technologies ?? []).map((t) => (
                            <span key={t} className="rounded-md bg-primary/10 text-primary px-2 py-0.5 text-xs">{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Aucun projet de l'entreprise n'est encore rattaché à ce profil.
                  {isAdmin && " Utilisez « Rattacher à un projet » pour l'associer à un projet existant."}
                </p>
              )}
            </SectionCard>

            {/* Formation */}
            {(diplomas.length > 0 || person.education) && (
              <SectionCard title="Formation & diplômes" icon={<GraduationCap className="h-4.5 w-4.5" />} count={diplomas.length || undefined}>
                <div className="space-y-2.5">
                  {diplomas.map((d, i) => {
                    const obj: PersonnelDiploma =
                      typeof d === "string"
                        ? { degree: d, field: "" }
                        : (d as PersonnelDiploma);
                    return (
                      <div key={i} className="flex items-center gap-3 rounded-lg border bg-muted/20 px-4 py-3">
                        <div className={`h-9 w-9 rounded-lg shrink-0 flex items-center justify-center ${accent.bg}`}>
                          <GraduationCap className={`h-4 w-4 ${accent.text}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium leading-snug">{obj.degree}</p>
                          {obj.field && <p className="text-xs text-muted-foreground mt-0.5">{obj.field}</p>}
                        </div>
                        {obj.years_experience != null && (
                          <div className="shrink-0 text-right">
                            <p className="text-sm font-semibold tabular-nums">{obj.years_experience}</p>
                            <p className="text-[11px] text-muted-foreground">ans exp.</p>
                          </div>
                        )}
                        {obj.file && (
                          <a
                            href={`${getApiBaseUrl()}/uploads/diplomas/${obj.file.filename}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`shrink-0 h-8 w-8 rounded-lg flex items-center justify-center transition-colors hover:opacity-75 ${accent.bg}`}
                            title={`Télécharger le scan : ${obj.file.originalname}`}
                          >
                            <Download className={`h-4 w-4 ${accent.text}`} />
                          </a>
                        )}
                      </div>
                    );
                  })}
                  {diplomas.length === 0 && person.education && (
                    <p className="text-sm text-foreground/75">{person.education}</p>
                  )}
                </div>
              </SectionCard>
            )}

            {/* Compétences */}
            {skills.length > 0 && (
              <SectionCard title="Compétences techniques" icon={<Layers className="h-4.5 w-4.5" />} count={skills.length}>
                <div className="flex flex-wrap gap-2">
                  {skills.map((s) => (
                    <span key={s} className="rounded-lg border bg-muted/40 text-foreground/75 px-3 py-1.5 text-sm font-medium">
                      {s}
                    </span>
                  ))}
                </div>
              </SectionCard>
            )}

            {/* Certifications — colonne principale si > 2 */}
            {certs.length > 2 && (
              <SectionCard title="Certifications professionnelles" icon={<Award className="h-4.5 w-4.5" />} count={certs.length}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {certs.map((c) => (
                    <div key={c} className="flex items-center gap-2.5 rounded-lg border bg-amber-500/5 border-amber-200/50 dark:border-amber-800/30 px-3.5 py-2.5">
                      <Star className="h-4 w-4 text-amber-500 shrink-0" />
                      <span className="text-sm font-medium text-amber-800 dark:text-amber-300">{c}</span>
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}
          </div>

          {/* Colonne latérale (1/3) */}
          <div className="space-y-5">

            {/* CVs : visualisation, téléchargement et ajout */}
            <SectionCard
              title="Curriculum Vitae"
              icon={<FileText className="h-4.5 w-4.5" />}
              count={cvFiles.length > 0 ? cvFiles.length : undefined}
            >
              <div className="space-y-3">
                <input
                  ref={cvInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  className="hidden"
                  onChange={handleCvUpload}
                />
                {cvFiles.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucun CV pour ce profil.</p>
                ) : (
                  <div className="space-y-2">
                    {cvFiles.map((cv: PersonnelCv, i) => {
                      const url = `${getApiBaseUrl()}/uploads/cv/${cv.filename}`;
                      return (
                        <div key={i} className="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2.5">
                          <div className={`h-9 w-9 rounded-lg shrink-0 flex items-center justify-center ${accent.bg}`}>
                            <FileText className={`h-4 w-4 ${accent.text}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate leading-snug">{cv.originalname}</p>
                            {cv.uploaded_at && (
                              <p className="text-[11px] text-muted-foreground mt-0.5">
                                {new Date(cv.uploaded_at).toLocaleDateString("fr-FR", {
                                  day: "numeric",
                                  month: "short",
                                  year: "numeric",
                                })}
                              </p>
                            )}
                          </div>
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-muted/60 transition-colors shrink-0"
                            title="Visualiser le CV"
                          >
                            <Eye className="h-4 w-4" />
                          </a>
                          <button
                            type="button"
                            onClick={() => downloadFile(url, cv.originalname)}
                            className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-muted/60 transition-colors shrink-0"
                            title="Télécharger le CV"
                          >
                            <Download className="h-4 w-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                {isAdmin && (
                  <div className="flex items-center gap-3 border-t pt-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-2 h-8 text-xs"
                      onClick={() => cvInputRef.current?.click()}
                      disabled={!canEdit || cvUploading || cvFiles.length >= MAX_CV}
                      title={canEdit ? "Téléverser un CV (PDF)" : "Profil complet en cours de chargement…"}
                    >
                      {cvUploading
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Upload className="h-3.5 w-3.5" />}
                      Ajouter un CV
                    </Button>
                    <p className="text-[11px] text-muted-foreground">
                      {cvFiles.length >= MAX_CV
                        ? "Limite de 3 CVs atteinte"
                        : `PDF · 10 Mo max · ${cvFiles.length}/${MAX_CV}`}
                    </p>
                  </div>
                )}
              </div>
            </SectionCard>

            {/* Certifications — colonne si ≤ 2 */}
            {certs.length > 0 && certs.length <= 2 && (
              <SectionCard title="Certifications" icon={<Award className="h-4.5 w-4.5" />}>
                <div className="space-y-2">
                  {certs.map((c) => (
                    <div key={c} className="flex items-center gap-2.5 rounded-lg border bg-amber-500/5 border-amber-200/50 dark:border-amber-800/30 px-3.5 py-2.5">
                      <Star className="h-4 w-4 text-amber-500 shrink-0" />
                      <span className="text-sm font-medium text-amber-800 dark:text-amber-300">{c}</span>
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}

            {/* Domaines & technologies pratiqués — dérivés des projets rattachés */}
            {(projectDomains.length > 0 || projectTechs.length > 0) && (
              <SectionCard title="Pratiqué sur projets" icon={<Briefcase className="h-4.5 w-4.5" />}>
                <div className="space-y-3">
                  {projectDomains.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1.5">Domaines</p>
                      <div className="flex flex-wrap gap-1">
                        {projectDomains.map((d) => (
                          <span key={d} className="rounded-md bg-muted text-muted-foreground px-2 py-0.5 text-xs font-medium">{d}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {projectTechs.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1.5">Technologies</p>
                      <div className="flex flex-wrap gap-1">
                        {projectTechs.map((t) => (
                          <span
                            key={t}
                            title={skillSet.has(t.toLowerCase())
                              ? "Présente dans ses compétences déclarées"
                              : "Utilisée sur un projet mais absente de ses compétences déclarées"}
                            className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                              skillSet.has(t.toLowerCase())
                                ? "bg-primary/10 text-primary"
                                : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                            }`}
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1.5">
                        En ambre : technologies de projets absentes des compétences déclarées.
                      </p>
                    </div>
                  )}
                </div>
              </SectionCard>
            )}

            {/* Fiche récapitulative */}
            <SectionCard title="Informations" icon={<Calendar className="h-4.5 w-4.5" />}>
              <dl className="space-y-3 text-sm">
                {person.availability && (
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground shrink-0">Disponibilité</dt>
                    <dd className="font-medium text-right">{person.availability}</dd>
                  </div>
                )}
                {person.location && (
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground shrink-0">Localisation</dt>
                    <dd className="font-medium text-right">{person.location}</dd>
                  </div>
                )}
                {person.years_experience != null && (
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground shrink-0">Expérience</dt>
                    <dd className="font-medium text-right">{person.years_experience} ans</dd>
                  </div>
                )}
                {person.projects_count != null && (
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground shrink-0">Projets (déclaré)</dt>
                    <dd className="font-medium text-right">{person.projects_count}</dd>
                  </div>
                )}
                {linkedProjects.length > 0 && (
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground shrink-0 flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5 shrink-0" /> Dans l'entreprise
                    </dt>
                    <dd className="font-medium text-right">{linkedProjects.length} projet{linkedProjects.length > 1 ? "s" : ""}</dd>
                  </div>
                )}
                {activitySpan && (
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground shrink-0">Période d'activité</dt>
                    <dd className="font-medium text-right">{activitySpan}</dd>
                  </div>
                )}
                {person.success_rate != null && (
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground shrink-0">Taux de réussite (déclaré)</dt>
                    <dd className="font-medium text-right">{person.success_rate}%</dd>
                  </div>
                )}
              </dl>
            </SectionCard>

          </div>
        </div>
      </div>

      {/* ── Dialog : modification du profil ── */}
      <PersonnelFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        initial={clonePersonnel(person)}
        onSave={savePerson}
        isEdit
        techOptions={catalogTechs}
      />

      {/* ── Dialog : rattachement à des projets existants ── */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Rattacher {person.name} à des projets</DialogTitle>
            <DialogDescription>
              Sélectionnez les projets existants de l'entreprise auxquels cet expert a contribué.
              La création de nouveaux projets se fait dans Paramètres &gt; Entreprise &gt; Projets de référence.
            </DialogDescription>
          </DialogHeader>
          {assignDraft.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              Aucun projet de référence n'existe encore. Créez d'abord des projets dans
              Paramètres &gt; Entreprise, puis revenez rattacher cet expert.
            </p>
          ) : (
            <ScrollArea className="max-h-[55vh]">
              <div className="grid grid-cols-1 gap-1.5 pr-3">
                {assignDraft.map((proj, idx) => {
                  const selected = (proj.personnel_names ?? []).includes(person.name);
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => toggleAssign(idx)}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                        selected
                          ? "border-primary/40 bg-primary/5"
                          : "border-border bg-muted/10 hover:bg-muted/30"
                      }`}
                    >
                      {proj.year && (
                        <div className="rounded-lg bg-primary/10 px-2 py-1 text-center shrink-0">
                          <p className="text-[11px] font-bold text-primary leading-none">{proj.year}</p>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-snug truncate">{proj.title}</p>
                        {proj.client && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">{proj.client}</p>
                        )}
                      </div>
                      <div className={`h-4 w-4 rounded border shrink-0 flex items-center justify-center transition-colors ${selected ? "bg-primary border-primary" : "border-muted-foreground/40"}`}>
                        {selected && (
                          <svg className="h-2.5 w-2.5 text-primary-foreground" fill="none" viewBox="0 0 10 10">
                            <path d="M1.5 5L4 7.5 8.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAssignOpen(false)} disabled={saving}>Annuler</Button>
            <Button type="button" onClick={saveAssign} disabled={saving || assignDraft.length === 0} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
