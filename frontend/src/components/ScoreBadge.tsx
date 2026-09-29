import { cn } from "@/lib/utils";
import { scoreBand, SCORE_BAND_LABEL, type ScoreBand } from "@/lib/opportunity-decision";

interface ScoreBadgeProps {
  score: number;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}

const BAND_COLOR: Record<ScoreBand, string> = {
  high: "bg-score-high text-success-foreground",
  medium: "bg-score-medium text-warning-foreground",
  low: "bg-score-low text-destructive-foreground",
};

export function ScoreBadge({ score, size = "md", showLabel = false }: ScoreBadgeProps) {
  const band = scoreBand(score);
  const getScoreColor = () => BAND_COLOR[band];
  const getLabel = () => SCORE_BAND_LABEL[band];

  const sizeClasses = {
    sm: "h-6 w-6 text-[10px]",
    md: "h-9 w-9 text-xs",
    lg: "h-12 w-12 text-sm",
  };

  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          "rounded-full flex items-center justify-center font-bold font-mono",
          getScoreColor(),
          sizeClasses[size]
        )}
      >
        {score}
      </div>
      {showLabel && (
        <span className="text-xs text-muted-foreground">{getLabel()}</span>
      )}
    </div>
  );
}
