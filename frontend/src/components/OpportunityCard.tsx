import { useMemo, useState } from "react";
import { Opportunity } from "@/lib/types";
import { hasDecisionScore } from "@/lib/opportunity-decision";
import { OpportunityScoreBadge } from "./OpportunityScoreBadge";
import { RecommendationBadge } from "./RecommendationBadge";
import { StatusBadge } from "./StatusBadge";
import { MapPin, Calendar, Banknote, Tag, Star, Send, ChevronDown, ChevronUp, ExternalLink, Bot, CheckCircle2, XCircle, CalendarX } from "lucide-react";
import { isDeadlinePassed } from "@/lib/opportunity-deadline";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { toggleOpportunityFavorite } from "@/lib/favorite-opportunities";
import {
  opportunityDetailPath,
  type OpportunityListReturn,
} from "@/lib/opportunity-routes";
import { markOpportunityAsRead } from "@/lib/read-opportunities";

function safeDateLabel(value: string): string {
  const d = new Date(value);
  const t = d.getTime();
  if (Number.isNaN(t)) return value || "—";
  return d.toLocaleDateString("fr-FR");
}

function extractFirstUrl(text: string): string | null {
  const m = (text ?? "").match(/\bhttps?:\/\/[^\s<]+/i);
  if (!m?.[0]) return null;
  return m[0].replace(/[).,;:!?]+$/g, "");
}

type ParsedDescription = {
  meta: Partial<{
    authority: string;
    type: string;
    region: string;
    closingDateTime: string;
  }>;
  documents: Array<{ href: string; title: string }>;
  body: string;
};

function parseDescription(description: string): ParsedDescription {
  const lines = (description ?? "").split(/\r?\n/);
  const meta: ParsedDescription["meta"] = {};
  const documents: ParsedDescription["documents"] = [];
  const consumed = new Set<number>();

  const readMaybeLink = (startIndex: number, inlineValue: string): string => {
    const trimmedInline = (inlineValue ?? "").trim();
    if (trimmedInline) return trimmedInline;
    for (let i = startIndex + 1; i < Math.min(lines.length, startIndex + 4); i++) {
      const t = (lines[i] ?? "").trim();
      if (!t) continue;
      if (/^https?:\/\//i.test(t)) {
        consumed.add(i);
        return t;
      }
      return "";
    }
    return "";
  };

  for (let i = 0; i < lines.length; i++) {
    if (consumed.has(i)) continue;
    const raw = lines[i] ?? "";
    const match = raw.match(/^\s*([^:]{2,50})\s*:\s*(.*)\s*$/);
    if (!match) continue;

    const key = match[1].trim().toLowerCase();
    const value = match[2] ?? "";

    if (key.includes("mo/ac") || key.includes("autorité") || key.includes("autorite")) {
      meta.authority = readMaybeLink(i, value);
      consumed.add(i);
      continue;
    }
    if (key === "type") {
      meta.type = readMaybeLink(i, value);
      consumed.add(i);
      continue;
    }
    if (key.includes("région") || key.includes("region")) {
      meta.region = readMaybeLink(i, value);
      consumed.add(i);
      continue;
    }
    if (key.includes("clôture") || key.includes("cloture") || key.includes("date limite")) {
      meta.closingDateTime = readMaybeLink(i, value);
      consumed.add(i);
      continue;
    }
    if (key.includes("fiche") || key.includes("téléchargement") || key.includes("telechargement")) {
      const href = readMaybeLink(i, value);
      if (href) {
        documents.push({
          href,
          title: key.includes("télécharg") || key.includes("telecharg") ? "Téléchargement" : "Fiche",
        });
      }
      consumed.add(i);
      continue;
    }
  }

  const body = lines
    .filter((_, idx) => !consumed.has(idx))
    .join("\n")
    .trim();

  return { meta, documents, body };
}

