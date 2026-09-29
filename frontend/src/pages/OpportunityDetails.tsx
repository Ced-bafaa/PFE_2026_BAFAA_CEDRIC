import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  listPathWithPage,
  parseListReturnFromSearch,
  type OpportunityListReturn,
} from "@/lib/opportunity-routes";
import type { Opportunity } from "@/lib/types";
import {
  ArrowLeft, Calendar, Banknote, MapPin, Tag, Star, FileText,
  Download, ExternalLink, CheckCircle2, XCircle, AlertTriangle,
  Bot, ChevronDown, ChevronUp, ChevronRight, RefreshCw, Users, Building2, CalendarX,
  Bell, BellOff,
} from "lucide-react";

function personInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { OpportunityScoreBadge } from "@/components/OpportunityScoreBadge";
import { OpportunityExtractedDetailsPanel } from "@/components/OpportunityExtractedDetails";
import { hasDecisionScore, scoreBand } from "@/lib/opportunity-decision";
import { isDeadlinePassed } from "@/lib/opportunity-deadline";
import { RecommendationBadge } from "@/components/RecommendationBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { markOpportunityAsRead } from "@/lib/read-opportunities";
import {
  downloadOpportunityJustificatif,
  fetchFavoriteOpportunityIds,
  fetchOpportunity,
  getOpportunityJustificatifPdfUrl,
  scoreOpportunity,
  toggleOpportunityFavorite,
} from "@/lib/opportunities-api";
import { apiJson } from "@/lib/api";
import { isOppMuted, toggleOppMute } from "@/lib/notifications-store";
import { toast } from "sonner";

/**
 * Transforme les occurrences de noms du personnel connu (texte libre issu de
 * Groq) en liens cliquables vers leur profil. Les noms les plus longs sont
 * testés en premier pour éviter les correspondances partielles.
 */
function linkifyPersonnel(text: string | undefined, names: string[]): React.ReactNode {
  if (!text) return text ?? null;
  const valid = names.filter((n) => n && n.trim().length > 1);
  if (valid.length === 0) return text;
  const sorted = [...valid].sort((a, b) => b.length - a.length);
  const escaped = sorted.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "g");
  const parts = text.split(re);
  return parts.map((part, i) => {
    if (sorted.includes(part)) {
      return (
        <Link
          key={i}
          to={`/settings/personnel/${encodeURIComponent(part)}`}
          className="text-primary font-medium hover:underline"
          title={`Voir le profil de ${part}`}
        >
          {part}
        </Link>
      );
    }
    return part;
  });
}

// ─── Utilitaires ──────────────────────────────────────────────────────────────

function extractDocLinks(description: string): { href: string; title: string }[] {
  const out: { href: string; title: string }[] = [];
  const lines = description.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([^:]{2,50})\s*:\s*(https?:\/\/\S+)\s*$/i);
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    const href = m[2].trim().replace(/[).,;:!?]+$/, "");
    const isFiche = key.includes("fiche armp");
    const isDl = key.includes("téléchargement") || key.includes("telechargement");
    if (isFiche || isDl) {
      out.push({ href, title: isFiche ? "Fiche ARMP" : "Télécharger le DAO" });
    }
  }
  // Also catch bare URLs in description
  const urlRe = /\bhttps?:\/\/[^\s<]+\.pdf[^\s<]*/gi;
  for (const match of description.matchAll(urlRe)) {
    const href = match[0].replace(/[).,;:!?]+$/, "");
    if (!out.find((d) => d.href === href)) {
      out.push({ href, title: "Ouvrir le PDF" });
    }
  }
  return out;
}

type ParsedDescription = {
  meta: { label: string; value: string }[];
  body: string;
};

