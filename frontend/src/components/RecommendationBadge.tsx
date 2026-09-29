import { cn } from "@/lib/utils";
import { CheckCircle, Users, XCircle } from "lucide-react";

type Recommendation = "soumission" | "groupement" | "non_recommande";

const config: Record<Recommendation, { label: string; icon: typeof CheckCircle; className: string }> = {
  soumission: {
    label: "Soumission directe",
    icon: CheckCircle,
    className: "bg-success/10 text-success border-success/20",
  },
  groupement: {
    label: "Groupement",
    icon: Users,
    className: "bg-accent/10 text-accent border-accent/20",
  },
  non_recommande: {
    label: "Non recommandé",
    icon: XCircle,
    className: "bg-destructive/10 text-destructive border-destructive/20",
  },
};

export function RecommendationBadge({ recommendation }: { recommendation: Recommendation }) {
  const { label, icon: Icon, className } = config[recommendation];

  return (
    <div className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border", className)}>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </div>
  );
}
