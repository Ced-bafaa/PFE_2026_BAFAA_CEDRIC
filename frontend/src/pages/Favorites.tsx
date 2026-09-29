import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { parsePageFromSearch } from "@/lib/opportunity-routes";
import {
  Search,
  SlidersHorizontal,
  RotateCcw,
  X,
  FileDown,
  FileSpreadsheet,
  Target,
  CalendarClock,
  Tags,
  ListChecks,
  Star,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import type { Opportunity } from "@/lib/types";
import { OpportunityCard } from "@/components/OpportunityCard";
import { fetchFavoriteOpportunityIds, fetchOpportunities, fetchReadOpportunityIds } from "@/lib/opportunities-api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PaginationControls } from "@/components/PaginationControls";
import { exportOpportunitiesToCsv, exportOpportunitiesToPdf } from "@/lib/opportunity-export";
import { hasDecisionScore, scoreBand } from "@/lib/opportunity-decision";
import {
  getTrashedOpportunityIds,
  syncExpiredOpportunitiesToTrash,
} from "@/lib/trash-store";
import { toast } from "sonner";
import { DatePicker } from "@/components/DatePicker";
import { Segmented, FilterSection } from "@/components/FilterControls";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ITEMS_PER_PAGE = 6;

export default function Favorites() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [trashTick, setTrashTick] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
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
  const [sortBy, setSortBy] = useState<"score" | "recent" | "deadline">("score");
  const [isAdvancedFiltersOpen, setIsAdvancedFiltersOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

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
      setUsingCache(false);
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e));
      // Fallback opportunités depuis cache local (pertinents/lus indisponibles sans backend).
      try {
        const opps = await fetchOpportunities();
        setOpportunities(opps);
        setReadIds(new Set());
        setFavoriteIds(new Set());
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

  const trashedOppIds = useMemo(
    () => getTrashedOpportunityIds(),
    [opportunities, trashTick],
  );
  const favoriteOpportunities = opportunities.filter(
    (opp) => favoriteIds.has(opp.id) && !trashedOppIds.has(opp.id),
  );

  // Déplace automatiquement en corbeille les AO expirés non soumis (réversible).
  useEffect(() => {
    if (opportunities.length === 0) return;
    const moved = syncExpiredOpportunitiesToTrash(opportunities);
    if (moved > 0) setTrashTick((t) => t + 1);
  }, [opportunities]);

  const domains = Array.from(new Set(favoriteOpportunities.map((opp) => opp.domain)));
  const sources = Array.from(new Set(favoriteOpportunities.map((opp) => opp.source)));
  const locations = Array.from(new Set(favoriteOpportunities.map((opp) => opp.location)));

  const getDaysToDeadline = (deadline: string) => {
    const today = new Date();
    const limit = new Date(deadline);
    const t = limit.getTime();
    if (Number.isNaN(t)) return 99999;
    const diffMs = t - today.setHours(0, 0, 0, 0);
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  };

  const filtered = favoriteOpportunities.filter((opp) => {
    const q = search.trim().toLowerCase();
    // Recherche élargie : titre, domaine, description (autorité), lieu, source, id (référence).
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
      (!to || publishedAt <= new Date(new Date(to).setHours(23, 59, 59, 999)));

    const matchesScoreFilter =
      filter === "all" || (hasDecisionScore(opp) && scoreBand(opp.score) === filter);

    const matchesStatus = statusFilter === "all" || opp.status === statusFilter;
    const matchesDomain = domainFilter === "all" || opp.domain === domainFilter;
    const matchesSource = sourceFilter === "all" || opp.source === sourceFilter;
    const matchesLocation = locationFilter === "all" || opp.location === locationFilter;

    const daysToDeadline = getDaysToDeadline(opp.deadline);
    const matchesDeadline =
      deadlineFilter === "all" ||
      (deadlineFilter === "urgent" && daysToDeadline >= 0 && daysToDeadline <= 7) ||
      (deadlineFilter === "soon" && daysToDeadline >= 8 && daysToDeadline <= 30) ||
      (deadlineFilter === "later" && daysToDeadline > 30);

    const isRead = readIds.has(opp.id);
    const matchesRead =
      readFilter === "all" ||
      (readFilter === "read" && isRead) ||
      (readFilter === "unread" && !isRead);

    return (
      matchesSearch &&
      matchesPublished &&
      matchesScoreFilter &&
      matchesStatus &&
      matchesDomain &&
      matchesSource &&
      matchesLocation &&
      matchesDeadline &&
      matchesRead
    );
  });

  // Tri : pertinence (score) par défaut, sinon récence ou échéance.
  const scoreVal = (o: Opportunity) =>
    hasDecisionScore(o) && typeof o.score === "number" ? o.score : -1;
  const publishedTs = (o: Opportunity) => {
    const t = Date.parse(o.publishedAt ?? "");
    return Number.isFinite(t) ? t : 0;
  };
  const filteredSorted = [...filtered];
  if (sortBy === "score") {
    filteredSorted.sort((a, b) => scoreVal(b) - scoreVal(a) || publishedTs(b) - publishedTs(a));
  } else if (sortBy === "deadline") {
    filteredSorted.sort((a, b) => {
      const da = getDaysToDeadline(a.deadline);
      const db = getDaysToDeadline(b.deadline);
      const na = da < 0 ? Number.POSITIVE_INFINITY : da;
      const nb = db < 0 ? Number.POSITIVE_INFINITY : db;
      return na - nb;
    });
  } else {
    filteredSorted.sort((a, b) => publishedTs(b) - publishedTs(a));
  }

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

  const handleExportCsv = () => {
    if (filteredSorted.length === 0) {
      toast.error("Aucune opportunité à exporter");
      return;
    }
    exportOpportunitiesToCsv(filteredSorted, "opportunites_pertinentes");
    toast.success(`${filteredSorted.length} opportunité(s) exportée(s) en CSV`);
  };

  const handleExportPdf = () => {
    if (filteredSorted.length === 0) {
      toast.error("Aucune opportunité à exporter");
      return;
    }
    exportOpportunitiesToPdf(filteredSorted, {
      title: "Opportunités pertinentes (liste filtrée)",
      fileBaseName: "opportunites_pertinentes",
    });
    toast.success(`${filteredSorted.length} opportunité(s) exportée(s) en PDF`);
  };

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
    setPage(1);
  };

  // Puces des filtres actifs (supprimables une à une).
  const DECISION_CHIP: Record<string, string> = { high: "GO", medium: "À étudier", low: "Écarter" };
  const STATUS_CHIP: Record<string, string> = {
    nouveau: "Nouveau", en_analyse: "En analyse", qualifie: "Qualifié", gagne: "Gagné", perdu: "Perdu",
  };
  const DEADLINE_CHIP: Record<string, string> = { urgent: "Urgent", soon: "Bientôt", later: "Plus tard" };
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
  if (fromDate)
    activeChips.push({ key: "from", label: `Publié depuis ${fromDate.toLocaleDateString("fr-FR")}`, onClear: () => setFromDate(undefined) });
  if (toDate)
    activeChips.push({ key: "to", label: `Publié jusqu'au ${toDate.toLocaleDateString("fr-FR")}`, onClear: () => setToDate(undefined) });

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Star}
        title="Pertinent"
        description={
          listLoading
            ? "Chargement…"
            : `${filteredSorted.length} / ${favoriteOpportunities.length} opportunité(s) pertinente(s)`
        }
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

      {/* Barre : recherche (toujours visible) + Filtres (popover) + Tri */}
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
                </div>
              </FilterSection>
            </div>

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
        <div className="inline-flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Trier :</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "score" | "recent" | "deadline")}
            className="h-8 rounded-md border bg-background px-2 text-xs"
            aria-label="Trier les opportunités pertinentes"
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
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Impossible de charger les opportunités pertinentes : {listError}
        </div>
      )}
      {usingCache && !listLoading ? (
        <div className="rounded-lg border bg-muted/10 px-4 py-2 text-xs text-muted-foreground">
          Mode hors ligne : liste en cache (les opportunités pertinentes/lues ne sont pas disponibles sans backend).
        </div>
      ) : null}

      <div className="space-y-3">
        {listLoading && (
          <div className="text-center py-12 text-muted-foreground text-sm">Chargement…</div>
        )}
        {!listLoading &&
          paginated.map((opp, i) => (
            <OpportunityCard
              key={`${opp.id}-${refreshKey}`}
              opportunity={opp}
              index={(displayPage - 1) * ITEMS_PER_PAGE + i}
              isRead={readIds.has(opp.id)}
              isFavorite={favoriteIds.has(opp.id)}
              onMarkedRead={(id) => setReadIds((prev) => new Set(prev).add(id))}
              onFavoriteChange={() => setRefreshKey((value) => value + 1)}
              listReturn={{ origin: "favorites", page: currentPage }}
            />
          ))}

        {!listLoading && filteredSorted.length === 0 && !listError && (
          <EmptyState
            icon={Star}
            title="Aucune opportunité pertinente"
            description="Marquez des opportunités comme pertinentes depuis la liste ou le détail d'un appel d'offres."
          />
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