function parseDescription(raw: string): ParsedDescription {
  const META_KEYS: { pattern: RegExp; label: string }[] = [
    { pattern: /mo\/ac|autorité|autorite|maître d.ouvrage/i, label: "Autorité contractante" },
    { pattern: /^type$/i, label: "Type" },
    { pattern: /région|region/i, label: "Région" },
    { pattern: /clôture|cloture|closing date/i, label: "Date de clôture" },
    { pattern: /heure de clôture|closing time/i, label: "Heure de clôture" },
    { pattern: /financement/i, label: "Financement" },
  ];

  const lines = raw.split(/\r?\n/);
  const meta: { label: string; value: string }[] = [];
  const consumed = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const m = line.match(/^\s*([^:]{2,60})\s*:\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1].trim();
    const val = (m[2] ?? "").trim();

    // Skip URL lines
    if (/^https?:\/\//i.test(val)) { consumed.add(i); continue; }
    if (!val) { consumed.add(i); continue; }

    const match = META_KEYS.find((mk) => mk.pattern.test(key));
    if (match) {
      meta.push({ label: match.label, value: val });
      consumed.add(i);
    }
  }

  const body = lines
    .filter((_, idx) => !consumed.has(idx))
    .filter((l) => !/^\s*([^:]{2,50})\s*:\s*(https?:\/\/)/i.test(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { meta, body };
}

// ─── Composants helpers ───────────────────────────────────────────────────────

/** Formate une date ISO (yyyy-mm-dd) en français court (ex. « 06 oct. 2026 »). */
function formatDateFr(v: string | undefined): string {
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
    }
  }
  return s;
}

function InfoChip({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  if (!value?.trim() || value === "—") return null;
  // Valeur « vide de sens » (non communiqué / non précisé…) → rendu atténué.
  const isPlaceholder = /communiqu|pr[ée]cis|d[ée]fini|inconnu|non\s|à\s+d[ée]finir/i.test(value);
  return (
    <div className="flex items-start gap-2.5 rounded-lg border bg-muted/20 px-3 py-2">
      <div className="mt-0.5 h-7 w-7 rounded-md bg-background flex items-center justify-center shrink-0">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`text-sm leading-snug break-words ${isPlaceholder ? "italic text-muted-foreground" : "font-medium"}`}>
          {value}
        </p>
      </div>
    </div>
  );
}

function Collapsible({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border bg-muted/10">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/20 transition-colors rounded-lg"
      >
        {title}
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && <div className="px-4 pb-4 pt-1">{children}</div>}
    </div>
  );
}


// ─── Section : Conformité aux critères éliminatoires du DAO ──────────────────

function fmtCritValue(v: string | number): string {
  return typeof v === "number" ? `${new Intl.NumberFormat("fr-FR").format(v)} FCFA` : v;
}

const MCDA_LABELS: Record<string, string> = {
  adequation_technique: "Adéquation technique",
  capacite_financiere: "Capacité financière",
  valeur_marche: "Valeur du marché",
  faisabilite_delai: "Faisabilité du délai",
  fiabilite_financement: "Fiabilité du financement",
};
const MCDA_ORDER = [
  "adequation_technique", "capacite_financiere", "valeur_marche",
  "faisabilite_delai", "fiabilite_financement",
];

type McdaCriterion = { poids?: number; valeur?: number; detail?: string };

// Seuils métier : traduisent la note et le poids en langage clair (tout public).
function noteBand(v: number): "fort" | "moyen" | "faible" {
  if (v >= 0.75) return "fort";
  if (v >= 0.5) return "moyen";
  return "faible";
}
function importanceLabel(w: number): string {
  if (w >= 0.25) return "élevée";
  if (w >= 0.1) return "moyenne";
  return "faible";
}
const NOTE_STATUS: Record<
  "fort" | "moyen" | "faible",
  { word: string; cls: string; Icon: typeof CheckCircle2 }
