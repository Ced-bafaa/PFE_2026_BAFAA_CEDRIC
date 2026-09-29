import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  CalendarClock,
  ExternalLink,
  Save,
  Trash2,
  Clock3,
  CheckCircle2,
  AlertTriangle,
  Search,
  X,
  FileDown,
  FileSpreadsheet,
  Plus,
  Minus,
  FileText,
  Download,
  Paperclip,
  Trophy,
  RotateCcw,
  ClipboardList,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import {
  downloadOpportunityJustificatif,
  fetchOpportunities,
  getOpportunityJustificatifPdfUrl,
  submitOpportunityWithJustificatif,
} from "@/lib/opportunities-api";
import { setOpportunityStatus } from "@/lib/opportunity-status";
import { moveToTrash } from "@/lib/trash-store";
import { addAuditLog } from "@/lib/audit-logs";
import {
  getSubmissionTracking,
  getEffectivePhase,
  SubmissionPhase,
  updateSubmissionTracking,
  type TrackingLine,
} from "@/lib/submission-tracking";
import { Button } from "@/components/ui/button";
import { ConvertToReferenceDialog } from "@/components/ConvertToReferenceDialog";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PaginationControls } from "@/components/PaginationControls";
import { opportunityDetailPath } from "@/lib/opportunity-routes";
import { Segmented } from "@/components/FilterControls";
import { DatePicker } from "@/components/DatePicker";
import { cn } from "@/lib/utils";
import { exportOpportunitiesToCsv, exportOpportunitiesToPdf } from "@/lib/opportunity-export";
import type { Opportunity } from "@/lib/types";
import { toast } from "sonner";

const ITEMS_PER_PAGE = 6;

const phaseOptions: { value: SubmissionPhase; label: string }[] = [
  { value: "depose", label: "Déposé" },
  { value: "en_evaluation", label: "En évaluation" },
  { value: "clarification", label: "Clarification demandée" },
  { value: "negociation", label: "Négociation" },
  { value: "attribue", label: "Gagné" },
  { value: "rejete", label: "Rejeté" },
];

const phaseLabel: Record<SubmissionPhase, string> = {
  depose: "Déposé",
  en_evaluation: "En évaluation",
  clarification: "Clarification",
  negociation: "Négociation",
  attribue: "Gagné",
  rejete: "Rejeté",
};

const phasePillClass: Record<SubmissionPhase, string> = {
  depose: "bg-blue-500/10 text-blue-600 border-blue-500/30",
  en_evaluation: "bg-indigo-500/10 text-indigo-600 border-indigo-500/30",
  clarification: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  negociation: "bg-violet-500/10 text-violet-600 border-violet-500/30",
  attribue: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  rejete: "bg-rose-500/10 text-rose-600 border-rose-500/30",
};

type DraftLine = { phase: SubmissionPhase; notes: string[] };
type OppDraft = { lines: DraftLine[] };

function cloneTrackingToDraft(t: { lines: TrackingLine[] }): OppDraft {
  return {
    lines: t.lines.map((l) => ({
      phase: l.phase,
      notes: l.notes.length ? [...l.notes] : [""],
    })),
  };
}

function draftToTrackingLines(d: OppDraft): TrackingLine[] {
  return d.lines.map((l) => ({
    phase: l.phase,
    notes: l.notes.length > 0 ? [...l.notes] : [""],
  }));
}

/** Premier statut de la liste pas encore utilisé sur une autre ligne */
function defaultPhaseForNewLine(existingLines: DraftLine[]): SubmissionPhase | null {
  const used = new Set(existingLines.map((line) => line.phase));
  for (const opt of phaseOptions) {
    if (!used.has(opt.value)) return opt.value;
  }
  return null;
}

function persistableDraftEqualsTracking(d: OppDraft, t: { lines: TrackingLine[] }): boolean {
  return JSON.stringify(draftToTrackingLines(d)) === JSON.stringify(t.lines);
}

