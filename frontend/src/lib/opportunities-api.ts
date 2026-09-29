import type { Opportunity } from "@/lib/types";
import { apiJson, getApiBaseUrl, getAuthHeaders } from "./api";
import {
  getTrashedOpportunityIds,
  syncExpiredOpportunitiesToTrash,
} from "@/lib/trash-store";

const OPPORTUNITIES_CACHE_KEY = "opportunities_cache_v2";

type OpportunitiesCache = {
  savedAtIso: string;
  items: Opportunity[];
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isNotExpired(opp: Opportunity): boolean {
  const d = String(opp.deadline ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d >= todayIso();
  // Si format inconnu, on préfère l'afficher plutôt que de le masquer.
  return true;
}

function readOpportunitiesCache(): Opportunity[] {
  try {
    const raw = localStorage.getItem(OPPORTUNITIES_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<OpportunitiesCache>;
    if (!parsed || !Array.isArray(parsed.items)) return [];
    return (parsed.items as Opportunity[]).filter(Boolean).filter(isNotExpired);
  } catch {
    return [];
  }
}

function writeOpportunitiesCache(items: Opportunity[]): void {
  try {
    const payload: OpportunitiesCache = {
      savedAtIso: new Date().toISOString(),
      items: items.filter(Boolean),
    };
    localStorage.setItem(OPPORTUNITIES_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // ignore quota / private mode issues
  }
}

export async function fetchOpportunities(): Promise<Opportunity[]> {
  let items: Opportunity[];
  try {
    const data = await apiJson<unknown>("/opportunities");
    items = Array.isArray(data) ? (data as Opportunity[]) : [];
    writeOpportunitiesCache(items);
  } catch {
    // Backend indisponible: fallback sur cache local (dernier succès).
    items = readOpportunitiesCache();
  }
  // Corbeille automatique : les AO expirés non soumis y sont déplacés, partout
  // (tableau de bord, notifications, suivi, etc.), puis exclus des listes.
  syncExpiredOpportunitiesToTrash(items);
  const trashed = getTrashedOpportunityIds();
  return items.filter((o) => !trashed.has(o.id));
}

export async function fetchOpportunity(id: string): Promise<Opportunity> {
  return apiJson<Opportunity>(`/opportunities/${encodeURIComponent(id)}`);
}

export async function fetchReadOpportunityIds(): Promise<string[]> {
  const data = await apiJson<unknown>("/opportunities-read");
  return Array.isArray(data) ? data.map(String) : [];
}

export async function fetchFavoriteOpportunityIds(): Promise<string[]> {
  const data = await apiJson<unknown>("/favorites");
  return Array.isArray(data) ? data.map(String) : [];
}

export async function markOpportunityAsRead(id: string): Promise<void> {
  await apiJson(`/opportunities/${encodeURIComponent(id)}/read`, {
    method: "POST",
  });
}

export async function toggleOpportunityFavorite(id: string): Promise<boolean> {
  const r = await apiJson<{ favorite: boolean }>(
    `/favorites/${encodeURIComponent(id)}/toggle`,
    { method: "POST" },
  );
  return r.favorite;
}

export async function patchOpportunityStatus(
  id: string,
  status: Opportunity["status"],
): Promise<void> {
  await apiJson(`/opportunities/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

/** URL du PDF justificatif (GET, `inline` côté serveur). */
export function getOpportunityJustificatifPdfUrl(id: string): string {
  return `${getApiBaseUrl()}/opportunities/${encodeURIComponent(id)}/justificatif`;
}

/** Soumet une opportunité sans fichier (le justificatif peut être ajouté plus tard). */
export async function submitOpportunity(id: string): Promise<void> {
  await patchOpportunityStatus(id, "soumis");
}

export async function submitOpportunityWithJustificatif(
  id: string,
  file: File,
): Promise<void> {
  const url = `${getApiBaseUrl()}/opportunities/${encodeURIComponent(id)}/submit`;
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(url, { method: "POST", headers: getAuthHeaders(), body });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 400)}`);
  }
}

export async function scoreOpportunity(id: string): Promise<Opportunity> {
  return apiJson<Opportunity>(`/opportunities/${encodeURIComponent(id)}/score`, {
    method: "POST",
  });
}

export async function scorePendingOpportunities(): Promise<{
  scored: number;
  skipped: number;
  errors: string[];
}> {
  return apiJson(`/opportunities/score-pending`, { method: "POST" });
}

export async function downloadOpportunityJustificatif(
  id: string,
  fileName: string,
): Promise<void> {
  const res = await fetch(getOpportunityJustificatifPdfUrl(id), { headers: getAuthHeaders() });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text.slice(0, 200)}`);
  }
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName || "justificatif.pdf";
  a.click();
  URL.revokeObjectURL(a.href);
}
