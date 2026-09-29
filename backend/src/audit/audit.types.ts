export type AuditLog = {
  id: string;
  actor: string;
  /** Rôle de l'acteur, dérivé par jointure sur la table des utilisateurs. */
  actorRole?: string | null;
  action: string;
  entityType: string;
  entityId?: string;
  details?: string;
  createdAt: string;
};

export type LogsSettings = {
  retentionDays?: string;
};

export type PagedAuditLogs = {
  items: AuditLog[];
  total: number;
  page: number;
  limit: number;
};

export type ListAuditLogsQuery = {
  from?: string;
  to?: string;
  q?: string;
  page?: string | number;
  limit?: string | number;
};