function phaseOptionsForRow(lines: DraftLine[], rowIndex: number) {
  return phaseOptions.filter((opt) => {
    const usedElsewhere = lines.some((line, j) => j !== rowIndex && line.phase === opt.value);
    return !usedElsewhere || lines[rowIndex].phase === opt.value;
  });
}

const STATUS_SELECT_W = "w-[208px]";

function AutoHeightNoteTextarea({
  value,
  onChange,
  className,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(36, Math.min(el.scrollHeight, 280))}px`;
  }, [value]);

  return (
    <Textarea
      ref={ref}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      rows={1}
      className={cn(
        "!min-h-9 max-h-[280px] w-full resize-y overflow-y-auto py-2 text-xs leading-snug",
        className,
      )}
    />
  );
}

export default function SubmittedTracking() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [drafts, setDrafts] = useState<Record<string, OppDraft>>({});
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState<Date | undefined>(undefined);
  const [toDate, setToDate] = useState<Date | undefined>(undefined);
  const [phaseFilter, setPhaseFilter] = useState<string>("all");
  const [searchParams] = useSearchParams();

  // Correspondance depuis le tableau de bord : ?phase=... applique le filtre.
  useEffect(() => {
    const ph = searchParams.get("phase");
    if (ph && ["depose", "in_progress", "attribue", "rejete"].includes(ph)) {
      setPhaseFilter(ph);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openFilePicker = useCallback((id: string) => {
    setUploadingId(id);
    // Reset the input so the same file can be re-selected if needed.
    if (fileInputRef.current) fileInputRef.current.value = "";
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !uploadingId) return;
      try {
        await submitOpportunityWithJustificatif(uploadingId, file);
        toast.success("Document joint avec succès.");
        setRefreshKey((v) => v + 1);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erreur lors de l'upload.");
      } finally {
        setUploadingId(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [uploadingId],
  );

  useEffect(() => {
    void fetchOpportunities().then(setOpportunities);
  }, [refreshKey]);

  const [convertOpp, setConvertOpp] = useState<(typeof opportunities)[number] | null>(null);

  const submitted = opportunities.filter((opp) => opp.status === "soumis");
  const filtered = submitted.filter((opp) => {
    const query = search.trim().toLowerCase();
    const matchesSearch =
      query === "" ||
      [opp.id, opp.title, opp.source, opp.domain].some((f) =>
        String(f ?? "").toLowerCase().includes(query),
      );

    const deadline = new Date(opp.deadline);
    const from = fromDate ?? null;
    const to = toDate ?? null;

    if (from && deadline < from) return false;
    if (to) {
      const toInclusive = new Date(to);
      toInclusive.setHours(23, 59, 59, 999);
      if (deadline > toInclusive) return false;
    }

    // Filtre par phase courante (regroupe « en cours »).
    if (phaseFilter !== "all") {
      const eff = getEffectivePhase(getSubmissionTracking(opp.id));
      const inProgress = eff === "en_evaluation" || eff === "clarification" || eff === "negociation";
      const matchesPhase = phaseFilter === "in_progress" ? inProgress : eff === phaseFilter;
      if (!matchesPhase) return false;
    }

    return matchesSearch;
  });

  const isFilterActive = search.trim() !== "" || Boolean(fromDate) || Boolean(toDate) || phaseFilter !== "all";
  const resetFilters = () => {
    setSearch("");
    setFromDate(undefined);
    setToDate(undefined);
    setPhaseFilter("all");
  };

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const paginated = filtered.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);
  const pendingDeleteOpportunity = filtered.find((item) => item.id === pendingDeleteId);
  const trackingStats = submitted.reduce(
    (acc, opp) => {
      const phase = getEffectivePhase(getSubmissionTracking(opp.id));
      if (phase === "attribue") acc.won += 1;
      if (phase === "rejete") acc.rejected += 1;
      if (phase === "en_evaluation" || phase === "clarification" || phase === "negociation") acc.inProgress += 1;
      return acc;
    },
    { won: 0, rejected: 0, inProgress: 0 },
  );

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, fromDate, toDate, phaseFilter]);

  const opportunitiesForExport: Opportunity[] = filtered;

  const handleExportCsv = () => {
    if (opportunitiesForExport.length === 0) {
      toast.error("Aucune opportunité à exporter");
      return;
    }
    exportOpportunitiesToCsv(opportunitiesForExport, "suivi_soumissions", "submissions");
    toast.success(`${opportunitiesForExport.length} opportunité(s) exportée(s) en CSV`);
  };

  const handleExportPdf = () => {
    if (opportunitiesForExport.length === 0) {
      toast.error("Aucune opportunité à exporter");
      return;
    }
    exportOpportunitiesToPdf(opportunitiesForExport, {
      title: "Suivi des soumissions (liste filtrée)",
      fileBaseName: "suivi_soumissions",
      variant: "submissions",
    });
    toast.success(`${opportunitiesForExport.length} opportunité(s) exportée(s) en PDF`);
  };

  return (
    <div className="space-y-6">
      {/* Input fichier caché — déclenché par openFilePicker() */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
        className="hidden"
        onChange={(e) => void handleFileSelected(e)}
      />

      <PageHeader
        icon={ClipboardList}
        title="Suivi des soumissions"
        description={`${filtered.length} / ${submitted.length} opportunité(s) affichée(s)`}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                <FileDown className="h-4 w-4 mr-1.5" />
                Exporter
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleExportCsv}>
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Exporter en CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportPdf}>
                <FileDown className="h-4 w-4 mr-2" />
                Exporter en PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <div className="rounded-xl border bg-card p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher (ID, référence, titre, source, domaine...)"
              className="h-9 w-full rounded-md border bg-background pl-9 pr-9 text-sm"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:text-foreground"
                aria-label="Effacer la recherche"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">Date limite du</span>
            <DatePicker label="" value={fromDate} onChange={setFromDate} showTodayWhenEmpty={false} />
            <span className="text-xs text-muted-foreground">au</span>
            <DatePicker label="" value={toDate} onChange={setToDate} showTodayWhenEmpty={false} />
          </div>
          {isFilterActive && (
            <Button variant="ghost" size="sm" className="h-8" onClick={resetFilters}>
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              Réinitialiser
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap border-t pt-3">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mr-1">Phase</span>
          <Segmented
            value={phaseFilter}
            onChange={setPhaseFilter}
            options={[
              { value: "all", label: "Toutes" },
              { value: "in_progress", label: "En cours" },
              { value: "attribue", label: "Gagné" },
              { value: "rejete", label: "Rejeté" },
            ]}
          />
        </div>
      </div>

      {/* Cartes de statut = filtres rapides cliquables */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button
          type="button"
          onClick={() => setPhaseFilter((p) => (p === "in_progress" ? "all" : "in_progress"))}
          className={cn(
            "bg-card rounded-xl border p-4 text-left transition-colors hover:border-primary/50",
            phaseFilter === "in_progress" && "border-primary ring-1 ring-primary/30",
          )}
        >
          <p className="text-xs text-muted-foreground">En cours</p>
          <p className="text-xl font-semibold mt-1 flex items-center gap-2">
            <Clock3 className="h-4 w-4 text-indigo-500" />
            {trackingStats.inProgress}
          </p>
        </button>
        <button
          type="button"
          onClick={() => setPhaseFilter((p) => (p === "attribue" ? "all" : "attribue"))}
          className={cn(
            "bg-card rounded-xl border p-4 text-left transition-colors hover:border-primary/50",
            phaseFilter === "attribue" && "border-primary ring-1 ring-primary/30",
          )}
        >
          <p className="text-xs text-muted-foreground">Gagnées</p>
          <p className="text-xl font-semibold mt-1 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            {trackingStats.won}
          </p>
        </button>
        <button
          type="button"
          onClick={() => setPhaseFilter((p) => (p === "rejete" ? "all" : "rejete"))}
          className={cn(
            "bg-card rounded-xl border p-4 text-left transition-colors hover:border-primary/50",
            phaseFilter === "rejete" && "border-primary ring-1 ring-primary/30",
          )}
        >
          <p className="text-xs text-muted-foreground">Rejetées</p>
          <p className="text-xl font-semibold mt-1 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-500" />
            {trackingStats.rejected}
          </p>
        </button>
      </div>

      <div className="space-y-3">
        {paginated.map((opp, index) => {
          const tracking = getSubmissionTracking(opp.id);
          const draft = drafts[opp.id] ?? cloneTrackingToDraft(tracking);
          const effectivePhase = getEffectivePhase(tracking);
          const hasChanges = !persistableDraftEqualsTracking(draft, tracking);

          return (
            <motion.div
              key={`${opp.id}-${refreshKey}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.04 }}
              className="bg-card rounded-2xl border p-5 space-y-4 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-[11px] font-mono text-muted-foreground">{opp.id}</p>
                    <span
                      className={cn(
                        "text-[10px] px-2 py-0.5 rounded-full border",
                        phasePillClass[effectivePhase],
                      )}
                    >
                      {phaseLabel[effectivePhase]}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold mt-1">{opp.title}</h3>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-[11px] px-2 py-1 rounded-md bg-muted text-muted-foreground">
                      Date limite: {new Date(opp.deadline).toLocaleDateString("fr-FR")}
                    </span>
                    <span className="text-[11px] px-2 py-1 rounded-md bg-muted text-muted-foreground">
                      Source: {opp.source}
                    </span>
                  </div>
                  {opp.justificatifFileName ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground pointer-events-none">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="truncate font-medium text-foreground">{opp.justificatifFileName}</span>
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {effectivePhase === "attribue" && (
                    <Button
                      type="button"
                      size="sm"
                      className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                      onClick={() => setConvertOpp(opp)}
                      title="Capitaliser ce marché gagné : il deviendra un projet de référence du profil entreprise"
                    >
                      <Trophy className="h-3.5 w-3.5" />
                      Ajouter aux références
                    </Button>
                  )}
                  <Button asChild variant="outline" size="sm">
                    <Link to={opportunityDetailPath(opp.id)}>
                      <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                      Voir détail
                    </Link>
                  </Button>
                  {/* Bouton justificatif : ouvrir + télécharger si déjà joint, sinon proposer l'upload */}
                  {opp.justificatifFileName ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        title="Ouvrir le justificatif dans un nouvel onglet"
                        onClick={() =>
                          window.open(
                            getOpportunityJustificatifPdfUrl(opp.id),
                            "_blank",
                            "noopener,noreferrer",
                          )
                        }
                      >
                        <FileText className="h-3.5 w-3.5 mr-1.5" />
                        Voir
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        title="Télécharger le justificatif"
                        onClick={() =>
                          void downloadOpportunityJustificatif(
                            opp.id,
                            opp.justificatifFileName ?? "justificatif.pdf",
                          ).catch((e) =>
                            toast.error(
                              e instanceof Error ? e.message : "Téléchargement impossible",
                            ),
                          )
                        }
                      >
                        <Download className="h-3.5 w-3.5 mr-1.5" />
                        PDF
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        title="Remplacer le document joint"
                        disabled={uploadingId === opp.id}
                        onClick={() => openFilePicker(opp.id)}
                      >
                        <Paperclip className="h-3.5 w-3.5 mr-1.5" />
                        {uploadingId === opp.id ? "Upload…" : "Remplacer"}
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      title="Joindre un document à cette soumission"
                      disabled={uploadingId === opp.id}
                      onClick={() => openFilePicker(opp.id)}
                    >
                      <Paperclip className="h-3.5 w-3.5 mr-1.5" />
                      {uploadingId === opp.id ? "Upload…" : "Joindre un document"}
                    </Button>
                  )}
                  <Button variant="outline" size="icon" onClick={() => setPendingDeleteId(opp.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border bg-muted/20 p-3 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Plusieurs statuts possibles : chaque valeur n&apos;apparaît qu&apos;une fois dans les listes. Remplacez un
                  statut pour le libérer ailleurs.
                </p>
                {draft.lines.map((line, lineIdx) => (
                  <div
                    key={`${opp.id}-line-${lineIdx}`}
                    className="border-b border-border/50 pb-3 last:border-0 last:pb-0"
                  >
                    <div className="flex flex-col lg:flex-row lg:items-start gap-3 lg:gap-5">
                      <div className="flex items-center gap-2 min-w-0 shrink-0">
                        <span className="text-xs text-muted-foreground w-[52px] shrink-0 h-8 inline-flex items-center">
                          Statut
                        </span>
                        <div className="flex flex-nowrap items-center gap-1.5 min-h-8 shrink-0">
                          <select
                            value={line.phase}
                            onChange={(e) => {
                              const v = e.target.value as SubmissionPhase;
                              setDrafts((prev) => {
                                const base = prev[opp.id] ?? cloneTrackingToDraft(tracking);
                                const nextLines = base.lines.map((l, j) => (j === lineIdx ? { ...l, phase: v } : l));
                                return { ...prev, [opp.id]: { lines: nextLines } };
                              });
                            }}
                            className={cn(
                              "h-8 shrink-0 rounded-md border bg-background px-2 text-xs",
                              STATUS_SELECT_W,
                              hasChanges ? "border-primary/50 ring-1 ring-primary/20" : "border-border/70",
                            )}
                          >
                            {phaseOptionsForRow(draft.lines, lineIdx).map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            aria-label="Ajouter un statut après celui-ci"
                            disabled={defaultPhaseForNewLine(draft.lines) === null}
                            onClick={() => {
                              setDrafts((prev) => {
                                const base = prev[opp.id] ?? cloneTrackingToDraft(tracking);
                                const phase = defaultPhaseForNewLine(base.lines);
                                if (phase === null) return prev;
                                const nextLines = [
                                  ...base.lines.slice(0, lineIdx + 1),
                                  { phase, notes: [""] },
                                  ...base.lines.slice(lineIdx + 1),
                                ];
                                return { ...prev, [opp.id]: { lines: nextLines } };
                              });
                            }}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            aria-label="Supprimer ce statut"
                            disabled={draft.lines.length <= 1}
                            onClick={() => {
                              setDrafts((prev) => {
                                const base = prev[opp.id] ?? cloneTrackingToDraft(tracking);
                                if (base.lines.length <= 1) return prev;
                                const nextLines = base.lines.filter((_, j) => j !== lineIdx);
                                return { ...prev, [opp.id]: { lines: nextLines } };
                              });
                            }}
                          >
                            <Minus className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      <div className="flex flex-1 min-w-0 lg:min-w-[240px] items-start gap-2">
                        <span className="text-xs text-muted-foreground w-[52px] shrink-0 h-8 inline-flex items-center">
                          Notes
                        </span>
                        <div className="flex flex-col gap-1.5 flex-1 min-w-0 w-full max-w-full">
                          {line.notes.map((note, noteIdx) => (
                            <div
                              key={`${opp.id}-l${lineIdx}-n${noteIdx}`}
                              className="flex items-start gap-1 w-full min-w-0"
                            >
                              <AutoHeightNoteTextarea
                                value={note}
                                placeholder="Plusieurs lignes possibles…"
                                onChange={(nextNote) => {
                                  setDrafts((prev) => {
                                    const base = prev[opp.id] ?? cloneTrackingToDraft(tracking);
                                    const nextLines = base.lines.map((l, j) => {
                                      if (j !== lineIdx) return l;
                                      const nextNotes = l.notes.map((n, i) => (i === noteIdx ? nextNote : n));
                                      return { ...l, notes: nextNotes };
                                    });
                                    return { ...prev, [opp.id]: { lines: nextLines } };
                                  });
                                }}
                                className={cn(
                                  "flex-1 min-w-0",
                                  hasChanges ? "border-primary/50 ring-1 ring-primary/20" : "",
                                )}
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0"
                                aria-label="Ajouter une note"
                                onClick={() => {
                                  setDrafts((prev) => {
                                    const base = prev[opp.id] ?? cloneTrackingToDraft(tracking);
                                    const nextLines = base.lines.map((l, j) => {
                                      if (j !== lineIdx) return l;
                                      const nextNotes = [...l.notes.slice(0, noteIdx + 1), "", ...l.notes.slice(noteIdx + 1)];
                                      return { ...l, notes: nextNotes };
                                    });
                                    return { ...prev, [opp.id]: { lines: nextLines } };
                                  });
                                }}
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0"
                                aria-label="Supprimer cette note"
                                disabled={line.notes.length <= 1}
                                onClick={() => {
                                  setDrafts((prev) => {
                                    const base = prev[opp.id] ?? cloneTrackingToDraft(tracking);
                                    const nextLines = base.lines.map((l, j) => {
                                      if (j !== lineIdx) return l;
                                      if (l.notes.length <= 1) return l;
                                      return { ...l, notes: l.notes.filter((_, i) => i !== noteIdx) };
                                    });
                                    return { ...prev, [opp.id]: { lines: nextLines } };
                                  });
                                }}
                              >
                                <Minus className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-end gap-2 pt-1">
                  {hasChanges && <span className="text-xs text-muted-foreground">Modifications non enregistrées</span>}
                  <Button
                    size="sm"
                    disabled={!hasChanges}
                    onClick={() => {
                      const lines = draftToTrackingLines(draft);
                      updateSubmissionTracking(opp.id, { lines }, { title: opp.title });
                      const phases = lines.map((l) => phaseLabel[l.phase]).join(" → ");
                      addAuditLog({
                        action: "updated",
                        entityType: "submission_tracking",
                        entityId: opp.id,
                        details: `Statuts: ${phases}`,
                      });
                      setDrafts((prev) => {
                        const next = { ...prev };
                        delete next[opp.id];
                        return next;
                      });
                      setRefreshKey((value) => value + 1);
                    }}
                  >
                    <Save className="h-3.5 w-3.5 mr-1.5" />
                    Enregistrer
                  </Button>
                </div>
              </div>

              <div className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-2 pt-1 border-t">
                <CalendarClock className="h-3.5 w-3.5" />
                Dernière mise à jour:{" "}
                {tracking.updatedAt
                  ? new Date(tracking.updatedAt).toLocaleString("fr-FR")
                  : "pas encore de mise à jour"}
              </div>
            </motion.div>
          );
        })}
        <PaginationControls
          currentPage={currentPage}
          totalItems={filtered.length}
          itemsPerPage={ITEMS_PER_PAGE}
          onPageChange={setCurrentPage}
        />
      </div>

      <AlertDialog open={Boolean(pendingDeleteId)} onOpenChange={(open) => !open && setPendingDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer du suivi des soumissions</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteOpportunity
                ? `Retirer "${pendingDeleteOpportunity.title}" de cette rubrique ? Elle réapparaîtra dans les opportunités.`
                : "Cette opportunité sera retirée du suivi des soumissions."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!pendingDeleteId) return;
                const target = submitted.find((item) => item.id === pendingDeleteId);
                if (target) {
                  moveToTrash({
                    type: "submitted_opportunity",
                    label: target.title,
                    description: `Soumission ${target.id}`,
                    payload: { id: target.id, restoreStatus: "soumis" },
                  });
                  addAuditLog({
                    action: "moved_to_trash",
                    entityType: "submitted_opportunity",
                    entityId: target.id,
                    details: target.title,
                  });
                }
                void (async () => {
                  await setOpportunityStatus(pendingDeleteId, "qualifie");
                  setPendingDeleteId(null);
                  setRefreshKey((value) => value + 1);
                })();
              }}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {convertOpp && (
        <ConvertToReferenceDialog
          opportunity={convertOpp}
          open={convertOpp !== null}
          onOpenChange={(o) => { if (!o) setConvertOpp(null); }}
        />
      )}

    </div>
  );
}

