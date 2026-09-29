export type TrashItemType = "partner" | "submitted_opportunity" | "notification" | "opportunity";

export type TrashItem = {
  id: string;
  type: TrashItemType;
  label: string;
  description?: string;
  payload: unknown;
  deletedAt: string;
  expiresAt: string;
};

import { apiJson, pushToServer } from "@/lib/api";
import type { Opportunity } from "@/lib/types";
import { isDeadlinePassed } from "@/lib/opportunity-deadline";
import {
  getSubmissionTracking,
  getEffectivePhase,
  type SubmissionPhase,
} from "@/lib/submission-tracking";

const TRASH_KEY = "app_trash";
const KEPT_OPPS_KEY = "app_trash_kept_opps";
const RETENTION_DAYS = 30;

function writeTrash(items: TrashItem[]) {
  localStorage.setItem(TRASH_KEY, JSON.stringify(items));
}

function readRawTrash(): TrashItem[] {
  try {
    const raw = localStorage.getItem(TRASH_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TrashItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function purgeExpired(items: TrashItem[]): TrashItem[] {
  const now = Date.now();
  return items.filter((item) => new Date(item.expiresAt).getTime() > now);
}

export function getTrashItems(): TrashItem[] {
  const cleaned = purgeExpired(readRawTrash()).sort(
    (a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime(),
  );
  writeTrash(cleaned);
  return cleaned;
}

export function moveToTrash(input: Omit<TrashItem, "id" | "deletedAt" | "expiresAt">) {
  const list = getTrashItems();
  const deletedAt = new Date();
  const expiresAt = new Date(deletedAt);
  expiresAt.setDate(expiresAt.getDate() + RETENTION_DAYS);

  const next: TrashItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    deletedAt: deletedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    ...input,
  };
  writeTrash([next, ...list]);
  pushToServer("/trash", { method: "POST", body: JSON.stringify(next) });
}

export function restoreTrashItem(id: string): TrashItem | null {
  const list = getTrashItems();
  const target = list.find((item) => item.id === id) ?? null;
  writeTrash(list.filter((item) => item.id !== id));
  if (target) pushToServer(`/trash/${encodeURIComponent(id)}/restore`, { method: "POST" });
  return target;
}

export function getTrashItemById(id: string): TrashItem | null {
  const list = getTrashItems();
  return list.find((item) => item.id === id) ?? null;
}

export function removeTrashItem(id: string) {
  const list = getTrashItems();
  writeTrash(list.filter((item) => item.id !== id));
  pushToServer(`/trash/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function permanentlyDeleteTrashItem(id: string) {
  const list = getTrashItems();
  writeTrash(list.filter((item) => item.id !== id));
  pushToServer(`/trash/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Hydratation au démarrage : le serveur fait foi. */
export async function hydrateTrashFromServer(): Promise<void> {
  const data = await apiJson<TrashItem[]>("/trash");
  if (Array.isArray(data)) localStorage.setItem(TRASH_KEY, JSON.stringify(data));
}

// ─── Opportunités expirées non soumises → corbeille (réversible) ──────────────

function getKeptOpportunityIds(): Set<string> {
  try {
    const raw = localStorage.getItem(KEPT_OPPS_KEY);
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

/** Marque un AO comme « conservé » : il ne sera plus remis en corbeille automatiquement. */
export function keepOpportunity(id: string): void {
  if (!id) return;
  const set = getKeptOpportunityIds();
  set.add(id);
  localStorage.setItem(KEPT_OPPS_KEY, JSON.stringify([...set]));
}

/** IDs des opportunités actuellement présentes dans la corbeille. */
export function getTrashedOpportunityIds(): Set<string> {
  const ids = new Set<string>();
  for (const item of getTrashItems()) {
    if (item.type === "opportunity") {
      const pid = (item.payload as { id?: string } | null)?.id;
      if (pid) ids.add(pid);
    }
  }
  return ids;
}

/**
 * Statuts « non engagés » : ces AO partent en corbeille dès que l'échéance est
 * dépassée (aucun intérêt puisqu'ils n'ont pas été soumis).
 */
const TRASHABLE_STATUSES = new Set(["nouveau", "en_analyse", "qualifie"]);

/** Phases terminales du suivi : marché gagné ou rejeté. */
const TERMINAL_PHASES = new Set<SubmissionPhase>(["attribue", "rejete"]);

/** Délai avant qu'une soumission gagnée/rejetée puisse partir en corbeille. */
const OUTCOME_GRACE_DAYS = 30;

/** Nombre de jours écoulés depuis une date ISO ; -1 si date inconnue/illisible. */
function daysSinceIso(iso: string): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return -1;
  return (Date.now() - t) / (1000 * 60 * 60 * 24);
}

/**
 * Déplace en corbeille :
 *  - les AO non engagés (« nouveau », « en_analyse », « qualifie ») dont
 *    l'échéance est dépassée, immédiatement ;
 *  - les soumissions dont l'issue est terminale (gagné ou rejeté) depuis plus de
 *    30 jours.
 * Les soumissions encore en cours de suivi ne sont JAMAIS déplacées. Les AO déjà
 * en corbeille ou explicitement conservés sont ignorés. Retourne le nombre déplacé.
 */
export function syncExpiredOpportunitiesToTrash(opps: Opportunity[]): number {
  const trashed = getTrashedOpportunityIds();
  const kept = getKeptOpportunityIds();
  let moved = 0;
  for (const opp of opps) {
    if (trashed.has(opp.id) || kept.has(opp.id)) continue;

    let reason: string | null = null;
    if (TRASHABLE_STATUSES.has(opp.status)) {
      // AO jamais soumis : corbeille dès l'expiration.
      if (isDeadlinePassed(opp.deadline)) {
        reason = "Échéance de soumission dépassée, non soumis";
      }
    } else if (opp.status === "soumis") {
      // Suivi : seules les issues gagné/rejeté depuis 30 jours partent en corbeille.
      const tracking = getSubmissionTracking(opp.id);
      const phase = getEffectivePhase(tracking);
      if (TERMINAL_PHASES.has(phase) && daysSinceIso(tracking.updatedAt) >= OUTCOME_GRACE_DAYS) {
        reason =
          phase === "attribue"
            ? "Marché gagné, archivé après 30 jours"
            : "Marché rejeté, archivé après 30 jours";
      }
    }

    if (reason) {
      moveToTrash({
        type: "opportunity",
        label: opp.title || opp.id,
        description: reason,
        payload: opp,
      });
      trashed.add(opp.id);
      moved++;
    }
  }
  return moved;
}

