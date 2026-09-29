/**
 * NOTE ARCHITECTURE — les notifications sont des données DÉRIVÉES :
 * elles sont régénérées au chargement à partir des opportunités
 * (échéances, nouveautés de collecte). Elles ne sont volontairement PAS
 * synchronisées avec le serveur, contrairement aux données primaires
 * (partenaires, corbeille, suivi de soumission, journaux d'audit) qui suivent
 * le pattern write-through (voir lib/api.ts pushToServer).
 *
 * REGROUPEMENT EN FILS — chaque notification porte une `threadKey` :
 *   - AO           → `ao:{opportunityId}`  (tous les rappels d'un même appel
 *                     d'offres : J-30, J-21, … J-0, forment un seul fil)
 *   - Collecte     → `system:collecte`     (résumés des collectes successives)
 * L'interface affiche la liste des FILS (aperçu du dernier message + badge de
 * non-lues) ; au clic on déroule l'historique chronologique du fil.
 */
export type NotificationType = "urgent" | "success" | "info" | "warning";

export type AppNotification = {
  id: number;
  type: NotificationType;
  title: string;
  message: string;
  time: string;
  read: boolean;
  opportunityId?: string;
  /** Horodatage de création (ms epoch) — ordonnancement chronologique. */
  createdAt?: number;
  /** Clé de regroupement en fil. */
  threadKey?: string;
  /** Libellé du fil (titre de l'AO, « Collecte », …). */
  threadTitle?: string;
  /** Aide au tri intra-fil (plus petit = plus tôt). */
  orderHint?: number;
};

export type NotificationThread = {
  key: string;
  title: string;
  kind: "ao" | "system";
  items: AppNotification[]; // triés chronologiquement (ancien → récent)
  latest: AppNotification; // message le plus récent
  unreadCount: number;
  total: number;
  opportunityId?: string;
  /** AO mis en silence : le fil reste visible mais ne compte plus de non-lues. */
  muted?: boolean;
};

const NOTIFICATIONS_KEY = "notifications_data";
const NOTIFICATIONS_DELETED_KEY = "notifications_deleted_ids";
const KNOWN_OPP_IDS_KEY = "notifications_known_opp_ids_v1";
const NOTIFICATIONS_SETTINGS_KEY = "notifications_settings";

// --- Réglages utilisateur (filtrage + intensité) -----------------------------

type NotifSettings = {
  urgencyOnly: boolean;
  categories: Record<NotificationType, boolean>;
};

const DEFAULT_NOTIF_SETTINGS: NotifSettings = {
  urgencyOnly: false,
  categories: { urgent: true, success: true, warning: true, info: true },
};

/** Lit les réglages persistés (tolérant à l'ancien format ou à l'absence). */
function readNotifSettings(): NotifSettings {
  try {
    const raw = localStorage.getItem(NOTIFICATIONS_SETTINGS_KEY);
    if (!raw) return DEFAULT_NOTIF_SETTINGS;
    const p = JSON.parse(raw) as any;
    const f = p?.filters ?? {};
    const cats = f?.categories ?? {};
    return {
      urgencyOnly: Boolean(f?.urgencyOnly),
      categories: {
        urgent: cats.urgent !== false,
        success: cats.success !== false,
        warning: cats.warning !== false,
        info: cats.info !== false,
      },
    };
  } catch {
    return DEFAULT_NOTIF_SETTINGS;
  }
}

// --- Mode silence par AO -----------------------------------------------------
// Un AO peut être « mis en silence » : on n'émet plus AUCUNE notification pour
// lui (rappels d'échéance et changements de phase), et ses non-lues ne comptent
// plus dans le badge. Réversible. Persisté par navigateur (comme le reste des
// notifications, cf. note d'architecture en tête de fichier).

const MUTED_OPP_IDS_KEY = "notifications_muted_opp_ids_v1";