export function OpportunityCard({
  opportunity,
  index = 0,
  isRead = false,
  isFavorite = false,
  onFavoriteChange,
  onMarkedRead,
  onSendToTracking,
  selectable = false,
  selected = false,
  onSelectionChange,
  listReturn,
}: {
  opportunity: Opportunity;
  index?: number;
  isRead?: boolean;
  isFavorite?: boolean;
  onFavoriteChange?: () => void;
  onMarkedRead?: (id: string) => void;
  onSendToTracking?: () => void;
  selectable?: boolean;
  selected?: boolean;
  onSelectionChange?: (next: boolean) => void;
  listReturn?: OpportunityListReturn;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  const isNew = useMemo(() => {
    if (isRead) return false;
    const s = opportunity.scrapedAt;
    if (!s) return false;
    const t = Date.parse(s);
    if (!Number.isFinite(t)) return false;
    const scrapedDate = new Date(t);
    const today = new Date();
    return (
      scrapedDate.getFullYear() === today.getFullYear() &&
      scrapedDate.getMonth() === today.getMonth() &&
      scrapedDate.getDate() === today.getDate()
    );
  }, [opportunity.scrapedAt, isRead]);

  const parsed = useMemo(() => parseDescription(opportunity.description), [opportunity.description]);
  const detailUrlFromDescription = useMemo(
    () => extractFirstUrl(opportunity.description),
    [opportunity.description],
  );
  const primaryDoc = parsed.documents[0]?.href || detailUrlFromDescription;
  const expired = isDeadlinePassed(opportunity.deadline);

  const handleFavoriteToggle = () => {
    void (async () => {
      await toggleOpportunityFavorite(opportunity.id);
      onFavoriteChange?.();
    })();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className={[
        "group bg-card rounded-xl border transition-all duration-200",
        "hover:shadow-md hover:border-primary/20",
        !isRead ? "border-l-[3px] border-l-primary/60" : "",
      ].join(" ")}
    >
      {/* ── Corps principal cliquable ── */}
      <Link
        to={opportunityDetailPath(opportunity.id, listReturn)}
        state={listReturn ? { listReturn } : undefined}
        className="block px-5 pt-4 pb-3 cursor-pointer"
      >
        {/* Ligne 1 : badges + score */}
        <div className="flex items-center justify-between gap-3 mb-2.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            {selectable && (
              <input
                type="checkbox"
                checked={selected}
                onChange={(event) => onSelectionChange?.(event.target.checked)}
                onClick={(event) => event.stopPropagation()}
                aria-label={`Selectionner ${opportunity.id}`}
                className="mr-0.5"
              />
            )}
            {isNew ? (
              <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 border border-blue-500/20 font-semibold">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue-500" />
                </span>
                Nouveau
              </span>
            ) : null}
            {opportunity.status !== "nouveau" ? (
              <StatusBadge status={opportunity.status} />
            ) : null}
            {expired && (
              <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border font-semibold">
                <CalendarX className="h-3 w-3" /> Clôturé
              </span>
            )}
          </div>

          {/* Score + recommandation */}
          <div className="flex items-center gap-2 shrink-0">
            <OpportunityScoreBadge opportunity={opportunity} size="lg" />
            {hasDecisionScore(opportunity) ? (
              <RecommendationBadge recommendation={opportunity.recommendation} />
            ) : null}
          </div>
        </div>

        {/* Titre */}
        <h3 className="text-sm font-semibold leading-snug group-hover:text-primary transition-colors line-clamp-2 mb-3">
          {opportunity.title}
        </h3>

        {/* Méta condensée */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {opportunity.location ? (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate max-w-[160px]">{opportunity.location}</span>
            </span>
          ) : null}
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Calendar className="h-3 w-3 shrink-0" />
            {safeDateLabel(opportunity.publishedAt)} → {safeDateLabel(opportunity.deadline)}
          </span>
          {opportunity.budget ? (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Banknote className="h-3 w-3 shrink-0" />
              {opportunity.budget}
            </span>
          ) : null}
          {opportunity.domain ? (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground/60">
              <Tag className="h-3 w-3 shrink-0" />
              {opportunity.domain}
            </span>
          ) : null}
        </div>
      </Link>

      {/* ── Pied : source + actions ── */}
      <div className="flex items-center justify-between px-5 pb-3">
        <span className="text-[10px] text-muted-foreground/40 font-mono">
          {opportunity.source || "armp.cm"}
        </span>

        <div className="flex items-center gap-0.5">
          {primaryDoc ? (
            <a
              href={primaryDoc}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            >
              DAO <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
          {opportunity.status !== "soumis" && onSendToTracking && (
            <Button
              variant="ghost"
              size="sm"
              disabled={expired}
              title={expired ? "Échéance dépassée : soumission impossible" : undefined}
              className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (!expired) onSendToTracking(); }}
            >
              <Send className="h-3 w-3 mr-1" /> Soumettre
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={`h-7 w-7 ${isFavorite ? "text-yellow-500" : "text-muted-foreground/40 hover:text-yellow-500"}`}
            aria-label={isFavorite ? "Retirer des pertinents" : "Marquer comme pertinent"}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleFavoriteToggle(); }}
          >
            <Star className={`h-3.5 w-3.5 ${isFavorite ? "fill-yellow-400" : ""}`} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDetailsOpen((v) => {
                const next = !v;
                if (next && !isRead) {
                  void markOpportunityAsRead(opportunity.id)
                    .then(() => onMarkedRead?.(opportunity.id))
                    .catch(() => { /* backend indispo */ });
                }
                return next;
              });
            }}
            className="h-7 w-7 text-muted-foreground/40 hover:text-foreground"
            aria-expanded={detailsOpen}
            aria-controls={`opp-details-${opportunity.id}`}
          >
            {detailsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {/* ── Panneau détails dépliable ── */}
      <AnimatePresence initial={false}>
        {detailsOpen ? (
          <motion.div
            id={`opp-details-${opportunity.id}`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mx-4 mb-4 rounded-lg border bg-muted/10 px-4 py-3 space-y-3">
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                {parsed.meta.authority ? (
                  <div className="text-muted-foreground col-span-2">
                    <span className="font-medium text-foreground/70">MO/AC</span> — {parsed.meta.authority}
                  </div>
                ) : null}
                <div className="text-muted-foreground">
                  <span className="font-medium text-foreground/70">Type</span> — {parsed.meta.type || opportunity.domain || "—"}
                </div>
                <div className="text-muted-foreground">
                  <span className="font-medium text-foreground/70">Montant</span> — {opportunity.budget || "—"}
                </div>
                <div className="text-muted-foreground">
                  <span className="font-medium text-foreground/70">Région</span> — {parsed.meta.region || opportunity.location || "—"}
                </div>
                <div className="text-muted-foreground">
                  <span className="font-medium text-foreground/70">Clôture</span> — {safeDateLabel(opportunity.deadline)}
                </div>
              </div>

              {parsed.body ? (
                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4 border-t pt-2.5">
                  {parsed.body}
                </p>
              ) : null}

              {opportunity.qualitativeAnalysis?.ollama_available ? (
                <div className="border-t pt-2.5 space-y-1.5">
                  <p className="text-[11px] font-medium text-foreground/70 flex items-center gap-1">
                    <Bot className="h-3 w-3 text-primary" /> Analyse IA
                  </p>
                  {opportunity.qualitativeAnalysis.resume ? (
                    <p className="text-xs text-muted-foreground italic leading-relaxed line-clamp-2">
                      {opportunity.qualitativeAnalysis.resume}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                    {opportunity.qualitativeAnalysis.points_forts.slice(0, 2).map((pt, i) => (
                      <span key={i} className="flex items-start gap-1 text-xs text-green-700 dark:text-green-400">
                        <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0" /> {pt}
                      </span>
                    ))}
                    {opportunity.qualitativeAnalysis.points_bloquants.slice(0, 2).map((pt, i) => (
                      <span key={i} className="flex items-start gap-1 text-xs text-red-600 dark:text-red-400">
                        <XCircle className="h-3 w-3 mt-0.5 shrink-0" /> {pt}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}
