import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type PaginationControlsProps = {
  currentPage: number;
  totalItems: number;
  itemsPerPage: number;
  onPageChange: (page: number) => void;
};

export function PaginationControls({
  currentPage,
  totalItems,
  itemsPerPage,
  onPageChange,
}: PaginationControlsProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
  const start = totalItems === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
  const end = Math.min(currentPage * itemsPerPage, totalItems);

  // Valeur du champ « page » : libre pendant la saisie, resynchronisée au besoin.
  const [pageInput, setPageInput] = useState(String(currentPage));
  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  if (totalItems <= itemsPerPage) return null;

  // Valide la saisie : borne à [1, totalPages] et navigue si la page change.
  const commitPageInput = () => {
    const parsed = Number.parseInt(pageInput, 10);
    if (Number.isNaN(parsed)) {
      setPageInput(String(currentPage));
      return;
    }
    const target = Math.min(totalPages, Math.max(1, parsed));
    setPageInput(String(target));
    if (target !== currentPage) onPageChange(target);
  };

  return (
    <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-muted-foreground">
        Éléments {start}–{end} sur {totalItems}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          Précédent
        </Button>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>Page</span>
          <input
            type="text"
            inputMode="numeric"
            aria-label={`Numéro de page, sur ${totalPages}`}
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value.replace(/[^\d]/g, ""))}
            onFocus={(e) => e.target.select()}
            onBlur={commitPageInput}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitPageInput();
                e.currentTarget.blur();
              } else if (e.key === "Escape") {
                setPageInput(String(currentPage));
                e.currentTarget.blur();
              }
            }}
            className="h-8 w-11 rounded-md border bg-background px-1 text-center text-xs text-foreground tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
          />
          <span>/ {totalPages}</span>
        </div>

        <Button
          variant="outline"
          size="sm"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
        >
          Suivant
        </Button>
      </div>
    </div>
  );
}
