export type AuditLog = {
  id: string;
  actor: string;
  /** Rôle de l'acteur, dérivé (jointure serveur) de la table des utilisateurs. */
  actorRole?: string | null;
  action: string;
  entityType: string;
  entityId?: string;
  details?: string;
  createdAt: string;
};

import { apiJson, pushToServer } from "@/lib/api";
import { getAuthUser } from "@/lib/auth";

/** Intitulés explicites (FR) des actions journalisées. */
const ACTION_LABELS: Record<string, string> = {
  login: "Connexion",
  login_failed: "Échec de connexion",
  logout: "Déconnexion",
  user_created: "Compte créé",
  user_updated: "Compte modifié",
  user_password_reset: "Mot de passe réinitialisé",
  submitted: "Soumission déposée",
  convert_won_to_reference: "Marché gagné → référence",
  created: "Création",
  updated: "Mise à jour",
  deleted: "Suppression",
  deleted_permanently: "Suppression définitive",
  moved_to_trash: "Mise à la corbeille",
  restored: "Restauration",
  toggled_status: "Activation / désactivation",
  saved_settings: "Réglages enregistrés",
  company_profile_updated: "Profil entreprise mis à jour",
  cv_uploaded: "CV ajouté",
  cv_deleted: "CV supprimé",
  diploma_uploaded: "Diplôme ajouté",
  diploma_deleted: "Diplôme supprimé",
};

const ENTITY_LABELS: Record<string, string> = {
  auth: "Authentification",
  user: "Utilisateur",
  opportunity: "Opportunité",
  submission_tracking: "Suivi de soumission",
  submitted_opportunity: "Soumission",
  partner: "Partenaire",
  source: "Source",
  sources_settings: "Réglages sources",
  company: "Entreprise",
  notification: "Notification",
};

export function auditActionLabel(action: string): string {
  return (
    ACTION_LABELS[action] ??
    action.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
  );
}

export function auditEntityLabel(entityType: string): string {
  return ENTITY_LABELS[entityType] ?? entityType;
}

const ROLE_LABELS: Record<string, string> = {
  user: "Utilisateur",
  admin_exploitation: "Admin exploitation",
  admin_systeme: "Admin système",
};

export function auditRoleLabel(role?: string | null): string {
  if (!role) return "—";
  return ROLE_LABELS[role] ?? role;
}

const AUDIT_LOGS_KEY = "audit_logs";
const LOGS_SETTINGS_KEY = "logs_settings";
const DEFAULT_ACTOR = "inconnu";

type LogsSettings = {
  retentionDays?: string;
};

function readSettings(): LogsSettings {
  try {
    const raw = localStorage.getItem(LOGS_SETTINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as LogsSettings;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function readLogs(): AuditLog[] {
  try {
    const raw = localStorage.getItem(AUDIT_LOGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AuditLog[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLogs(logs: AuditLog[]) {
  localStorage.setItem(AUDIT_LOGS_KEY, JSON.stringify(logs));
  window.dispatchEvent(new CustomEvent("audit-logs-updated"));
}

export function getAuditLogs(): AuditLog[] {
  const settings = readSettings();
  const retentionDays = Math.max(1, Number(settings.retentionDays) || 30);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  const current = readLogs();
  const cleaned = current
    .filter((log) => new Date(log.createdAt).getTime() >= cutoff.getTime())
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Élagage silencieux : on ne persiste (et surtout on n'émet AUCUN événement)
  // que si la liste a réellement changé — évite tout risque de boucle en lecture.
  if (JSON.stringify(cleaned) !== JSON.stringify(current)) {
    try {
      localStorage.setItem(AUDIT_LOGS_KEY, JSON.stringify(cleaned));
    } catch {
      /* ignore */
    }
  }
  return cleaned;
}

export function addAuditLog(input: Omit<AuditLog, "id" | "actor" | "createdAt"> & { actor?: string }) {
  const logs = getAuditLogs();
  const next: AuditLog = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    // Acteur local (affichage optimiste) = utilisateur connecté ; le serveur
    // fixe ensuite l'acteur faisant foi depuis le JWT (voir audit backend).
    actor: input.actor ?? getAuthUser()?.email ?? DEFAULT_ACTOR,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    details: input.details,
    createdAt: new Date().toISOString(),
  };
  writeLogs([next, ...logs]);
  pushToServer("/audit-logs", {
    method: "POST",
    body: JSON.stringify({
      action: next.action,
      entityType: next.entityType,
      ...(next.entityId ? { entityId: next.entityId } : {}),
      ...(next.details ? { details: next.details } : {}),
      actor: next.actor,
    }),
  });
}

export type PagedAuditLogs = {
  items: AuditLog[];
  total: number;
  page: number;
  limit: number;
};

/**
 * Lecture paginée/filtrée depuis le serveur (source de vérité). Sans dates :
 * le backend renvoie les 7 derniers jours ; avec `from`/`to` : la plage demandée
 * (tout l'historique reste consultable). Seule la page demandée est chargée.
 */
export function fetchAuditLogs(params: {
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  limit?: number;
}): Promise<PagedAuditLogs> {
  const qs = new URLSearchParams();
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.q && params.q.trim()) qs.set("q", params.q.trim());
  qs.set("page", String(params.page ?? 1));
  qs.set("limit", String(params.limit ?? 15));
  return apiJson<PagedAuditLogs>(`/audit-logs?${qs.toString()}`);
}

/** Hydratation au démarrage : cache local des logs récents (repli hors-ligne). */
export async function hydrateAuditLogsFromServer(): Promise<void> {
  const data = await apiJson<PagedAuditLogs>("/audit-logs");
  if (data && Array.isArray(data.items)) {
    localStorage.setItem(AUDIT_LOGS_KEY, JSON.stringify(data.items));
  }
}

