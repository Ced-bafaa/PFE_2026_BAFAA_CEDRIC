import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { LucideIcon, ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: { value: number; positive: boolean };
  className?: string;
  /** Destination au clic — donne à la carte une correspondance concrète. */
  to?: string;
}

export function StatCard({ title, value, subtitle, icon: Icon, trend, className, to }: StatCardProps) {
  const clickable = Boolean(to);
  const content = (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "bg-card rounded-xl border p-5 flex flex-col gap-3 h-full transition-colors",
        clickable && "cursor-pointer hover:border-primary/50 hover:bg-primary/5",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</span>
        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <Icon className="h-4 w-4 text-primary" />
        </div>
      </div>
      <div className="flex items-end gap-2">
        <span className="text-3xl font-bold tracking-tight">{value}</span>
        {trend && (
          <span className={cn("text-xs font-medium mb-1", trend.positive ? "text-success" : "text-destructive")}>
            {trend.positive ? "+" : ""}{trend.value}%
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        {subtitle ? <span className="text-xs text-muted-foreground">{subtitle}</span> : <span />}
        {clickable && <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
      </div>
    </motion.div>
  );

  if (to) {
    return (
      <Link to={to} className="block h-full" aria-label={`Voir : ${title}`}>
        {content}
      </Link>
    );
  }
  return content;
}