> = {
  fort: { word: "Fort", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-300/50", Icon: CheckCircle2 },
  moyen: { word: "Moyen", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-300/50", Icon: AlertTriangle },
  faible: { word: "Faible", cls: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-300/50", Icon: XCircle },
};

/** Ligne d'un critère : appréciation claire, dépliable au clic pour le détail chiffré. */
function McdaCriterionRow({ label, c }: { label: string; c: McdaCriterion }) {
  const [open, setOpen] = useState(false);
  const valeur = c.valeur ?? 0;
  const poids = c.poids ?? 0;
  const status = NOTE_STATUS[noteBand(valeur)];
  const StatusIcon = status.Icon;
  const note = Math.round(valeur * 100);
  const poidsPct = Math.round(poids * 100);
  const pts = Math.round(poids * valeur * 100);
  return (
    <div className="border-t first:border-t-0 px-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 py-2.5 text-left"
      >
        <span className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span>
            <span className="block text-xs font-medium">{label}</span>
            <span className="block text-[11px] text-muted-foreground">
              Importance {importanceLabel(poids)}
            </span>
          </span>
        </span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${status.cls}`}
        >
          <StatusIcon className="h-3.5 w-3.5" /> {status.word}
        </span>
      </button>
      {open && (
        <div className="space-y-2 pb-3 pl-6">
          {c.detail && <p className="text-[11px] text-muted-foreground">{c.detail}</p>}
          <div className="flex flex-wrap gap-1.5 text-[10px]">
            <span className="rounded bg-muted px-2 py-0.5">
              Importance (poids) <b className="font-medium">{poidsPct}%</b>
            </span>
            <span className="rounded bg-muted px-2 py-0.5">
              Notre position (note) <b className="font-medium">{note}%</b>
            </span>
            <span className="rounded bg-muted px-2 py-0.5">
              Apport au score <b className="font-medium">{pts} pts</b>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function McdaSection({ opp }: { opp: Opportunity }) {
  const m = opp.mcda;
  const experts = opp.recommendedExperts ?? [];
  const partners = opp.recommendedPartners ?? [];
  const groupementSuggere = opp.recommendation === "groupement";
  if (!m && experts.length === 0 && partners.length === 0) return null;

  return (
    <div className="rounded-xl border bg-background p-4 space-y-4">
      {m && (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Décision · analyse par critère</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Aide à la décision multicritère (méthode AHP). Cliquez sur un critère pour voir le détail.
              </p>
            </div>
            <div className="text-2xl font-bold tabular-nums leading-none shrink-0">
              {Math.round(m.score)}
              <span className="text-sm font-normal text-muted-foreground">/100</span>
            </div>
          </div>
          {(() => {
            const band = scoreBand(m.score);
            const cfg =
              band === "high"
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-300/50"
                : band === "medium"
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-300/50"
                : "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-300/50";
            return (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold capitalize ${cfg}`}
              >
                {m.recommandation || m.verdict}
              </span>
            );
          })()}
          {(() => {
            const present = MCDA_ORDER.filter((k) => m.criteres?.[k]);
            const forts = present
              .filter((k) => noteBand(m.criteres[k].valeur ?? 0) === "fort")
              .map((k) => MCDA_LABELS[k] ?? k);
            const surveiller = present
              .filter((k) => noteBand(m.criteres[k].valeur ?? 0) !== "fort")
              .sort((a, b) => (m.criteres[a].valeur ?? 0) - (m.criteres[b].valeur ?? 0))
              .map((k) => MCDA_LABELS[k] ?? k);
            if (forts.length === 0 && surveiller.length === 0) return null;
            return (
              <div className="flex flex-wrap gap-2">
                {forts.length > 0 && (
                  <div className="flex-1 min-w-[160px] rounded-lg bg-muted/60 px-3 py-2">
                    <p className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Points forts
                    </p>
                    <p className="mt-0.5 text-xs">{forts.join(", ")}</p>
                  </div>
                )}
                {surveiller.length > 0 && (
                  <div className="flex-1 min-w-[160px] rounded-lg bg-muted/60 px-3 py-2">
                    <p className="flex items-center gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="h-3.5 w-3.5" /> À surveiller
                    </p>
                    <p className="mt-0.5 text-xs">{surveiller.join(", ")}</p>
                  </div>
                )}
              </div>
            );
          })()}
          <div className="rounded-lg border">
            {MCDA_ORDER.filter((k) => m.criteres?.[k]).map((k) => (
              <McdaCriterionRow key={k} label={MCDA_LABELS[k] ?? k} c={m.criteres[k]} />
            ))}
          </div>
        </div>
      )}

      {experts.length > 0 && (
        <div className="pt-3 border-t space-y-2">
          <div>
            <h3 className="text-sm font-semibold">Personnel recommandé</h3>
            <p className="text-[11px] text-muted-foreground">
              Cliquez sur un profil pour voir ses réalisations et ses détails.
            </p>
          </div>
          <div className="space-y-1.5">
            {experts.map((e) => (
              <Link
                key={e.name}
                to={`/settings/personnel/${encodeURIComponent(e.name)}`}
                className="group flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors hover:border-primary/50 hover:bg-primary/5"
              >
                <div className="h-8 w-8 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center shrink-0">
                  {personInitials(e.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-primary group-hover:underline">
                    {e.name}
                  </span>
                  <p className="text-xs text-muted-foreground truncate">{e.role}</p>
                  {e.competences_match?.length > 0 && (
                    <p className="text-[10px] text-muted-foreground truncate">
                      {e.competences_match.join(", ")}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs tabular-nums text-muted-foreground whitespace-nowrap">
                    {Math.round((e.fit ?? 0) * 100)}%
                    {e.disponibilite ? ` · ${e.disponibilite}` : ""}
                  </span>
                  <span className="hidden sm:inline text-[11px] font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                    Voir le profil
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {partners.length > 0 && (
        <div className="pt-3 border-t space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Partenaires recommandés (groupement)</h3>
              <p className="text-[11px] text-muted-foreground">
                Entreprises complémentaires qui comblent vos lacunes sur cet appel d'offres.
              </p>
            </div>
            {groupementSuggere && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/50 bg-amber-500/15 text-amber-700 dark:text-amber-400 px-2.5 py-1 text-[11px] font-semibold shrink-0">
                Groupement conseillé
              </span>
            )}
          </div>
          <div className="space-y-1.5">
            {partners.map((p) => (
              <Link
                key={p.id}
                to={`/partners?focus=${encodeURIComponent(p.id)}`}
                className="group flex items-start gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors hover:border-primary/50 hover:bg-primary/5"
              >
                <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Building2 className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-primary group-hover:underline">
                    {p.company_name || p.id}
                  </span>
                  {(p.comble ?? []).length > 0 ? (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Comble : <span className="text-foreground/80">{(p.comble ?? []).join(", ")}</span>
                    </p>
                  ) : (p.domaines_match ?? []).length > 0 ? (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Domaines : {(p.domaines_match ?? []).join(", ")}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs tabular-nums text-muted-foreground whitespace-nowrap">
                    {Math.round((p.fit ?? 0) * 100)}%
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EligibilitySection({ opp }: { opp: Opportunity }) {
  const elig = opp.eligibility;
  if (!elig || !elig.applicable) return null;
  const perso = elig.personnel;
  const showPersonnel = perso?.applicable && (perso.roles ?? []).length > 0;

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b bg-muted/20">
        <div className="flex items-center gap-2.5">
          <Users className="h-4 w-4 text-muted-foreground" />
          <div>
            <h3 className="font-semibold text-sm">Conformité aux exigences du DAO</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Critères éliminatoires extraits du dossier — évaluation déterministe, hors IA.
            </p>
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold shrink-0 ${
            elig.eligible
              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
              : "bg-rose-500/15 text-rose-700 dark:text-rose-400"
          }`}
        >
          {elig.eligible ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
          {elig.eligible ? "Conforme" : "Non conforme"}
        </span>
      </div>

      <div className="p-5 space-y-4">
        {/* Critères au format homogène */}
        <div className="space-y-1.5">
          {elig.criteres.map((c) => (
            <div
              key={c.id}
              className={`flex items-start gap-3 rounded-lg border px-3.5 py-2.5 ${
                c.satisfait ? "bg-muted/20" : "border-rose-300/50 bg-rose-500/5"
              }`}
              title={c.detail || undefined}
            >
              {c.satisfait
                ? <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                : <XCircle className="h-4 w-4 text-rose-600 dark:text-rose-400 mt-0.5 shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-snug">{c.libelle}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Exigé : <span className="font-medium text-foreground/80">{fmtCritValue(c.exigence)}</span>
                  <span className="mx-1.5 text-muted-foreground/50">·</span>
                  Capacité : <span className="font-medium text-foreground/80">{fmtCritValue(c.capacite)}</span>
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Détail par rôle de personnel exigé */}
        {showPersonnel && (
          <div className="space-y-2 border-t pt-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Personnel exigé
              </p>
              <span className="text-xs text-muted-foreground">
                {perso.covered_count}/{perso.required_count} rôle{perso.required_count > 1 ? "s" : ""} couvert{perso.covered_count > 1 ? "s" : ""}
              </span>
            </div>
            {perso.roles.map((role, i) => {
              const bestMiss = role.covered ? null : role.candidates?.[0];
              return (
                <div key={i} className="rounded-lg border bg-muted/10 px-3.5 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{role.poste}</p>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium shrink-0 ${
                        role.covered
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                          : "bg-rose-500/15 text-rose-700 dark:text-rose-400"
                      }`}
                    >
                      {role.covered ? "Couvert" : "Non couvert"}
                    </span>
                  </div>
                  {role.covered && role.qualified_experts.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Qualifié{role.qualified_experts.length > 1 ? "s" : ""} :{" "}
                      <span className="font-medium text-foreground/80">{role.qualified_experts.join(", ")}</span>
                    </p>
                  )}
                  {!role.covered && bestMiss && (
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      Meilleur candidat : <span className="font-medium text-foreground/80">{bestMiss.name}</span>
                      {" — manque : "}
                      {bestMiss.missing.join(" ; ")}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Section : Analyse qualitative Groq ───────────────────────────────────────

function OllamaSection({ opp, onReanalysed }: { opp: Opportunity; onReanalysed?: () => void }) {
  const qa = opp.qualitativeAnalysis;
  const [reanalysing, setReanalysing] = useState(false);
  const [personnelNames, setPersonnelNames] = useState<string[]>([]);

  // Noms du personnel clé (pour rendre cliquables les experts cités par Groq).
  useEffect(() => {
    let cancelled = false;
    apiJson<{ personnel?: Array<{ name?: string }> }>("/settings/company")
      .then((profile) => {
        if (cancelled) return;
        const names = (profile.personnel ?? [])
          .map((p) => (typeof p?.name === "string" ? p.name.trim() : ""))
          .filter(Boolean);
        setPersonnelNames(names);
      })
      .catch(() => {
        /* profil indisponible : on laisse le texte brut */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleReanalyse = async () => {
    setReanalysing(true);
    try {
      await scoreOpportunity(opp.id);
      toast.success("Analyse relancée — rechargement en cours…");
      onReanalysed?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("503") || msg.toLowerCase().includes("503")) {
        toast.error("Decision Engine inaccessible (port 8765). Vérifiez que uvicorn est démarré.");
      } else if (msg.toLowerCase().includes("groq") || msg.toLowerCase().includes("api_key")) {
        toast.error("Groq indisponible. Vérifiez GROQ_API_KEY dans l'environnement du decision engine.");
      } else {
        toast.error(`Échec : ${msg.slice(0, 120)}`);
      }
    } finally {
      setReanalysing(false);
    }
  };

  if (!qa?.ollama_available) {
    return (
      <div className="rounded-xl border border-dashed bg-muted/10 p-6 text-center space-y-3">
        <Bot className="h-8 w-8 mx-auto text-muted-foreground/40" />
        <div>
          <p className="text-sm text-muted-foreground font-medium">
            Analyse de conformité non disponible
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            L'analyse Groq n'a pas pu être effectuée lors du scoring.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleReanalyse}
          disabled={reanalysing}
          className="gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${reanalysing ? "animate-spin" : ""}`} />
          {reanalysing ? "Analyse en cours…" : "Re-analyser avec Groq"}
        </Button>
        <p className="text-[10px] text-muted-foreground/40">
          Nécessite GROQ_API_KEY configurée dans le decision engine
        </p>
      </div>
    );
  }

  const statusColor = {
    ok: "border-green-300 bg-green-50 dark:bg-green-950/20",
    warning: "border-yellow-300 bg-yellow-50 dark:bg-yellow-950/20",
    blocking: "border-red-300 bg-red-50 dark:bg-red-950/20",
  };
  const StatusIcon = {
    ok: <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />,
    warning: <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />,
    blocking: <XCircle className="h-4 w-4 text-red-500 shrink-0" />,
  };

  const blockingCount = qa.checks.filter((c) => c.status === "blocking").length;
  const warningCount = qa.checks.filter((c) => c.status === "warning").length;
  const okCount = qa.checks.filter((c) => c.status === "ok").length;

  return (
    <div className="rounded-xl border bg-muted/10 p-5 space-y-5">
      {/* En-tête */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-base">Analyse de conformité</h3>
          <span className="text-xs text-muted-foreground">IA · Groq / Llama 3.1</span>
        </div>
        {opp.decisionScoredAt && (
          <span className="text-xs text-muted-foreground">
            {new Date(opp.decisionScoredAt).toLocaleString("fr-FR")}
          </span>
        )}
      </div>

      {/* Résumé */}
      {qa.resume && (
        <p className="text-sm leading-relaxed border-l-2 border-primary/50 pl-3 italic text-foreground/80">
          {linkifyPersonnel(qa.resume, personnelNames)}
        </p>
      )}

      {/* Compteurs */}
      {qa.checks.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {okCount > 0 && (
            <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50 dark:bg-green-950/20 gap-1">
              <CheckCircle2 className="h-3 w-3" /> {okCount} conforme{okCount > 1 ? "s" : ""}
            </Badge>
          )}
          {warningCount > 0 && (
            <Badge variant="outline" className="text-yellow-700 border-yellow-300 bg-yellow-50 dark:bg-yellow-950/20 gap-1">
              <AlertTriangle className="h-3 w-3" /> {warningCount} à vérifier
            </Badge>
          )}
          {blockingCount > 0 && (
            <Badge variant="outline" className="text-red-700 border-red-300 bg-red-50 dark:bg-red-950/20 gap-1">
              <XCircle className="h-3 w-3" /> {blockingCount} bloquant{blockingCount > 1 ? "s" : ""}
            </Badge>
          )}
        </div>
      )}

      {/* Points forts / bloquants */}
      {(qa.points_forts.length > 0 || qa.points_bloquants.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {qa.points_forts.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-green-700 dark:text-green-400 flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" /> Points forts
              </p>
              <ul className="space-y-1">
                {qa.points_forts.map((pt, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                    <span className="text-green-500 shrink-0">•</span> {pt}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {qa.points_bloquants.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-red-600 dark:text-red-400 flex items-center gap-1">
                <XCircle className="h-3.5 w-3.5" /> Points bloquants
              </p>
              <ul className="space-y-1">
                {qa.points_bloquants.map((pt, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                    <span className="text-red-500 shrink-0">•</span> {pt}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Checks détaillés : AO vs KIAMA */}
      {qa.checks.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Comparaison exigences AO vs profil KIAMA
          </p>
          {qa.checks.map((check, i) => (
            <div
              key={i}
              className={`rounded-lg border p-3 space-y-2 ${statusColor[check.status] ?? ""}`}
            >
              <div className="flex items-center gap-2 flex-wrap">
                {StatusIcon[check.status]}
                <span className="text-sm font-medium">{check.label}</span>
                <Badge variant="outline" className="text-[10px] h-5 ml-auto capitalize">
                  {check.type}
                </Badge>
              </div>

              {check.detail && (
                <p className="text-xs text-muted-foreground pl-6">
                  {linkifyPersonnel(check.detail, personnelNames)}
                </p>
              )}

              {(check.exigence || check.profil) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pl-6 pt-1">
                  {check.exigence && (
                    <div className="rounded-md bg-background/60 p-2 space-y-0.5">
                      <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Ce que l'AO exige</p>
                      <p className="text-xs">{check.exigence}</p>
                    </div>
                  )}
                  {check.profil && (
                    <div className="rounded-md bg-background/60 p-2 space-y-0.5">
                      <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Ce que KIAMA possède</p>
                      <p className="text-xs">{linkifyPersonnel(check.profil, personnelNames)}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────

export default function OpportunityDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const listReturn = useMemo((): OpportunityListReturn | null => {
    const fromQuery = parseListReturnFromSearch(searchParams);
    if (fromQuery) return fromQuery;
    const st = location.state as { listReturn?: OpportunityListReturn } | null;
    return st?.listReturn ?? null;
  }, [searchParams, location.state]);

  const listBackPath = listReturn ? listPathWithPage(listReturn) : "/opportunities";

  const [opportunity, setOpportunity] = useState<Opportunity | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isFavorite, setIsFavorite] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoadError(null);
    void (async () => {
      try {
        const item = await fetchOpportunity(id);
        if (!cancelled) setOpportunity(item);
      } catch (e) {
        if (!cancelled) {
          setOpportunity(null);
          setLoadError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [id, refreshKey]);

  useEffect(() => { if (id) void markOpportunityAsRead(id); }, [id]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void fetchFavoriteOpportunityIds().then((ids) => {
      if (!cancelled) setIsFavorite(ids.includes(id));
    });
    return () => { cancelled = true; };
  }, [id, refreshKey]);

  const handleFavoriteToggle = () => {
    if (!id) return;
    void (async () => {
      const next = await toggleOpportunityFavorite(id);
      setIsFavorite(next);
      setRefreshKey((v) => v + 1);
    })();
  };

  const handleGoBack = () => navigate(listReturn ? listBackPath : "/opportunities", {
    state: listReturn ? { restoreList: true } : undefined,
  });

  if (opportunity === undefined) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  if (!opportunity || loadError) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Opportunité introuvable</h1>
        <p className="text-sm text-muted-foreground">
          {loadError ? loadError : "L'opportunité demandée n'existe pas ou n'est plus disponible."}
        </p>
        <Button variant="outline" onClick={handleGoBack}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Retour
        </Button>
      </div>
    );
  }

  const docLinks = extractDocLinks(opportunity.description);
  const parsedDesc = parseDescription(opportunity.description);

  return (
    <div className="space-y-5">

      {/* ── Navigation ── */}
      <div className="flex items-center justify-between gap-4">
        <Button variant="ghost" size="sm" onClick={handleGoBack} className="gap-1.5 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Retour
        </Button>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              toggleOppMute(opportunity.id);
              setRefreshKey((v) => v + 1);
            }}
            className={isOppMuted(opportunity.id) ? "text-foreground" : "text-muted-foreground"}
          >
            {isOppMuted(opportunity.id) ? (
              <>
                <BellOff className="h-4 w-4 mr-1" /> Notifications en silence
              </>
            ) : (
              <>
                <Bell className="h-4 w-4 mr-1" /> Mettre en silence
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleFavoriteToggle}
            className={isFavorite ? "text-yellow-500 hover:text-yellow-500" : "text-muted-foreground"}
          >
            <Star className={`h-4 w-4 mr-1 ${isFavorite ? "fill-yellow-400" : ""}`} />
            {isFavorite ? "Pertinent" : "Marquer pertinent"}
          </Button>
        </div>
      </div>

      {/* ── En-tête ── */}
      <div className="kiama-surface kiama-ring rounded-xl border p-5 space-y-4 shadow-sm">

        {/* Titre + badges */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={opportunity.status} />
              {hasDecisionScore(opportunity) && (
                <RecommendationBadge recommendation={opportunity.recommendation} />
              )}
              {isDeadlinePassed(opportunity.deadline) && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                  <CalendarX className="h-3.5 w-3.5" /> Clôturé
                </span>
              )}
            </div>
            <h2 className="text-xl font-semibold leading-snug">{opportunity.title}</h2>
            <p className="text-xs text-muted-foreground">{opportunity.source}</p>
          </div>
          <OpportunityScoreBadge opportunity={opportunity} size="lg" />
        </div>

        {/* Infos clés */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 pt-3 border-t">
          <InfoChip icon={Calendar} label="Publication" value={formatDateFr(opportunity.publishedAt)} />
          <InfoChip icon={Calendar} label="Échéance" value={formatDateFr(opportunity.deadline)} />
          <InfoChip icon={Banknote} label="Budget" value={opportunity.budget} />
          <InfoChip icon={MapPin} label="Lieu" value={opportunity.location} />
          <InfoChip icon={Tag} label="Domaine" value={opportunity.domain} />
        </div>

        {/* Documents */}
        {docLinks.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {docLinks.map(({ href, title }) => {
              const isPdf = /\.pdf/i.test(href);
              return (
                <a
                  key={href}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm font-medium hover:bg-muted/40 transition-colors"
                >
                  {isPdf
                    ? <FileText className="h-4 w-4 text-primary" />
                    : <ExternalLink className="h-4 w-4 text-muted-foreground" />}
                  {title}
                </a>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Scoring décisionnel MCDA (critères + poids AHP) + reco personnel ── */}
      <McdaSection opp={opportunity} />

      {/* ── Conformité aux critères éliminatoires (déterministe) ── */}
      <EligibilitySection opp={opportunity} />

      {/* ── Analyse de conformité Groq (héros) ── */}
      <OllamaSection opp={opportunity} onReanalysed={() => setRefreshKey((v) => v + 1)} />

      {/* ── Données extraites du DAO (traçabilité de l'extraction) ── */}
      {opportunity.extractedDetails && (
        <Collapsible title="Données extraites du DAO — traçabilité" defaultOpen>
          <OpportunityExtractedDetailsPanel details={opportunity.extractedDetails} />
        </Collapsible>
      )}

      {/* ── Description (repliable) ── */}
      {(parsedDesc.meta.length > 0 || parsedDesc.body) && (
        <Collapsible title="Description complète">
          <div className="space-y-4">
            {parsedDesc.meta.length > 0 && (
              <div className="space-y-1.5">
                {parsedDesc.meta.map(({ label, value }) => (
                  <div key={label} className="flex gap-2 text-xs">
                    <span className="text-muted-foreground shrink-0 w-40">{label}</span>
                    <span className="font-medium">{value}</span>
                  </div>
                ))}
              </div>
            )}
            {parsedDesc.body && (
              <p className="text-xs leading-5 text-foreground/75 whitespace-pre-wrap break-words border-t pt-3">
                {parsedDesc.body}
              </p>
            )}
          </div>
        </Collapsible>
      )}

      {/* ── Justificatif de soumission ── */}
      {opportunity.status === "soumis" && opportunity.justificatifFileName && (
        <div className="rounded-xl border bg-primary/5 p-4 space-y-3">
          <p className="text-xs font-medium text-muted-foreground">Pièce justificative de soumission</p>
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm font-medium truncate">{opportunity.justificatifFileName}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm"
              onClick={() => window.open(getOpportunityJustificatifPdfUrl(opportunity.id), "_blank", "noopener,noreferrer")}>
              Ouvrir
            </Button>
            <Button variant="outline" size="sm"
              onClick={() => void downloadOpportunityJustificatif(opportunity.id, opportunity.justificatifFileName ?? "justificatif.pdf")
                .catch((e) => toast.error(e instanceof Error ? e.message : "Téléchargement impossible"))}>
              <Download className="h-3.5 w-3.5 mr-1.5" /> Télécharger
            </Button>
          </div>
        </div>
      )}

      {/* ── Retour ── */}
      <div className="flex justify-end">
        <Button asChild variant="outline">
          <Link to={listBackPath}>Retour à la liste</Link>
        </Button>
      </div>
    </div>
  );
}
