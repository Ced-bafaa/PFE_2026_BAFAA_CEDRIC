import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/DatePicker";
import { fetchAuditLogs, auditActionLabel, auditEntityLabel, auditRoleLabel, type AuditLog } from "@/lib/audit-logs";
import { RotateCcw, Search, X, FileDown, FileSpreadsheet, Loader2 } from "lucide-react";
import { exportAuditLogsToCsv, exportAuditLogsToPdf } from "@/lib/audit-log-export";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PaginationControls } from "@/components/PaginationControls";

const LOGS_PER_PAGE = 15;
const EXPORT_MAX = 100000;

const LOG_COLUMNS = ["Utilisateur", "Rôle", "Action", "Cible", "Horodatage"] as const;
const DEFAULT_WIDTHS = [190, 150, 180, 340, 180];
const WIDTHS_KEY = "logs_col_widths_v2";

export default function SecuritySettingsPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [fromDate, setFromDate] = useState<Date | undefined>(undefined);
  const [toDate, setToDate] = useState<Date | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Largeurs de colonnes redimensionnables (persistées).
  const [widths, setWidths] = useState<number[]>(() => {
    try {
      const raw = localStorage.getItem(WIDTHS_KEY);
      if (raw) {
        const p = JSON.parse(raw) as unknown;
        if (Array.isArray(p) && p.length === LOG_COLUMNS.length) return p.map((n) => Number(n) || 120);
      }
    } catch {
      /* ignore */
    }
    return [...DEFAULT_WIDTHS];
  });
  useEffect(() => {
    try {
      localStorage.setItem(WIDTHS_KEY, JSON.stringify(widths));
    } catch {
      /* ignore */
    }
  }, [widths]);

  const startResize = (idx: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widths[idx];
    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      setWidths((w) => {
        const n = [...w];
        n[idx] = Math.max(90, startW + delta);
        return n;
      });
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const hasDateRange = Boolean(fromDate || toDate);

  // Debounce de la recherche (évite une requête par frappe).
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Revenir en page 1 quand les filtres changent.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, fromDate, toDate]);

  const queryParams = useCallback(
    (overrides?: { page?: number; limit?: number }) => ({
      from: fromDate ? fromDate.toISOString() : undefined,
      to: toDate ? toDate.toISOString() : undefined,
      q: debouncedSearch,
      page: overrides?.page ?? page,
      limit: overrides?.limit ?? LOGS_PER_PAGE,
    }),
    [fromDate, toDate, debouncedSearch, page],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAuditLogs(queryParams())
      .then((res) => {
        if (cancelled) return;
        setLogs(res.items);
        setTotal(res.total);
      })
      .catch((e) => {
        if (cancelled) return;
        toast.error(e instanceof Error ? e.message : "Chargement des logs impossible.");
        setLogs([]);
        setTotal(0);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [queryParams, refreshKey]);

  // Rafraîchir quand une action ajoute un log ailleurs (petit délai : le push
  // serveur est asynchrone).
  useEffect(() => {
    const onUpdated = () => setTimeout(() => setRefreshKey((v) => v + 1), 500);
    window.addEventListener("audit-logs-updated", onUpdated);
    return () => window.removeEventListener("audit-logs-updated", onUpdated);
  }, []);

  const resetDates = () => {
    setFromDate(undefined);
    setToDate(undefined);
  };

  const exportAll = async (): Promise<AuditLog[]> => {
    const res = await fetchAuditLogs(queryParams({ page: 1, limit: EXPORT_MAX }));
    return res.items;
  };

  const handleExportCsv = async () => {
    try {
      const items = await exportAll();
      if (items.length === 0) return toast.error("Aucun log à exporter");
      exportAuditLogsToCsv(items, "logs");
      toast.success(`${items.length} log(s) exporté(s) en CSV`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export impossible.");
    }
  };

  const handleExportPdf = async () => {
    try {
      const items = await exportAll();
      if (items.length === 0) return toast.error("Aucun log à exporter");
      exportAuditLogsToPdf(items, { title: "Journal d'audit (plage filtrée)", fileBaseName: "logs" });
      toast.success(`${items.length} log(s) exporté(s) en PDF`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export impossible.");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold">Journal d'audit</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Toutes les actions sont conservées ({total} au total sur la plage affichée).{" "}
            {hasDateRange
              ? "Plage sélectionnée."
              : "Par défaut, les 7 derniers jours — choisissez des dates pour tout consulter."}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              <FileDown className="h-4 w-4 mr-1.5" />
              Exporter
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => void handleExportCsv()}>
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              Exporter en CSV
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void handleExportPdf()}>
              <FileDown className="h-4 w-4 mr-2" />
              Exporter en PDF
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <p className="text-xs text-muted-foreground">
        Conservation : <span className="font-medium text-foreground">illimitée</span> — aucun log n'est supprimé.
      </p>

      <div className="rounded-xl border overflow-hidden">
        <div className="p-3 border-b bg-muted/20 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Du</span>
            <DatePicker label="" value={fromDate} onChange={setFromDate} showTodayWhenEmpty={false} />
            <span className="text-xs font-medium text-muted-foreground">Au</span>
            <DatePicker label="" value={toDate} onChange={setToDate} showTodayWhenEmpty={false} />
            <button
              type="button"
              onClick={resetDates}
              disabled={!hasDateRange}
              className="ml-1 inline-flex h-9 w-9 items-center justify-center rounded-lg border bg-background text-muted-foreground shadow-sm transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-foreground disabled:opacity-50"
              aria-label="Réinitialiser les dates (revenir aux 7 derniers jours)"
              title="Réinitialiser les dates (7 derniers jours)"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher (utilisateur, action, cible, détails...)"
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
        </div>

        <div className="relative min-h-[80px] overflow-x-auto">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          <table
            className="text-sm border-collapse"
            style={{ tableLayout: "fixed", width: widths.reduce((a, b) => a + b, 0) }}
          >
            <colgroup>
              {widths.map((w, i) => (
                <col key={i} style={{ width: `${w}px` }} />
              ))}
            </colgroup>
            <thead>
              <tr className="bg-muted/40">
                {LOG_COLUMNS.map((h, i) => (
                  <th key={h} className="relative text-left px-3 py-2 text-xs font-semibold select-none">
                    <span className="block truncate pr-2">{h}</span>
                    {i < LOG_COLUMNS.length - 1 && (
                      <span
                        onMouseDown={(e) => startResize(i, e)}
                        className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/40"
                        title="Glisser pour redimensionner"
                      />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const cible = `${auditEntityLabel(log.entityType)}${log.details ? ` — ${log.details}` : ""}`;
                return (
                  <tr key={log.id} className="border-t">
                    <td className="px-3 py-2 truncate" title={log.actor}>{log.actor}</td>
                    <td className="px-3 py-2 truncate text-muted-foreground" title={auditRoleLabel(log.actorRole)}>
                      {auditRoleLabel(log.actorRole)}
                    </td>
                    <td className="px-3 py-2 truncate" title={auditActionLabel(log.action)}>
                      {auditActionLabel(log.action)}
                    </td>
                    <td className="px-3 py-2 truncate" title={cible}>{cible}</td>
                    <td className="px-3 py-2 text-muted-foreground text-xs whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString("fr-FR")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!loading && logs.length === 0 && (
            <div className="px-3 py-5 text-sm text-muted-foreground text-center">Aucun log disponible.</div>
          )}
        </div>

        {total > 0 && (
          <div className="border-t p-2">
            <PaginationControls
              currentPage={page}
              totalItems={total}
              itemsPerPage={LOGS_PER_PAGE}
              onPageChange={setPage}
            />
          </div>
        )}
      </div>
    </div>
  );
}
