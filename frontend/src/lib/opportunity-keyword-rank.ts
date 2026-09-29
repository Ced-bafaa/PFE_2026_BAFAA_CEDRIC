import type { Opportunity } from "@/lib/types";
import { hasDecisionScore } from "@/lib/opportunity-decision";
import { SOURCES_SETTINGS_KEY } from "@/lib/sources-settings-key";

type SourceItem = {
  id: string;
  title: string;
  url: string;
  active: boolean;
  keywords: string[];
};

type SourcesSettings = {
  globalKeywords: string[];
  sources: SourceItem[];
};

function normalizeKeywordList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function readSourcesSettings(): SourcesSettings | null {
  try {
    const raw = localStorage.getItem(SOURCES_SETTINGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SourcesSettings> & { sources?: unknown };
    const globalKeywords = normalizeKeywordList(parsed.globalKeywords);
    let sources: SourceItem[] = [];
    if (Array.isArray(parsed.sources)) {
      sources = parsed.sources
        .map((item, index) => {
          if (!item || typeof item !== "object") return null;
          const s = item as Partial<SourceItem>;
          if (typeof s.title !== "string" || typeof s.url !== "string") return null;
          return {
            id: typeof s.id === "string" ? s.id : `SRC-${String(index + 1).padStart(3, "0")}`,
            title: s.title,
            url: s.url,
            active: s.active !== false,
            keywords: normalizeKeywordList(s.keywords),
          };
        })
        .filter((x): x is SourceItem => Boolean(x));
    }
    return { globalKeywords, sources };
  } catch {
    return null;
  }
}

/** Correspondance entre une source configurée et le champ `opportunity.source` (ex. `ARMP — …`). */
export function sourceConfigMatchesOpportunity(opp: Opportunity, item: SourceItem): boolean {
  if (!item.active) return false;
  const os = opp.source.toLowerCase().trim();
  const title = item.title.toLowerCase().trim();
  if (!title) return false;
  if (os.includes(title)) return true;
  const armpPrefix = "armp — ";
  if (os.startsWith(armpPrefix)) {
    const rest = os.slice(armpPrefix.length);
    if (rest.includes(title) || title.includes(rest)) return true;
  }
  try {
    const host = new URL(item.url).hostname.replace(/^www\./i, "");
    if (host && opp.description.toLowerCase().includes(host)) return true;
  } catch {
    /* ignore invalid URL */
  }
  return false;
}

/** Mots-clés applicables à une opportunité : globaux + ceux des sources qui matchent. */
export function keywordsForOpportunity(opp: Opportunity, settings: SourcesSettings): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const add = (raw: string) => {
    const k = raw.trim();
    if (!k) return;
    const lower = k.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    out.push(k);
  };

  for (const k of settings.globalKeywords) add(k);
  for (const src of settings.sources) {
    if (!sourceConfigMatchesOpportunity(opp, src)) continue;
    for (const k of src.keywords) add(k);
  }
  return out;
}

/** Score de pertinence : plus le résultat est élevé, plus l’opportunité correspond aux mots-clés. */
export function keywordRelevanceScore(opp: Opportunity, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const text = `${opp.title}\n${opp.description}\n${opp.domain}\n${opp.location}\n${opp.source}`.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    const k = kw.trim().toLowerCase();
    if (!k) continue;
    if (!text.includes(k)) continue;
    score += 10 + Math.min(30, k.length);
    if (k.length >= 4) {
      const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      try {
        const re = new RegExp(`(^|[^a-z0-9àâäéèêëïîôùûüç])${escaped}([^a-z0-9àâäéèêëïîôùûüç]|$)`, "i");
        if (re.test(text)) score += 8;
      } catch {
        /* ignore */
      }
    }
  }
  return score;
}

export function hasAnyKeywordConfigured(): boolean {
  const s = readSourcesSettings();
  if (!s) return false;
  if (s.globalKeywords.some((k) => k.trim())) return true;
  return s.sources.some((src) => src.keywords.some((k) => k.trim()));
}

/**
 * Trie les opportunités : meilleure adéquation aux mots-clés en premier.
 * Sans mots-clés configurés, renvoie l’ordre d’origine.
 */
export function sortOpportunitiesByKeywordRelevance(opportunities: Opportunity[]): Opportunity[] {
  const settings = readSourcesSettings();
  if (!settings || !hasAnyKeywordConfigured()) {
    return opportunities;
  }

  return [...opportunities].sort((a, b) => {
    const kwa = keywordsForOpportunity(a, settings);
    const kwb = keywordsForOpportunity(b, settings);
    const sa = keywordRelevanceScore(a, kwa);
    const sb = keywordRelevanceScore(b, kwb);
    if (sb !== sa) return sb - sa;
    const aScored = hasDecisionScore(a);
    const bScored = hasDecisionScore(b);
    if (aScored && bScored && b.score !== a.score) return b.score - a.score;
    if (aScored !== bScored) return aScored ? -1 : 1;
    const ta = new Date(a.publishedAt).getTime();
    const tb = new Date(b.publishedAt).getTime();
    return tb - ta;
  });
}
