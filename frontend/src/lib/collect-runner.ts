import { apiJson } from "@/lib/api";
import { SOURCES_SETTINGS_KEY } from "@/lib/sources-settings-key";

const COLLECT_LAST_STARTED_KEY = "collect_last_started_iso_v1";
const MIN_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

type SourcesSettings = {
  globalKeywords?: string[];
  sources?: Array<{
    id: string;
    title: string;
    url: string;
    active: boolean;
    keywords?: string[];
    collectionMode?: "rss" | "scrape";
  }>;
};

function readSourcesSettings(): SourcesSettings | null {
  try {
    const raw = localStorage.getItem(SOURCES_SETTINGS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SourcesSettings;
  } catch {
    return null;
  }
}

function canStartByThrottle(): boolean {
  try {
    const raw = localStorage.getItem(COLLECT_LAST_STARTED_KEY);
    if (!raw) return true;
    const t = Date.parse(raw);
    if (!Number.isFinite(t)) return true;
    return Date.now() - t >= MIN_INTERVAL_MS;
  } catch {
    return true;
  }
}

function markStarted(): void {
  try {
    localStorage.setItem(COLLECT_LAST_STARTED_KEY, new Date().toISOString());
  } catch {
    /* ignore */
  }
}

/** Charge la config des sources : le SERVEUR fait foi (sources-settings.json),
 * repli sur le cache localStorage si le backend est injoignable. */
async function loadSourcesSettings(): Promise<SourcesSettings | null> {
  try {
    const server = await apiJson<SourcesSettings>("/settings/sources");
    if (server && Array.isArray(server.sources) && server.sources.length > 0) {
      return server;
    }
  } catch {
    /* backend injoignable -> repli cache local */
  }
  return readSourcesSettings();
}

export async function startCollectInBackground(opts?: { force?: boolean }): Promise<boolean> {
  const settings = await loadSourcesSettings();
  const sources = settings?.sources ?? [];
  const hasActive = sources.some((s) => (s?.active ?? true) !== false && String(s?.url ?? "").trim());
  if (!settings || !hasActive) return false;
  if (!opts?.force && !canStartByThrottle()) return false;

  markStarted();
  // Nettoyage défensif : d'anciens caches ou fichiers peuvent encore contenir
  // scrapeEvery/scrapeUnit, désormais refusés par la validation stricte du backend.
  const payload = { ...(settings as Record<string, unknown>) };
  delete payload.scrapeEvery;
  delete payload.scrapeUnit;
  await apiJson("/collect/run", { method: "POST", body: JSON.stringify(payload) });
  return true;
}

