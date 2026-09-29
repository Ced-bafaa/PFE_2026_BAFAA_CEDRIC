import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

type Size = "sm" | "md" | "lg";

const sizeClasses: Record<Size, { ring: string; icon: string }> = {
  sm: { ring: "h-6 w-6", icon: "h-3 w-3" },
  md: { ring: "h-9 w-9", icon: "h-4 w-4" },
  lg: { ring: "h-12 w-12", icon: "h-5 w-5" },
};

type Props = {
  size?: Size;
  className?: string;
};

/** Cercle vide — score pas encore calculé (PDF non extrait ou scoring en cours). */
export function ScorePendingBadge({ size = "md", className }: Props) {
  const s = sizeClasses[size];
  return (
    <div
      className={cn("flex items-center gap-2", className)}
      title="Analyse en attente — le score s'affichera après extraction du DAO"
    >
      <div
        className={cn(
          "rounded-full border-2 border-dashed border-muted-foreground/35",
          "bg-muted/30 flex items-center justify-center",
          "animate-pulse",
          s.ring,
        )}
        aria-label="Score en attente"
      >
        <Clock className={cn("text-muted-foreground/60", s.icon)} strokeWidth={1.75} />
      </div>
    </div>
  );
}
