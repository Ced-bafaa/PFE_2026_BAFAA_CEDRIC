import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle, Info, Clock, Trash2, ChevronLeft, Bell, BellOff } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import type { Opportunity } from "@/lib/types";
import { fetchOpportunities } from "@/lib/opportunities-api";
import {
  getNotificationThreads,
  markAllNotificationsAsRead,
  markThreadAsRead,
  deleteThread,
  toggleOppMute,
  upsertDeadlineNotificationsFromOpportunities,
  upsertCollectionSummaryFromOpportunities,
  type AppNotification,
  type NotificationThread,
  type NotificationType,
} from "@/lib/notifications-store";
import { opportunityDetailPath } from "@/lib/opportunity-routes";
import { moveToTrash } from "@/lib/trash-store";
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
import { PaginationControls } from "@/components/PaginationControls";

const ITEMS_PER_PAGE = 8;

const typeConfig: Record<NotificationType, { icon: typeof AlertTriangle; color: string; bg: string }> = {
  urgent: { icon: AlertTriangle, color: "text-destructive", bg: "bg-destructive/10" },
  success: { icon: CheckCircle, color: "text-success", bg: "bg-success/10" },
  info: { icon: Info, color: "text-primary", bg: "bg-primary/10" },
  warning: { icon: Clock, color: "text-accent", bg: "bg-accent/10" },
};

function threadIcon(kind: NotificationThread["kind"], type: NotificationType) {
  if (kind === "system") return { icon: Bell, color: "text-primary", bg: "bg-primary/10" };
  return typeConfig[type];
}