export function getMutedOppIds(): Set<string> {
  try {
    const raw = localStorage.getItem(MUTED_OPP_IDS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function writeMutedOppIds(ids: Set<string>) {
  localStorage.setItem(MUTED_OPP_IDS_KEY, JSON.stringify(Array.from(ids)));
  window.dispatchEvent(new CustomEvent("notifications-updated"));
}

export function isOppMuted(id: string): boolean {
  return getMutedOppIds().has(id);
}

export function muteOpp(id: string) {
  const ids = getMutedOppIds();
  if (ids.has(id)) return;
  ids.add(id);
  writeMutedOppIds(ids);
}

export function unmuteOpp(id: string) {
  const ids = getMutedOppIds();
  if (!ids.delete(id)) return;
  writeMutedOppIds(ids);
}

export function toggleOppMute(id: string): boolean {
  const ids = getMutedOppIds();
  const nowMuted = !ids.has(id);
  if (nowMuted) ids.add(id);
  else ids.delete(id);
  writeMutedOppIds(ids);
  return nowMuted;
}

/** Une notification est-elle visible compte tenu des filtres utilisateur ? */
function isNotificationVisible(n: AppNotification, s: NotifSettings): boolean {
  if (s.urgencyOnly) return n.type === "urgent";
  return s.categories[n.type] !== false;
}

const SYSTEM_COLLECTE_KEY = "system:collecte";
const SYSTEM_COLLECTE_TITLE = "Collecte";

function hashToInt32(input: string): number {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

function startOfTodayLocal(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseIsoDateOnly(v: string): Date | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); // ISO yyyy-mm-dd
  if (m) {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/); // jj/mm/aaaa ou jj-mm-aaaa
  if (m) {
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    d.setHours(0, 0, 0, 0);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function daysBetweenLocal(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

// --- Échéance : rappel hebdomadaire ------------------------------------------

const SCORE_GO = 70;
const SCORE_STUDY = 50;

/**
 * Semaine ISO d'une date, au format `AAAA-Www` (la semaine commence le lundi).
 * Sert de clé de déduplication : un seul rappel d'échéance par AO et par semaine.
 */
function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // lundi = 0 … dimanche = 6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // jeudi de la semaine courante
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((d.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Gravité du rappel hebdomadaire selon le nombre de jours restants. */
function weeklySeverity(daysLeft: number): { type: NotificationType; prefix: string } {
  if (daysLeft <= 3) return { type: "urgent", prefix: "Échéance proche" };
  if (daysLeft <= 7) return { type: "warning", prefix: "Échéance cette semaine" };
  return { type: "info", prefix: "Rappel hebdomadaire" };
}

function deadlineMessage(daysLeft: number, score?: number): string {
  const scoreTxt = typeof score === "number" ? ` Score : ${score}/100.` : "";
  if (daysLeft <= 0) return `Clôture aujourd'hui. Action immédiate recommandée.${scoreTxt}`;
  const action = daysLeft <= 3 ? " Vérification du dossier recommandée." : "";
  return `Échéance dans ${daysLeft} jour(s).${action}${scoreTxt}`;
}

// --- Persistance -------------------------------------------------------------

const seedNotifications: AppNotification[] = [];

function threadKeyFor(item: AppNotification): string {
  if (item.threadKey) return item.threadKey;
  if (item.opportunityId) return `ao:${item.opportunityId}`;
  return "system:divers";
}

function sanitizeNotification(input: unknown): AppNotification | null {
  if (!input || typeof input !== "object") return null;
  const item = input as Partial<AppNotification>;

  if (typeof item.id !== "number") return null;
  if (typeof item.title !== "string" || typeof item.message !== "string" || typeof item.time !== "string") {
    return null;
  }

  const allowedTypes: NotificationType[] = ["urgent", "success", "info", "warning"];
  const type = allowedTypes.includes(item.type as NotificationType) ? (item.type as NotificationType) : "info";

  const base: AppNotification = {
    id: item.id,
    type,
    title: item.title,
    message: item.message,
    time: item.time,
    read: Boolean(item.read),
    opportunityId: typeof item.opportunityId === "string" ? item.opportunityId : undefined,
    createdAt: typeof item.createdAt === "number" ? item.createdAt : 0,
    threadKey: typeof item.threadKey === "string" ? item.threadKey : undefined,
    threadTitle: typeof item.threadTitle === "string" ? item.threadTitle : undefined,
    orderHint: typeof item.orderHint === "number" ? item.orderHint : undefined,
  };
  // Migration : dériver la clé de fil pour les anciennes notifications.
  if (!base.threadKey) base.threadKey = threadKeyFor(base);
  return base;
}

function persistNotifications(items: AppNotification[]) {
  localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(items));
}

function readDeletedIds(): Set<number> {
  try {
    const raw = localStorage.getItem(NOTIFICATIONS_DELETED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    const ids = parsed.filter((x) => typeof x === "number");
    return new Set(ids);
  } catch {
    return new Set();
  }
}

function writeDeletedIds(ids: Set<number>) {
  localStorage.setItem(NOTIFICATIONS_DELETED_KEY, JSON.stringify(Array.from(ids)));
}

function writeNotifications(items: AppNotification[]) {
  // Idempotent : si rien n'a changé, ne pas réécrire ni émettre d'événement.
  // Évite les boucles (un abonné à « notifications-updated » qui régénère les
  // notifications pourrait sinon se ré-déclencher indéfiniment).
  const next = JSON.stringify(items);
  let prev: string | null = null;
  try {
    prev = localStorage.getItem(NOTIFICATIONS_KEY);
  } catch {
    /* ignore */
  }
  if (prev === next) return;
  try {
    localStorage.setItem(NOTIFICATIONS_KEY, next);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent("notifications-updated"));
}

function mergeNotificationsKeepReadState(
  current: AppNotification[],
  incoming: AppNotification[],
): AppNotification[] {
  const byId = new Map<number, AppNotification>(current.map((n) => [n.id, n]));
  for (const inc of incoming) {
    const existing = byId.get(inc.id);
    if (existing) {
      // On préserve l'état lu et l'horodatage d'origine.
      byId.set(inc.id, { ...inc, read: existing.read, createdAt: existing.createdAt ?? inc.createdAt });
    } else {
      byId.set(inc.id, inc);
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.id - b.id);
}

// --- Génération : rappels d'échéance ----------------------------------------

/**
 * Rappels d'échéance par appel d'offres : UN SEUL rappel par semaine (clé de
 * semaine ISO, qui commence le lundi), pour les AO GO ou à étudier (score ≥ 50),
 * non soumis, non expirés et non mis en silence. Le premier chargement de la
 * semaine matérialise le rappel. IDs stables (`deadline:{oppId}:{semaineISO}`)
 * → un seul par AO et par semaine, état lu conservé.
 */
export function upsertDeadlineNotificationsFromOpportunities(
  opportunities: Array<{ id: string; title: string; deadline: string; status?: string; score?: number }>,
) {
  const today = startOfTodayLocal();
  const now = Date.now();
  const muted = getMutedOppIds();
  const weekKey = isoWeekKey(new Date());
  const incoming: AppNotification[] = [];

  for (const opp of opportunities) {
    if (!opp?.id) continue;
    if (muted.has(opp.id)) continue; // en silence : aucune notification
    // Les AO déjà « soumis » ont leur suivi dédié.
    if (String(opp.status ?? "").toLowerCase() === "soumis") continue;
    // Portée : uniquement GO et à étudier (score ≥ 50). Les AO faibles ou non
    // encore scorés ne génèrent pas de rappel hebdomadaire.
    if (!(typeof opp.score === "number" && opp.score >= SCORE_STUDY)) continue;
    const d = parseIsoDateOnly(String(opp.deadline ?? ""));
    if (!d) continue;
    const daysLeft = daysBetweenLocal(today, d);
    if (daysLeft < 0) continue; // expiré

    const stableKey = `deadline:${opp.id}:${weekKey}`;
    const id = -Math.abs(hashToInt32(stableKey) || 1); // IDs négatifs = calculés
    const { type, prefix } = weeklySeverity(daysLeft);
    incoming.push({
      id,
      type,
      title: prefix,
      message: deadlineMessage(daysLeft, opp.score),
      time: "Aujourd'hui",
      read: false,
      opportunityId: opp.id,
      createdAt: now,
      threadKey: `ao:${opp.id}`,
      threadTitle: opp.title || opp.id,
      orderHint: now,
    });
  }

  if (incoming.length === 0) return;
  const current = getNotifications();
  const merged = mergeNotificationsKeepReadState(current, incoming);
  writeNotifications(merged);
}

// --- Génération : changement de phase de soumission -------------------------

/**
 * Émet une notification quand la phase de suivi d'un AO change (ex. « En
 * évaluation », « Attribué », « Rejeté »). Rangée dans le fil de l'AO.
 * Respecte le mode silence. ID stable par (AO, phase, jour) → pas de doublon
 * si l'utilisateur ré-enregistre le même jour, mais un nouveau changement de
 * phase émet bien une nouvelle notification.
 */
export function notifyPhaseChange(
  oppId: string,
  phaseKey: string,
  phaseLabel: string,
  title?: string,
) {
  if (!oppId) return;
  if (getMutedOppIds().has(oppId)) return;

  const now = Date.now();
  const type: NotificationType =
    phaseKey === "attribue" ? "success" : phaseKey === "rejete" ? "warning" : "info";
  const dayKey = new Date(now).toISOString().slice(0, 10);
  const stableKey = `phase:${oppId}:${phaseKey}:${dayKey}`;
  const id = -Math.abs(hashToInt32(stableKey) || 1);

  const incoming: AppNotification = {
    id,
    type,
    title: `Suivi de soumission : ${phaseLabel}`,
    message: `${title || oppId} — nouvelle phase : ${phaseLabel}.`,
    time: "Aujourd'hui",
    read: false,
    opportunityId: oppId,
    createdAt: now,
    threadKey: `ao:${oppId}`,
    threadTitle: title || oppId,
    orderHint: now,
  };

  const current = getNotifications();
  const merged = mergeNotificationsKeepReadState(current, [incoming]);
  writeNotifications(merged);
}

// --- Génération : fil « Collecte » ------------------------------------------

function readKnownOppIds(): Set<string> {
  try {
    const raw = localStorage.getItem(KNOWN_OPP_IDS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function writeKnownOppIds(ids: Set<string>) {
  localStorage.setItem(KNOWN_OPP_IDS_KEY, JSON.stringify(Array.from(ids)));
}

/**
 * Alimente le fil « Collecte » : détecte les AO nouvellement apparus depuis la
 * dernière observation et émet un résumé (« N nouveaux, X GO, Y à étudier »).
 * Le tout premier passage se contente d'enregistrer le corpus existant (pas de
 * notification rétroactive sur tout l'historique).
 */
export function upsertCollectionSummaryFromOpportunities(
  opportunities: Array<{ id: string; score?: number }>,
) {
  const currentIds = opportunities.map((o) => o?.id).filter((x): x is string => Boolean(x));
  const known = readKnownOppIds();

  // Premier passage : on mémorise sans notifier.
  if (known.size === 0) {
    writeKnownOppIds(new Set(currentIds));
    return;
  }

  const newIds = currentIds.filter((id) => !known.has(id));
  // Toujours mémoriser l'état courant.
  const nextKnown = new Set(known);
  for (const id of currentIds) nextKnown.add(id);
  writeKnownOppIds(nextKnown);

  if (newIds.length === 0) return;

  const scoreById = new Map<string, number | undefined>(
    opportunities.map((o) => [o.id, typeof o.score === "number" ? o.score : undefined]),
  );
  let go = 0;
  let study = 0;
  for (const id of newIds) {
    const s = scoreById.get(id);
    if (typeof s === "number" && s >= SCORE_GO) go += 1;
    else if (typeof s === "number" && s >= SCORE_STUDY) study += 1;
  }

  // ID stable par signature du lot (mêmes nouveaux AO → pas de doublon).
  const signature = `collecte:${[...newIds].sort().join(",")}`;
  const id = -Math.abs(hashToInt32(signature) || 1);

  const parts = [`${newIds.length} nouvel(le)(s) opportunité(s)`];
  if (go > 0) parts.push(`${go} GO`);
  if (study > 0) parts.push(`${study} à étudier`);
  const type: NotificationType = go > 0 ? "success" : "info";

  const now = Date.now();
  const incoming: AppNotification = {
    id,
    type,
    title: go > 0 ? `Collecte : ${go} nouveau(x) GO` : "Collecte terminée",
    message: `${parts.join(" — ")}.`,
    time: "Aujourd'hui",
    read: false,
    createdAt: now,
    threadKey: SYSTEM_COLLECTE_KEY,
    threadTitle: SYSTEM_COLLECTE_TITLE,
    orderHint: now,
  };

  const current = getNotifications();
  const merged = mergeNotificationsKeepReadState(current, [incoming]);
  writeNotifications(merged);
}

// --- Migration ---------------------------------------------------------------
// L'ancien schéma générait des rappels par jalons (J-30, J-21, …) avec des IDs
// dérivés de `deadline:{oppId}:{seuil}`. Le nouveau schéma est hebdomadaire, donc
// ces anciennes notifications calculées ne sont plus jamais régénérées : elles
// resteraient figées (ancien format, titre long). On les purge UNE SEULE fois.
// Les notifications calculées courantes (rappel hebdo, résumé de collecte) sont
// recréées au chargement suivant.

const SCHEMA_MIGRATION_KEY = "notifications_schema_migrated_v2";
let migrationChecked = false;

function ensureNotificationsMigration() {
  if (migrationChecked) return;
  migrationChecked = true;
  try {
    if (localStorage.getItem(SCHEMA_MIGRATION_KEY)) return;
    const raw = localStorage.getItem(NOTIFICATIONS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        // On ne conserve que d'éventuelles notifications non calculées (id >= 0).
        const kept = parsed.filter(
          (n) => typeof (n as { id?: unknown })?.id === "number" && (n as { id: number }).id >= 0,
        );
        localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(kept));
      }
    }
    localStorage.setItem(SCHEMA_MIGRATION_KEY, "1");
  } catch {
    /* ignore */
  }
}

// --- Lecture -----------------------------------------------------------------

export function getNotifications(): AppNotification[] {
  ensureNotificationsMigration();
  try {
    const deletedIds = readDeletedIds();
    const raw = localStorage.getItem(NOTIFICATIONS_KEY);
    if (!raw) {
      persistNotifications(seedNotifications);
      return seedNotifications.filter((x) => !deletedIds.has(x.id));
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      persistNotifications(seedNotifications);
      return seedNotifications.filter((x) => !deletedIds.has(x.id));
    }

    const byId = new Map<number, AppNotification>();
    for (const item of seedNotifications) byId.set(item.id, item);
    for (const rawItem of parsed) {
      const item = sanitizeNotification(rawItem);
      if (!item) continue;
      const seeded = byId.get(item.id);
      byId.set(item.id, seeded ? { ...seeded, ...item } : item);
    }

    const merged = Array.from(byId.values())
      .filter((x) => !deletedIds.has(x.id))
      .sort((a, b) => a.id - b.id);
    const normalizedRaw = JSON.stringify(merged);
    if (normalizedRaw !== raw) persistNotifications(merged);
    return merged;
  } catch {
    return seedNotifications;
  }
}

/**
 * Notifications visibles compte tenu des filtres utilisateur (catégories /
 * urgences uniquement). Le filtrage est appliqué à la LECTURE : la persistance
 * (`getNotifications`) conserve tout, ce qui préserve l'état lu et évite qu'un
 * changement de filtre ne détruise des notifications.
 */
export function getVisibleNotifications(): AppNotification[] {
  const s = readNotifSettings();
  return getNotifications().filter((n) => isNotificationVisible(n, s));
}

/** Nombre de non-lues VISIBLES (badge, filtres respectés, AO en silence exclus). */
export function getUnreadCount(): number {
  const muted = getMutedOppIds();
  return getVisibleNotifications().filter(
    (n) => !n.read && !(n.opportunityId && muted.has(n.opportunityId)),
  ).length;
}

/** Compare deux notifications pour l'ordre chronologique intra-fil. */
function compareInThread(a: AppNotification, b: AppNotification): number {
  const ca = a.createdAt ?? 0;
  const cb = b.createdAt ?? 0;
  if (ca !== cb) return ca - cb;
  const oa = a.orderHint ?? 0;
  const ob = b.orderHint ?? 0;
  if (oa !== ob) return oa - ob;
  return a.id - b.id;
}

/**
 * Regroupe les notifications en fils (par AO / système), triés : fils avec des
 * non-lues d'abord, puis par activité la plus récente.
 */
export function getNotificationThreads(): NotificationThread[] {
  const items = getVisibleNotifications();
  const muted = getMutedOppIds();
  const groups = new Map<string, AppNotification[]>();
  for (const n of items) {
    const key = threadKeyFor(n);
    const list = groups.get(key);
    if (list) list.push(n);
    else groups.set(key, [n]);
  }

  const threads: NotificationThread[] = [];
  for (const [key, list] of groups) {
    const sorted = [...list].sort(compareInThread);
    const latest = sorted[sorted.length - 1];
    const unreadCount = sorted.filter((n) => !n.read).length;
    const kind: "ao" | "system" = key.startsWith("system:") ? "system" : "ao";
    const title =
      latest.threadTitle ??
      (kind === "system" ? SYSTEM_COLLECTE_TITLE : latest.title);
    const oppId = kind === "ao" ? latest.opportunityId : undefined;
    const isMuted = Boolean(oppId && muted.has(oppId));
    threads.push({
      key,
      title,
      kind,
      items: sorted,
      latest,
      unreadCount: isMuted ? 0 : unreadCount,
      total: sorted.length,
      opportunityId: oppId,
      muted: isMuted,
    });
  }

  const lastActivity = (t: NotificationThread) =>
    Math.max(...t.items.map((n) => n.createdAt ?? 0), 0);

  return threads.sort((a, b) => {
    // 1) fils avec non-lues d'abord
    if ((a.unreadCount > 0) !== (b.unreadCount > 0)) return a.unreadCount > 0 ? -1 : 1;
    // 2) activité la plus récente
    return lastActivity(b) - lastActivity(a);
  });
}

// --- Actions -----------------------------------------------------------------

export function markNotificationAsRead(id: number) {
  const list = getNotifications();
  const next = list.map((item) => (item.id === id ? { ...item, read: true } : item));
  writeNotifications(next);
}

export function markAllNotificationsAsRead() {
  const list = getNotifications();
  const next = list.map((item) => ({ ...item, read: true }));
  writeNotifications(next);
}

/** Marque toutes les notifications d'un fil comme lues. */
export function markThreadAsRead(threadKey: string) {
  const list = getNotifications();
  const next = list.map((item) => (threadKeyFor(item) === threadKey ? { ...item, read: true } : item));
  writeNotifications(next);
}

export function deleteNotifications(ids: number[]) {
  if (ids.length === 0) return;
  const targets = new Set(ids);
  const list = getNotifications();
  const next = list.filter((item) => !targets.has(item.id));
  const deleted = readDeletedIds();
  for (const id of targets) deleted.add(id);
  writeDeletedIds(deleted);
  writeNotifications(next);
}

/** Supprime toutes les notifications d'un fil. */
export function deleteThread(threadKey: string) {
  const list = getNotifications();
  const ids = list.filter((item) => threadKeyFor(item) === threadKey).map((item) => item.id);
  deleteNotifications(ids);
}

export function restoreNotifications(items: AppNotification[]) {
  if (items.length === 0) return;
  const deleted = readDeletedIds();
  for (const item of items) deleted.delete(item.id);
  writeDeletedIds(deleted);

  const current = getNotifications();
  const byId = new Map<number, AppNotification>(current.map((n) => [n.id, n]));
  for (const item of items) byId.set(item.id, item);
  writeNotifications(Array.from(byId.values()).sort((a, b) => a.id - b.id));
}
