import type { Opportunity } from "@/lib/types";
import { hasDecisionScore } from "@/lib/opportunity-decision";
import { ScoreBadge } from "./ScoreBadge";
import { ScorePendingBadge } from "./ScorePendingBadge";

type Props = {
  opportunity: Opportunity;
  size?: "sm" | "md" | "lg";
};

/**
 * Affiche le score réel après analyse, sinon un cercle « en attente »
 * (pas le score heuristique ARMP d'import).
 */
export function OpportunityScoreBadge({ opportunity, size = "lg" }: Props) {
  if (!hasDecisionScore(opportunity)) {
    return <ScorePendingBadge size={size} />;
  }
  return <ScoreBadge score={opportunity.score} size={size} />;
}
