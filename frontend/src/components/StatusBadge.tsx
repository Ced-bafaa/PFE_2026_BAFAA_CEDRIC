import { cn } from "@/lib/utils";

type Status = "nouveau" | "en_analyse" | "qualifie" | "soumis" | "gagne" | "perdu";

const statusConfig: Record<Status, { label: string; className: string }> = {
  nouveau: { label: "Nouveau", className: "bg-primary/10 text-primary" },
  en_analyse: { label: "En analyse", className: "bg-accent/10 text-accent" },
  qualifie: { label: "Qualifié", className: "bg-success/10 text-success" },
  soumis: { label: "Soumis", className: "bg-secondary text-secondary-foreground" },
  gagne: { label: "Gagné", className: "bg-success/15 text-success font-semibold" },
  perdu: { label: "Perdu", className: "bg-destructive/10 text-destructive" },
};

export function StatusBadge({ status }: { status: Status }) {
  const { label, className } = statusConfig[status];
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium", className)}>
      {label}
    </span>
  );
}
