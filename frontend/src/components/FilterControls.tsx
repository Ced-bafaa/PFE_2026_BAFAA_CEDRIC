import type { ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Contrôle segmenté (pilules) — plus fluide qu'une liste déroulante pour les
 * filtres à options fixes et peu nombreuses. Partagé entre Opportunités et Pertinent.
 */
export function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:bg-muted/50 hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Section de filtre du panneau : en-tête (icône + titre) + contenu, avec
 * séparateur au-dessus (sauf la première) pour une lecture structurée.
 */
export function FilterSection({
  icon: Icon,
  title,
  first = false,
  children,
}: {
  icon: ElementType;
  title: string;
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-2", first ? "" : "border-t pt-4")}>
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      </div>
      {children}
    </div>
  );
}
