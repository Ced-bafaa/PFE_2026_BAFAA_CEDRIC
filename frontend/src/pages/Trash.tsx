import { useEffect, useMemo, useState } from "react";
import { RotateCcw, Trash2, Archive } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  getTrashItems,
  getTrashItemById,
  permanentlyDeleteTrashItem,
  removeTrashItem,
  keepOpportunity,
  TrashItem,
} from "@/lib/trash-store";
import { getPartners, savePartners } from "@/lib/partners-store";
import { setOpportunityStatus } from "@/lib/opportunity-status";
import type { Partner } from "@/lib/types";
import { PaginationControls } from "@/components/PaginationControls";
import { addAuditLog } from "@/lib/audit-logs";
import { restoreNotifications } from "@/lib/notifications-store";

const ITEMS_PER_PAGE = 8;

export default function TrashPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<TrashItem | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const items = useMemo(() => getTrashItems(), [refreshKey]);
  const totalPages = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));
  const paginated = items.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const daysLeft = (expiresAt: string) => {
    const now = new Date();
    const end = new Date(expiresAt);
    const diff = end.getTime() - now.getTime();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  };

  const restoreItem = async (id: string) => {
    const item = getTrashItemById(id);
    if (!item) {
      toast.error("Élément introuvable dans la corbeille.");
      return;
    }

    try {
      if (item.type === "partner") {
        const payload = item.payload as Partner;
        const current = getPartners();
        if (!current.some((partner) => partner.id === payload.id)) {
          savePartners([payload, ...current]);
        }
      }

      if (item.type === "submitted_opportunity") {
        const payload = item.payload as { id: string; restoreStatus?: "soumis" };
        await setOpportunityStatus(payload.id, payload.restoreStatus ?? "soumis");
      }

      if (item.type === "notification") {
        restoreNotifications([item.payload as Parameters<typeof restoreNotifications>[0][number]]);
      }

      if (item.type === "opportunity") {
        // L'AO est toujours en base : on le marque « conservé » pour qu'il ne
        // soit pas redéplacé automatiquement en corbeille, et il réapparaît.
        const payload = item.payload as { id: string };
        keepOpportunity(payload.id);
      }

      removeTrashItem(id);
      toast.success("Élément restauré.");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Erreur inconnue";
      toast.error(`Restauration impossible: ${message}`);
      return;
    }

    addAuditLog({
      action: "restored",
      entityType: item.type,
      entityId: typeof item.payload === "object" && item.payload && "id" in (item.payload as object)
        ? String((item.payload as { id?: string }).id ?? item.id)
        : item.id,
      details: item.label,
    });

    setRefreshKey((value) => value + 1);
  };

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Trash2}
        title="Corbeille"
        description={`${items.length} élément(s) supprimé(s) — suppression automatique après 30 jours`}
      />

      <div className="space-y-3">
        {paginated.map((item) => (
          <div key={item.id} className="bg-card rounded-xl border p-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{item.label}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {item.description ?? "Élément supprimé"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Restant avant suppression définitive: {daysLeft(item.expiresAt)} jour(s)
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => restoreItem(item.id)}>
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                  Restaurer
                </Button>
                <Button variant="outline" size="sm" onClick={() => setPendingDelete(item)}>
                  <Trash2 className="h-3.5 w-3.5 mr-1.5 text-destructive" />
                  Supprimer définitivement
                </Button>
              </div>
            </div>
          </div>
        ))}

        {items.length === 0 && (
          <EmptyState
            icon={Archive}
            title="La corbeille est vide"
            description="Les éléments supprimés apparaîtront ici et seront définitivement effacés après 30 jours."
          />
        )}
        <PaginationControls
          currentPage={currentPage}
          totalItems={items.length}
          itemsPerPage={ITEMS_PER_PAGE}
          onPageChange={setCurrentPage}
        />
      </div>

      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Suppression définitive</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `Supprimer définitivement "${pendingDelete.label}" ? Cette action est irreversible.`
                : "Cette action est irreversible."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!pendingDelete) return;
                permanentlyDeleteTrashItem(pendingDelete.id);
                addAuditLog({
                  action: "deleted_permanently",
                  entityType: pendingDelete.type,
                  entityId: pendingDelete.id,
                  details: pendingDelete.label,
                });
                setPendingDelete(null);
                setRefreshKey((value) => value + 1);
              }}
            >
              Supprimer définitivement
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

