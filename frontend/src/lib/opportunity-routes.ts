export type OpportunityListOrigin = "opportunities" | "favorites";

export type OpportunityListReturn = {
  origin: OpportunityListOrigin;
  page: number;
};

/** Chemin vers la page détail (IDs peuvent contenir des caractères réservés en URL). */
export function opportunityDetailPath(
  id: string,
  listReturn?: OpportunityListReturn,
): string {
  const base = `/opportunities/${encodeURIComponent(id)}`;
  if (!listReturn) return base;
  const params = new URLSearchParams();
  params.set("from", listReturn.origin);
  params.set("page", String(Math.max(1, listReturn.page)));
  return `${base}?${params.toString()}`;
}

export function parseListReturnFromSearch(
  params: URLSearchParams,
): OpportunityListReturn | null {
  const pageRaw = params.get("page");
  if (!pageRaw) return null;
  const page = parseInt(pageRaw, 10);
  if (!Number.isFinite(page) || page < 1) return null;
  const from = params.get("from");
  const origin: OpportunityListOrigin =
    from === "favorites" ? "favorites" : "opportunities";
  return { origin, page };
}

export function listPathWithPage(listReturn: OpportunityListReturn): string {
  const base = listReturn.origin === "favorites" ? "/favorites" : "/opportunities";
  if (listReturn.page <= 1) return base;
  return `${base}?page=${listReturn.page}`;
}

export function parsePageFromSearch(params: URLSearchParams): number {
  const page = parseInt(params.get("page") ?? "1", 10);
  return Number.isFinite(page) && page >= 1 ? page : 1;
}
