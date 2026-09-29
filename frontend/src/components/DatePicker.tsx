import { useMemo, useState } from "react";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function DatePicker({
  label,
  value,
  onChange,
  showTodayWhenEmpty = true,
  disabled,
}: {
  label: string;
  value: Date | undefined;
  onChange: (next: Date | undefined) => void;
  /** Si true, affiche la date du jour même si `value` est vide (sans forcer le filtre). */
  showTodayWhenEmpty?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const displayDate = useMemo(() => {
    if (value) return value;
    if (!showTodayWhenEmpty) return undefined;
    return new Date();
  }, [showTodayWhenEmpty, value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={label || "Choisir une date"}
          className={cn(
            "group w-[220px] rounded-lg border bg-background px-3 py-2 text-left shadow-sm transition-colors",
            "hover:border-primary/30 hover:bg-primary/5",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            disabled && "opacity-60 cursor-not-allowed",
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              {label ? (
                <div className="text-[11px] leading-tight text-muted-foreground">{label}</div>
              ) : null}
              <div className="truncate text-sm font-semibold">
                {displayDate ? format(displayDate, "PPP", { locale: fr }) : "Choisir une date"}
              </div>
            </div>
            <CalendarIcon className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
          </div>
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(d) => {
            const next = d ? startOfDay(d) : undefined;
            onChange(next);
            if (next) setOpen(false);
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}

