import { useCallback, useEffect, useMemo, useState } from "react";
import { OpportunityCard } from "@/components/OpportunityCard";
import type { Opportunity } from "@/lib/types";
import {
  fetchFavoriteOpportunityIds,
  fetchOpportunities,
  fetchReadOpportunityIds,
  submitOpportunity,
} from "@/lib/opportunities-api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Search, SlidersHorizontal, RotateCcw, X, FileDown, FileSpreadsheet, Loader2, Inbox, Target, CalendarClock, Tags, ListChecks } from "lucide-react";
import { Segmented, FilterSection } from "@/components/FilterControls";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { motion } from "framer-motion";
import { useNavigate, useSearchParams } from "react-router-dom";
import { parsePageFromSearch } from "@/lib/opportunity-routes";
import { PaginationControls } from "@/components/PaginationControls";
import { addAuditLog } from "@/lib/audit-logs";
import { exportOpportunitiesToCsv, exportOpportunitiesToPdf } from "@/lib/opportunity-export";
import { hasDecisionScore, scoreBand } from "@/lib/opportunity-decision";
import {
  getTrashedOpportunityIds,
  syncExpiredOpportunitiesToTrash,
} from "@/lib/trash-store";
import { toast } from "sonner";
import { DatePicker } from "@/components/DatePicker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  hasAnyKeywordConfigured,
  sortOpportunitiesByKeywordRelevance,
} from "@/lib/opportunity-keyword-rank";
import { SOURCES_SETTINGS_KEY } from "@/lib/sources-settings-key";
import { useCollectProgress, CollectProgressCard } from "@/components/CollectProgress";

const ITEMS_PER_PAGE = 6;
const BACKEND_ARMP_SOURCE_TITLE = "ARMP Cameroun";

type SourceSettingsItem = { title?: string; url?: string; active?: boolean };
type SourcesSettings = { sources?: SourceSettingsItem[] };