/** Date/heure subtile d'une notification (depuis createdAt, repli sur time). */
function notifTimeLabel(n: { createdAt?: number; time: string }): string {
  if (typeof n.createdAt === "number" && n.createdAt > 0) {
    return new Date(n.createdAt).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return n.time;
}

export default function Notifications() {
  const navigate = useNavigate();
  const [opportunityById, setOpportunityById] = useState<Map<string, Opportunity>>(new Map());
  const [threads, setThreads] = useState<NotificationThread[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [openThreadKey, setOpenThreadKey] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pendingDeleteKey, setPendingDeleteKey] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);

  // Total de messages non lus (tous fils confondus) — pour « Tout marquer comme lu ».
  const totalUnread = useMemo(() => threads.reduce((sum, t) => sum + t.unreadCount, 0), [threads]);
  // Nombre de FILS contenant au moins un message non lu — l'unité cohérente avec
  // « Tous » (qui compte des fils) et avec la liste affichée en mode « Non lus ».
  const unreadThreadCount = useMemo(() => threads.filter((t) => t.unreadCount > 0).length, [threads]);
  const visibleThreads = useMemo(
    () => (unreadOnly ? threads.filter((t) => t.unreadCount > 0) : threads),
    [threads, unreadOnly],
  );
  const totalPages = Math.max(1, Math.ceil(visibleThreads.length / ITEMS_PER_PAGE));
  const paginated = visibleThreads.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const openThread = openThreadKey ? threads.find((t) => t.key === openThreadKey) ?? null : null;

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);


  useEffect(() => {
    const load = async () => {
      const opps = await fetchOpportunities();
      setOpportunityById(new Map(opps.map((o) => [o.id, o])));
      // Notifications DÉRIVÉES : rappels d'échéance + résumé de collecte.
      upsertDeadlineNotificationsFromOpportunities(
        opps.map((o) => ({ id: o.id, title: o.title, deadline: o.deadline, status: o.status, score: o.score })),
      );
      upsertCollectionSummaryFromOpportunities(opps.map((o) => ({ id: o.id, score: o.score })));
      setThreads(getNotificationThreads());
    };
    void load();
  }, [refreshKey]);

  const refresh = () => setRefreshKey((v) => v + 1);

  const enterThread = (key: string) => {
    markThreadAsRead(key); // ouvrir un fil = tout marquer lu (comme une messagerie)
    setOpenThreadKey(key);
    refresh();
  };

  const confirmDeleteThread = () => {
    if (!pendingDeleteKey) return;
    const thread = threads.find((t) => t.key === pendingDeleteKey);
    if (thread) {
      for (const notif of thread.items) {
        moveToTrash({
          type: "notification",
          label: notif.title,
          description: "Notification",
          payload: notif,
        });
      }
      deleteThread(pendingDeleteKey);
    }
    if (openThreadKey === pendingDeleteKey) setOpenThreadKey(null);
    setPendingDeleteKey(null);
    refresh();
  };

  // ---- Vue : détail d'un fil ------------------------------------------------
  if (openThread) {
    const relatedOpp = openThread.opportunityId ? opportunityById.get(openThread.opportunityId) : undefined;
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpenThreadKey(null)}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Retour
          </Button>
        </div>

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight truncate">{openThread.title}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {openThread.total} notification(s) dans ce fil
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {openThread.kind === "ao" && openThread.opportunityId && (
              <Button size="sm" onClick={() => navigate(opportunityDetailPath(openThread.opportunityId!))}>
                Ouvrir l'opportunité
              </Button>
            )}
            {openThread.kind === "ao" && openThread.opportunityId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  toggleOppMute(openThread.opportunityId!);
                  refresh();
                }}
              >
                {openThread.muted ? (
                  <>
                    <Bell className="h-4 w-4 mr-1.5" />
                    Réactiver
                  </>
                ) : (
                  <>
                    <BellOff className="h-4 w-4 mr-1.5" />
                    Mettre en silence
                  </>
                )}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setPendingDeleteKey(openThread.key)}>
              <Trash2 className="h-4 w-4 mr-1.5 text-destructive" />
              Supprimer le fil
            </Button>
          </div>
        </div>

        {relatedOpp && (
          <div className="rounded-md border p-3 bg-muted/20">
            <p className="text-xs text-muted-foreground">Opportunité concernée</p>
            <p className="text-sm font-semibold">{relatedOpp.title}</p>
            <p className="text-xs text-muted-foreground">
              {relatedOpp.id}
              {relatedOpp.deadline
                ? ` — Échéance : ${new Date(relatedOpp.deadline).toLocaleDateString("fr-FR")}`
                : ""}
            </p>
          </div>
        )}

        <div className="relative space-y-3 pl-4 before:absolute before:left-1 before:top-2 before:bottom-2 before:w-px before:bg-border">
          {openThread.items.map((notif: AppNotification, i) => {
            const config = typeConfig[notif.type];
            const Icon = config.icon;
            return (
              <motion.div
                key={notif.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="relative bg-card rounded-xl border p-4 flex items-start gap-3"
              >
                <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center shrink-0", config.bg)}>
                  <Icon className={cn("h-4 w-4", config.color)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-medium">{notif.title}</h3>
                    <span className="text-[10px] text-muted-foreground shrink-0 ml-2">{notifTimeLabel(notif)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{notif.message}</p>
                </div>
              </motion.div>
            );
          })}
        </div>

        <AlertDialog open={Boolean(pendingDeleteKey)} onOpenChange={(open) => !open && setPendingDeleteKey(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Supprimer ce fil de notifications</AlertDialogTitle>
              <AlertDialogDescription>
                Les notifications de ce fil seront déplacées vers la corbeille.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={confirmDeleteThread}
              >
                Supprimer
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  // ---- Vue : liste des fils -------------------------------------------------
  return (
    <div className="space-y-6">
      <PageHeader
        icon={Bell}
        title="Notifications"
        description={`${threads.length} fil(s) de discussion · ${unreadThreadCount} non lu(s)`}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center rounded-lg border bg-muted/30 p-0.5">
          {([
            { key: "all", label: "Tous", active: !unreadOnly, count: threads.length, onClick: () => setUnreadOnly(false) },
            { key: "unread", label: "Non lus", active: unreadOnly, count: unreadThreadCount, onClick: () => setUnreadOnly(true) },
          ] as const).map((seg) => (
            <button
              key={seg.key}
              type="button"
              onClick={seg.onClick}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 h-8 text-xs font-medium transition-colors",
                seg.active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {seg.label}
              <span
                className={cn(
                  "min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold flex items-center justify-center",
                  seg.active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                )}
              >
                {seg.count}
              </span>
            </button>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9"
          disabled={totalUnread === 0}
          onClick={() => {
            markAllNotificationsAsRead();
            refresh();
          }}
        >
          Tout marquer comme lu
        </Button>
      </div>

      {visibleThreads.length === 0 ? (
        <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">
          {unreadOnly ? "Aucune notification non lue." : "Aucune notification pour le moment."}
        </div>
      ) : (
        <div className="space-y-2">
          {paginated.map((thread, i) => {
            const { icon: Icon, color, bg } = threadIcon(thread.kind, thread.latest.type);
            const hasUnread = thread.unreadCount > 0;
            return (
              <motion.div
                key={thread.key}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className={cn(
                  "bg-card rounded-xl border p-4 flex items-start gap-3 cursor-pointer hover:shadow-sm transition-shadow",
                  thread.muted && "opacity-60",
                )}
                onClick={() => enterThread(thread.key)}
              >
                <div className="relative">
                  <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0", bg)}>
                    <Icon className={cn("h-4 w-4", color)} />
                  </div>
                  {hasUnread && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center">
                      {thread.unreadCount}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <h3 className={cn("text-sm truncate", hasUnread ? "font-semibold" : "font-medium")}>
                        {thread.title}
                      </h3>
                      <span className="text-[10px] px-2 py-0.5 rounded-full border border-border text-muted-foreground shrink-0">
                        {thread.total}
                      </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0 ml-2">{notifTimeLabel(thread.latest)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{thread.latest.message}</p>
                </div>
                {thread.kind === "ao" && thread.opportunityId && (
                  <button
                    type="button"
                    className="pt-1 text-muted-foreground hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleOppMute(thread.opportunityId!);
                      refresh();
                    }}
                    aria-label={thread.muted ? `Réactiver ${thread.title}` : `Mettre en silence ${thread.title}`}
                    title={thread.muted ? "Réactiver les notifications" : "Mettre en silence"}
                  >
                    {thread.muted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                  </button>
                )}
                <button
                  type="button"
                  className="pt-1 text-muted-foreground hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPendingDeleteKey(thread.key);
                  }}
                  aria-label={`Supprimer le fil ${thread.title}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </motion.div>
            );
          })}
          <PaginationControls
            currentPage={currentPage}
            totalItems={visibleThreads.length}
            itemsPerPage={ITEMS_PER_PAGE}
            onPageChange={setCurrentPage}
          />
        </div>
      )}

      <AlertDialog open={Boolean(pendingDeleteKey)} onOpenChange={(open) => !open && setPendingDeleteKey(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce fil de notifications</AlertDialogTitle>
            <AlertDialogDescription>
              Les notifications de ce fil seront déplacées vers la corbeille.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDeleteThread}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
