/**
 * Hydratation des caches locaux depuis le backend, au démarrage de l'application.
 *
 * Pattern write-through :
 *   lecture  → cache localStorage (synchrone, aucune refonte des pages)
 *   écriture → cache local + réplication API (pushToServer, fire-and-forget)
 *   démarrage → le serveur fait foi : les caches sont remplacés par l'état serveur
 *
 * Si le backend est indisponible, chaque hydratation échoue silencieusement et
 * l'application démarre sur le dernier état local connu (mode dégradé).
 */
import { hydratePartnersFromServer } from "@/lib/partners-store";
import { hydrateTrashFromServer } from "@/lib/trash-store";
import { hydrateTrackingFromServer } from "@/lib/submission-tracking";
import { hydrateAuditLogsFromServer } from "@/lib/audit-logs";
import { hydrateSourcesFromServer } from "@/lib/sources-store";

const HYDRATION_TIMEOUT_MS = 2500;

async function safely(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.warn(`[sync] hydratation ${label} impossible — cache local conservé.`, err);
  }
}

export async function hydrateStoresFromServer(): Promise<void> {
  const all = Promise.all([
    safely("partenaires", hydratePartnersFromServer),
    safely("corbeille", hydrateTrashFromServer),
    safely("suivi de soumission", hydrateTrackingFromServer),
    safely("journaux d'audit", hydrateAuditLogsFromServer),
    safely("sources", hydrateSourcesFromServer),
  ]).then(() => undefined);

  // Garde-fou : ne jamais bloquer le premier rendu plus de 2,5 s
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, HYDRATION_TIMEOUT_MS));
  await Promise.race([all, timeout]);
}