function getActiveSourcesFromSettings(): Array<{ title: string; url: string }> {
  try {
    const raw = localStorage.getItem(SOURCES_SETTINGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SourcesSettings;
    const list = Array.isArray(parsed.sources) ? parsed.sources : [];
    return list
      .filter((s) => (s?.active ?? true) !== false)
      .map((s) => ({
        title: String(s?.title ?? "").trim(),
        url: String(s?.url ?? "").trim(),
      }))
      .filter((s) => Boolean(s.title));
  } catch {
    return [];
  }
}

function getHostFromUrl(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function normalizeOpportunitySourceForFilter(
  opp: Opportunity,
  activeSources: Array<{ title: string; url: string }>,
): string {
  const oppSource = (opp.source ?? "").trim();
  const lower = oppSource.toLowerCase();

  // ARMP (backend) is specifically armp.cm and is always grouped under "ARMP Cameroun".
  // This avoids mixing ARMP Bénin (or other ARMP-like sources) with the backend ARMP.
  if (
    lower.startsWith("armp —") ||
    lower.includes("armp.cm") ||
    lower.includes(" armp ") ||
    lower.startsWith("armp-")
  ) {
    return BACKEND_ARMP_SOURCE_TITLE;
  }

  // Prefer matching by configured source URL host (works even if label text differs).
  const descriptionLower = (opp.description ?? "").toLowerCase();
  for (const s of activeSources) {
    const host = getHostFromUrl(s.url);
    if (host && descriptionLower.includes(host)) return s.title;
  }

  // Then match by label in `opp.source` as a fallback.
  for (const s of activeSources) {
    const tl = s.title.toLowerCase();
    if (tl && lower.includes(tl)) return s.title;
  }

  // Fallback: keep original.
  return oppSource;
}

export default function Opportunities() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const {
    status: collectProgress,
    active: collecting,
    elapsed: collectElapsed,
    startCollect,
  } = useCollectProgress(() => {
    void loadList();
  });
  const [usingCache, setUsingCache] = useState(false);
  const [fromDate, setFromDate] = useState<Date | undefined>(undefined);
  const [toDate, setToDate] = useState<Date | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [deadlineFilter, setDeadlineFilter] = useState<string>("all");
  const [readFilter, setReadFilter] = useState<string>("all");
  const [favoriteFilter, setFavoriteFilter] = useState<string>("all");
  const [isAdvancedFiltersOpen, setIsAdvancedFiltersOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showNewOnly, setShowNewOnly] = useState(false);
  const [trashTick, setTrashTick] = useState(0);
  const [sortBy, setSortBy] = useState<"score" | "recent" | "deadline">("score");

  /** Page courante lue depuis l’URL (source de vérité pour le retour depuis la fiche détail). */
  const currentPage = parsePageFromSearch(searchParams);

  const setPage = useCallback(
    (page: number) => {
      const safe = Math.max(1, page);
      const next = new URLSearchParams(searchParams);
      if (safe <= 1) next.delete("page");
      else next.set("page", String(safe));
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  // Correspondance depuis le tableau de bord : ?status=... applique le filtre.
  useEffect(() => {
    const s = searchParams.get("status");
    if (s && ["nouveau", "en_analyse", "qualifie"].includes(s)) {
      setStatusFilter(s);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [submittingIds, setSubmittingIds] = useState<Set<string>>(new Set());
  const [keywordRankVersion, setKeywordRankVersion] = useState(0);

  useEffect(() => {
    const bump = () => setKeywordRankVersion((v) => v + 1);
    const onStorage = (e: StorageEvent) => {
      if (e.key === SOURCES_SETTINGS_KEY) bump();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("sources-settings-changed", bump);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("sources-settings-changed", bump);
    };
  }, []);

  const loadList = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const [opps, reads, favs] = await Promise.all([
        fetchOpportunities(),
        fetchReadOpportunityIds(),
        fetchFavoriteOpportunityIds(),
      ]);
      setOpportunities(opps);
      setReadIds(new Set(reads));
      setFavoriteIds(new Set(favs));
      // Heuristique: si l'API est KO, `fetchOpportunities()` fallback cache.
      // Dans ce cas, reads/favs échouent généralement et on passera en catch.
      setUsingCache(false);
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e));
      // On tente quand même d'afficher la dernière liste en cache.
      try {
        const opps = await fetchOpportunities();
        setOpportunities(opps);
        setUsingCache(true);
      } catch {
        setUsingCache(false);
      }
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList, refreshKey]);

  /** Rafraîchit les scores affichés sans relancer un scrape. */
  useEffect(() => {
    const id = window.setInterval(() => {
      void fetchOpportunities()
        .then((opps) => setOpportunities(opps))
        .catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(id);
  }, []);

  const trashedOppIds = useMemo(
    () => getTrashedOpportunityIds(),
    [opportunities, trashTick],
  );
  const openOpportunities = opportunities.filter(
    (opp) => opp.status !== "soumis" && !trashedOppIds.has(opp.id),
  );

  // Déplace automatiquement en corbeille les AO expirés non soumis (réversible).
  useEffect(() => {
    if (opportunities.length === 0) return;
    const moved = syncExpiredOpportunitiesToTrash(opportunities);
    if (moved > 0) setTrashTick((t) => t + 1);
  }, [opportunities]);

  const domains = Array.from(new Set(openOpportunities.map((opp) => opp.domain)));
  const activeSources = useMemo(
    () => getActiveSourcesFromSettings(),
    [keywordRankVersion],
  );
  const sources = useMemo(() => {
    // Prefer sources configured & active in settings. If none, fallback to detected sources in data.
    const baseTitles =
      activeSources.length > 0
        ? activeSources.map((s) => s.title)
        : Array.from(new Set(openOpportunities.map((opp) => opp.source)));

    // Always include backend ARMP (Cameroun) as a selectable source filter.
    const merged = new Set<string>([BACKEND_ARMP_SOURCE_TITLE, ...baseTitles]);
    return Array.from(merged);
  }, [activeSources, openOpportunities]);
  const locations = Array.from(new Set(openOpportunities.map((opp) => opp.location)));

  const getDaysToDeadline = (deadline: string) => {
    const today = new Date();
    const limit = new Date(deadline);
    const t = limit.getTime();
    if (Number.isNaN(t)) return 99999;
    const diffMs = t - today.setHours(0, 0, 0, 0);
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  };

  const filtered = openOpportunities.filter((opp) => {
    const q = search.trim().toLowerCase();
    // Recherche élargie : titre, domaine, description (contient l'autorité),
    // localisation, source et identifiant (contient la référence de l'AO).
    const matchesSearch =
      q === "" ||
      [opp.title, opp.domain, opp.description, opp.location, opp.source, opp.id].some((f) =>
        String(f ?? "").toLowerCase().includes(q),
      );

    const publishedAt = new Date(opp.publishedAt);
    const from = fromDate ?? null;
    const to = toDate ?? null;
    const matchesPublished =
      (!from || publishedAt >= from) &&
      (!to ||
        publishedAt <=
          new Date(
            new Date(to).setHours(23, 59, 59, 999),
          ));

    const matchesScoreFilter =
      filter === "all" ||
      (hasDecisionScore(opp) && scoreBand(opp.score) === filter);

    const matchesStatus = statusFilter === "all" || opp.status === statusFilter;
    const matchesDomain = domainFilter === "all" || opp.domain === domainFilter;
    const normalizedSource = normalizeOpportunitySourceForFilter(opp, activeSources);
    const matchesSource =
      sourceFilter === "all" ||
      normalizedSource === sourceFilter ||
      opp.source === sourceFilter;
    const matchesLocation = locationFilter === "all" || opp.location === locationFilter;

    const daysToDeadline = getDaysToDeadline(opp.deadline);
    const matchesDeadline =
      deadlineFilter === "all" ||
      (deadlineFilter === "urgent" && daysToDeadline >= 0 && daysToDeadline <= 7) ||
      (deadlineFilter === "soon" && daysToDeadline >= 8 && daysToDeadline <= 30) ||
      (deadlineFilter === "later" && daysToDeadline > 30) ||
      (deadlineFilter === "expired" && daysToDeadline < 0);

    const isRead = readIds.has(opp.id);
    const isFavorite = favoriteIds.has(opp.id);
    const matchesRead =
      readFilter === "all" ||
      (readFilter === "read" && isRead) ||
      (readFilter === "unread" && !isRead);
    const matchesFavorite =
      favoriteFilter === "all" ||
      (favoriteFilter === "favorite" && isFavorite) ||
      (favoriteFilter === "not_favorite" && !isFavorite);

    return (
      matchesSearch &&
      matchesPublished &&
      matchesScoreFilter &&
      matchesStatus &&
      matchesDomain &&
      matchesSource &&
      matchesLocation &&
      matchesDeadline &&
      matchesRead &&
      matchesFavorite
    );
  });

  const isScrapedToday = (opp: Opportunity): boolean => {
    const s = opp.scrapedAt;
    if (!s) return false;
    const t = Date.parse(s);
    if (!Number.isFinite(t)) return false;
    const d = new Date(t);
    const now = new Date();
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  };

  // Nombre d'AOs scrapés aujourd'hui et non encore lus (badge du chip)
  const newTodayCount = useMemo(
    () => openOpportunities.filter((o) => isScrapedToday(o) && !readIds.has(o.id)).length,
    [openOpportunities, readIds],
  );

  const filteredSorted = useMemo(() => {
    // Ordre de base = pertinence mots-clés (tri stable) ; on réordonne ensuite
    // selon le mode choisi. Le tri JS étant stable, à valeur égale (ex. AO non
    // scorés, tous à -1 en mode « score ») l'ordre de pertinence est conservé.
    const arr = [...sortOpportunitiesByKeywordRelevance(filtered)];
    const scoreVal = (o: Opportunity) =>
      hasDecisionScore(o) && typeof o.score === "number" ? o.score : -1;
    const publishedTs = (o: Opportunity) => {
      const t = Date.parse(o.publishedAt ?? "");
      return Number.isFinite(t) ? t : 0;
    };
    if (sortBy === "score") {
      arr.sort((a, b) => scoreVal(b) - scoreVal(a)); // pertinence : score décroissant
    } else if (sortBy === "deadline") {
      arr.sort((a, b) => {
        const da = getDaysToDeadline(a.deadline);
        const db = getDaysToDeadline(b.deadline);
        const na = da < 0 ? Number.POSITIVE_INFINITY : da; // expirés en dernier
        const nb = db < 0 ? Number.POSITIVE_INFINITY : db;
        return na - nb; // échéance la plus proche d'abord
      });
    } else {
      arr.sort((a, b) => publishedTs(b) - publishedTs(a)); // plus récents
    }
    const base = arr;
    if (!showNewOnly) return base;
    return base.filter((o) => isScrapedToday(o) && !readIds.has(o.id));
  }, [filtered, keywordRankVersion, showNewOnly, readIds, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredSorted.length / ITEMS_PER_PAGE));
  const displayPage = Math.min(currentPage, totalPages);
  const paginated = filteredSorted.slice(
    (displayPage - 1) * ITEMS_PER_PAGE,
    displayPage * ITEMS_PER_PAGE,
  );

  useEffect(() => {
    if (listLoading) return;
    if (filteredSorted.length === 0) return;
    if (currentPage > totalPages) setPage(totalPages);
  }, [listLoading, filteredSorted.length, currentPage, totalPages, setPage]);

  useEffect(() => {
    const visibleIds = new Set(filteredSorted.map((item) => item.id));
    setSelectedIds((prev) => prev.filter((id) => visibleIds.has(id)));
  }, [filteredSorted]);

  const resetAllFilters = () => {
    setFromDate(undefined);
    setToDate(undefined);
    setSearch("");
    setFilter("all");
    setStatusFilter("all");
    setDomainFilter("all");
    setSourceFilter("all");
    setLocationFilter("all");
    setDeadlineFilter("all");
    setReadFilter("all");
    setFavoriteFilter("all");
    setPage(1);
  };

  // Puces des filtres actifs (visibles même panneau replié, supprimables une à une).
  const DECISION_CHIP: Record<string, string> = { high: "GO", medium: "À étudier", low: "Écarter" };
  const STATUS_CHIP: Record<string, string> = {
    nouveau: "Nouveau", en_analyse: "En analyse", qualifie: "Qualifié", gagne: "Gagné", perdu: "Perdu",
  };
  const DEADLINE_CHIP: Record<string, string> = {
    urgent: "Urgent", soon: "Bientôt", later: "Plus tard", expired: "Expiré",
  };
  const activeChips: Array<{ key: string; label: string; onClear: () => void }> = [];
  if (search.trim())
    activeChips.push({ key: "search", label: `Recherche : « ${search.trim()} »`, onClear: () => setSearch("") });
  if (filter !== "all")
    activeChips.push({ key: "decision", label: `Décision : ${DECISION_CHIP[filter] ?? filter}`, onClear: () => setFilter("all") });
  if (statusFilter !== "all")
    activeChips.push({ key: "status", label: `Statut : ${STATUS_CHIP[statusFilter] ?? statusFilter}`, onClear: () => setStatusFilter("all") });
  if (deadlineFilter !== "all")
    activeChips.push({ key: "deadline", label: `Échéance : ${DEADLINE_CHIP[deadlineFilter] ?? deadlineFilter}`, onClear: () => setDeadlineFilter("all") });
  if (domainFilter !== "all")
    activeChips.push({ key: "domain", label: `Domaine : ${domainFilter}`, onClear: () => setDomainFilter("all") });
  if (sourceFilter !== "all")
    activeChips.push({ key: "source", label: `Source : ${sourceFilter}`, onClear: () => setSourceFilter("all") });
  if (locationFilter !== "all")
    activeChips.push({ key: "location", label: `Lieu : ${locationFilter}`, onClear: () => setLocationFilter("all") });
  if (readFilter !== "all")
    activeChips.push({ key: "read", label: readFilter === "read" ? "Lu" : "Non lu", onClear: () => setReadFilter("all") });
  if (favoriteFilter !== "all")
    activeChips.push({ key: "favorite", label: favoriteFilter === "favorite" ? "Pertinent" : "Non pertinent", onClear: () => setFavoriteFilter("all") });
  if (fromDate)
    activeChips.push({ key: "from", label: `Publié depuis ${fromDate.toLocaleDateString("fr-FR")}`, onClear: () => setFromDate(undefined) });
  if (toDate)
    activeChips.push({ key: "to", label: `Publié jusqu'au ${toDate.toLocaleDateString("fr-FR")}`, onClear: () => setToDate(undefined) });

  const allPaginatedSelected = paginated.length > 0 && paginated.every((opp) => selectedIds.includes(opp.id));

  const toggleSelectAllPaginated = () => {
    setSelectedIds((prev) => {
      if (allPaginatedSelected) {
        const currentPageIds = new Set(paginated.map((opp) => opp.id));
        return prev.filter((id) => !currentPageIds.has(id));
      }
      const merged = new Set(prev);
      for (const opp of paginated) merged.add(opp.id);
      return Array.from(merged);
    });
  };

  const exportList = useMemo(
    () =>
      selectedIds.length > 0
        ? filteredSorted.filter((o) => selectedIds.includes(o.id))
        : filteredSorted,
    [selectedIds, filteredSorted],
  );

  const handleExportCsv = () => {
    if (exportList.length === 0) {
      toast.error(selectedIds.length > 0 ? "Aucune opportunité sélectionnée" : "Aucune opportunité à exporter");
      return;
    }
    exportOpportunitiesToCsv(exportList);
    const label = selectedIds.length > 0 ? `${exportList.length} sélection(s)` : `${exportList.length} opportunité(s)`;
    toast.success(`${label} exportée(s) en CSV`);
  };

  const handleExportPdf = () => {
    if (exportList.length === 0) {
      toast.error(selectedIds.length > 0 ? "Aucune opportunité sélectionnée" : "Aucune opportunité à exporter");
      return;
    }
    const title =
      selectedIds.length > 0
        ? `Opportunités sélectionnées (${exportList.length})`
        : "Opportunités (liste filtrée)";
    exportOpportunitiesToPdf(exportList, {
      title,
      fileBaseName: selectedIds.length > 0 ? "opportunites_selection" : "opportunites",
    });
    const label = selectedIds.length > 0 ? `${exportList.length} sélection(s)` : `${exportList.length} opportunité(s)`;
    toast.success(`${label} exportée(s) en PDF`);
  };

  const checkForUpdates = async () => {
    if (collecting) return;
    try {
      const started = await startCollect();
      if (!started) toast.message("Aucune source active configurée.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Impossible de lancer la collecte");
    }
  };

  const handleSubmit = async (ids: string[]) => {
    if (ids.length === 0) return;
    setSubmittingIds(new Set(ids));
    try {
      for (const id of ids) {
        const opp = opportunities.find((o) => o.id === id);
        await submitOpportunity(id);
        addAuditLog({
          action: "submitted",
          entityType: "opportunity",
          entityId: id,
          details: opp?.title ?? id,
        });
      }
      setSelectedIds([]);
      setRefreshKey((value) => value + 1);
      navigate("/submitted-tracking");
      toast.success(
        ids.length > 1
          ? `${ids.length} opportunités soumises.`
          : "Opportunité soumise.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur lors de la soumission.");
    } finally {
      setSubmittingIds(new Set());
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Search}
        title="Opportunités"
        description={
          <>
            {listLoading
              ? "Chargement…"
              : `${filteredSorted.length} / ${openOpportunities.length} appels d'offres affichés`}
            {!listLoading && hasAnyKeywordConfigured() && (
              <span className="mt-1 block max-w-xl text-xs">
                Classement par pertinence selon les mots-clés définis dans Réglages → Sources (globaux et par source).
              </span>
            )}
          </>
        }
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  <FileDown className="h-4 w-4 mr-1.5" />
                  {selectedIds.length > 0 ? `Exporter (${selectedIds.length})` : "Exporter"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleExportCsv}>
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  {selectedIds.length > 0
                    ? `Exporter la sélection en CSV (${selectedIds.length})`
                    : "Exporter tout en CSV"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportPdf}>
                  <FileDown className="h-4 w-4 mr-2" />
                  {selectedIds.length > 0
                    ? `Exporter la sélection en PDF (${selectedIds.length})`
                    : "Exporter tout en PDF"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button type="button" variant="outline" size="sm" onClick={checkForUpdates} disabled={listLoading || collecting}>
              {collecting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Collecte en cours…
                </>
              ) : (
                "Vérifier les nouveautés"
              )}
            </Button>
          </>
        }
      />

      {/* Barre de progression de la collecte (phase collecte puis scoring) */}
      {collecting && (
        <CollectProgressCard status={collectProgress} elapsed={collectElapsed} />
      )}

      {/* Barre : recherche (toujours visible) + Filtres (popover) + Nouveaux + Tri */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher par titre, référence, autorité, domaine, lieu..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-9"
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
        <Popover open={isAdvancedFiltersOpen} onOpenChange={setIsAdvancedFiltersOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md border bg-background px-3 h-9 text-sm font-medium hover:bg-muted/40 transition-colors"
            >
              <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
              Filtres
              {activeChips.length > 0 && (
                <span className="ml-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                  {activeChips.length}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-[min(94vw,440px)] max-h-[78vh] overflow-y-auto p-0"
          >
            {/* En-tête collant */}
            <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-popover px-4 py-3">
              <p className="text-sm font-semibold">Filtres</p>
              <Button
                variant="ghost"
                size="sm"
                className="h-8"
                onClick={resetAllFilters}
                disabled={activeChips.length === 0}
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                Réinitialiser
              </Button>
            </div>

            {/* Corps */}
            <div className="px-4 py-3 space-y-4">
              <FilterSection icon={Target} title="Pertinence" first>
                <Segmented
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: "all", label: "Toutes" },
                    { value: "high", label: "GO" },
                    { value: "medium", label: "À étudier" },
                    { value: "low", label: "Écarter" },
                  ]}
                />
              </FilterSection>

              <FilterSection icon={CalendarClock} title="Échéance & dates">
                <Segmented
                  value={deadlineFilter}
                  onChange={setDeadlineFilter}
                  options={[
                    { value: "all", label: "Toutes" },
                    { value: "urgent", label: "Urgent" },
                    { value: "soon", label: "Bientôt" },
                    { value: "later", label: "Plus tard" },
                  ]}
                />
                <div className="flex items-center gap-2 flex-wrap pt-1">
                  <span className="text-xs font-medium text-muted-foreground">Publié du</span>
                  <DatePicker label="" value={fromDate} onChange={setFromDate} showTodayWhenEmpty={false} />
                  <span className="text-xs font-medium text-muted-foreground">au</span>
                  <DatePicker label="" value={toDate} onChange={setToDate} showTodayWhenEmpty={false} />
                </div>
              </FilterSection>

              <FilterSection icon={Tags} title="Catégorie">
                <div className="space-y-2">
                  <select
                    value={domainFilter}
                    onChange={(e) => setDomainFilter(e.target.value)}
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="all">Domaine : Tous</option>
                    {domains.map((domain) => (
                      <option key={domain} value={domain}>{domain}</option>
                    ))}
                  </select>
                  <select
                    value={sourceFilter}
                    onChange={(e) => setSourceFilter(e.target.value)}
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="all">Source : Toutes</option>
                    {sources.map((source) => (
                      <option key={source} value={source}>{source}</option>
                    ))}
                  </select>
                  <select
                    value={locationFilter}
                    onChange={(e) => setLocationFilter(e.target.value)}
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="all">Localisation : Toutes</option>
                    {locations.map((location) => (
                      <option key={location} value={location}>{location}</option>
                    ))}
                  </select>
                </div>
              </FilterSection>

              <FilterSection icon={ListChecks} title="Statut & suivi">
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <p className="text-[11px] text-muted-foreground">Statut</p>
                    <Segmented
                      value={statusFilter}
                      onChange={setStatusFilter}
                      options={[
                        { value: "all", label: "Tous" },
                        { value: "nouveau", label: "Nouveau" },
                        { value: "en_analyse", label: "En analyse" },
                        { value: "qualifie", label: "Qualifié" },
                      ]}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-[11px] text-muted-foreground">Lecture</p>
                    <Segmented
                      value={readFilter}
                      onChange={setReadFilter}
                      options={[
                        { value: "all", label: "Tous" },
                        { value: "unread", label: "Non lu" },
                        { value: "read", label: "Lu" },
                      ]}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-[11px] text-muted-foreground">Pertinent</p>
                    <Segmented
                      value={favoriteFilter}
                      onChange={setFavoriteFilter}
                      options={[
                        { value: "all", label: "Tous" },
                        { value: "favorite", label: "Pertinent" },
                        { value: "not_favorite", label: "Non" },
                      ]}
                    />
                  </div>
                </div>
              </FilterSection>
            </div>

            {/* Pied collant : compteur + fermeture */}
            <div className="sticky bottom-0 z-10 flex items-center justify-between gap-2 border-t bg-popover px-4 py-3">
              <span className="text-xs text-muted-foreground">
                {filteredSorted.length} résultat{filteredSorted.length > 1 ? "s" : ""}
              </span>
              <Button size="sm" className="h-8" onClick={() => setIsAdvancedFiltersOpen(false)}>
                Voir les résultats
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        <button
          type="button"
          onClick={() => setShowNewOnly((v) => !v)}
          className={[
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
            showNewOnly
              ? "bg-blue-500 border-blue-500 text-white"
              : newTodayCount > 0
                ? "bg-blue-500/10 border-blue-500/30 text-blue-600 hover:bg-blue-500/20"
                : "border-border text-muted-foreground hover:bg-muted/40",
          ].join(" ")}
          aria-pressed={showNewOnly}
        >
          {newTodayCount > 0 && (
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue-500" />
            </span>
          )}
          Nouveaux aujourd'hui
          {newTodayCount > 0 && (
            <span className={[
              "ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold",
              showNewOnly ? "bg-white/20 text-white" : "bg-blue-500/20 text-blue-600",
            ].join(" ")}>
              {newTodayCount}
            </span>
          )}
        </button>
        <div className="inline-flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Trier :</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "score" | "recent" | "deadline")}
            className="h-8 rounded-md border bg-background px-2 text-xs"
            aria-label="Trier les opportunités"
          >
            <option value="score">Pertinence (score ↓)</option>
            <option value="recent">Plus récents</option>
            <option value="deadline">Échéance proche</option>
          </select>
        </div>
      </div>

      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground mr-1">Filtres actifs :</span>
          {activeChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={chip.onClear}
              className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2.5 py-1 text-xs hover:bg-muted transition-colors"
              title="Retirer ce filtre"
            >
              {chip.label}
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          ))}
          <button
            type="button"
            onClick={resetAllFilters}
            className="ml-1 text-xs text-primary hover:underline"
          >
            Tout effacer
          </button>
        </div>
      )}

      {listError && (
        <div className="kiama-surface kiama-ring rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive shadow-sm">
          Impossible de charger les opportunités : {listError}
        </div>
      )}
      {usingCache && !listLoading ? (
        <div className="kiama-surface kiama-ring rounded-lg border bg-muted/10 px-4 py-2 text-xs text-muted-foreground shadow-sm">
          Affichage en mode hors ligne : données en cache (dernier chargement réussi).
        </div>
      ) : null}

      {/* List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={allPaginatedSelected}
              onChange={toggleSelectAllPaginated}
              disabled={paginated.length === 0}
              aria-label="Selectionner toutes les opportunites de la page"
            />
            Tout sélectionner (page)
          </label>
          <Button
            size="sm"
            onClick={() => void handleSubmit(selectedIds)}
            disabled={selectedIds.length === 0 || listLoading || submittingIds.size > 0}
          >
            {submittingIds.size > 0 ? "Soumission…" : `Soumettre (${selectedIds.length})`}
          </Button>
        </div>
        {listLoading && (
          <div className="text-center py-12 text-muted-foreground text-sm">Chargement des opportunités…</div>
        )}
        {!listLoading &&
          paginated.map((opp, i) => (
          <OpportunityCard
            key={`${opp.id}-${refreshKey}`}
            opportunity={opp}
            index={(displayPage - 1) * ITEMS_PER_PAGE + i}
            isRead={readIds.has(opp.id)}
            isFavorite={favoriteIds.has(opp.id)}
            selectable
            selected={selectedIds.includes(opp.id)}
            onSelectionChange={(next) => {
              setSelectedIds((prev) =>
                next ? Array.from(new Set([...prev, opp.id])) : prev.filter((id) => id !== opp.id),
              );
            }}
            onMarkedRead={(id) => setReadIds((prev) => new Set(prev).add(id))}
            onFavoriteChange={() => setRefreshKey((value) => value + 1)}
            onSendToTracking={() => void handleSubmit([opp.id])}
            listReturn={{ origin: "opportunities", page: currentPage }}
          />
        ))}
        {!listLoading && filteredSorted.length === 0 && !listError && (
          opportunities.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="Aucune opportunité pour l'instant"
              description="Lancez une collecte pour récupérer les appels d'offres de l'ARMP, les filtrer et les faire scorer automatiquement."
              action={
                <div className="flex flex-col items-center gap-2">
                  <Button type="button" size="sm" onClick={checkForUpdates} disabled={collecting}>
                    {collecting ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        Collecte en cours…
                      </>
                    ) : (
                      "Lancer une collecte"
                    )}
                  </Button>
                  {collecting && (
                    <p className="text-[11px] text-muted-foreground">
                      La première collecte prend 5–10 min ; la liste se met à jour toute seule.
                    </p>
                  )}
                </div>
              }
            />
          ) : (
            <EmptyState
              icon={SlidersHorizontal}
              title="Aucun résultat"
              description="Aucune opportunité ne correspond à vos filtres actuels."
            />
          )
        )}
        {!listLoading && (
          <PaginationControls
            currentPage={displayPage}
            totalItems={filteredSorted.length}
            itemsPerPage={ITEMS_PER_PAGE}
            onPageChange={setPage}
          />
        )}
      </div>
    </div>
  );
}
