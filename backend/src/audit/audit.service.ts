import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ensureFileExists } from '../storage/ensure-file';
import { JsonStore } from '../storage/json-store';
import type { AuditLog, LogsSettings, PagedAuditLogs, ListAuditLogsQuery } from './audit.types';
import { AddAuditLogDto } from './dto/add-audit-log.dto';
import { AuditLogEntity } from '../database/entities/audit-log.entity';

const DEFAULT_ACTOR = 'inconnu';
const DEFAULT_WINDOW_DAYS = 7; // affichage par défaut : 7 derniers jours
const MAX_LIMIT = 1000;

/**
 * Journal d'audit — persistance en BASE (aucune suppression : on conserve tout).
 * La lecture est filtrée/paginée côté serveur (défaut : 7 derniers jours), donc
 * seule la page demandée est chargée, quel que soit le volume conservé.
 */
@Injectable()
export class AuditService implements OnModuleInit {
  private readonly logger = new Logger(AuditService.name);

  // Conservé uniquement pour les réglages (rétention informative) et la
  // migration unique de l'ancien fichier JSON vers la base.
  private readonly legacyStore = new JsonStore<AuditLog[]>({
    fileName: 'audit-logs.json',
    defaultValue: [],
  });
  private readonly settingsStore = new JsonStore<LogsSettings>({
    fileName: 'logs-settings.json',
    defaultValue: { retentionDays: 'illimite' },
  });

  constructor(
    @InjectRepository(AuditLogEntity) private readonly repo: Repository<AuditLogEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.migrateLegacyOnce();
  }

  /** Importe une seule fois les logs de l'ancien fichier JSON s'ils existent. */
  private async migrateLegacyOnce(): Promise<void> {
    try {
      const count = await this.repo.count();
      if (count > 0) return;
      const legacy = await this.legacyStore.read().catch(() => [] as AuditLog[]);
      if (!Array.isArray(legacy) || legacy.length === 0) return;
      const rows = legacy.map((l) =>
        this.repo.create({
          id: String(l.id).slice(0, 64),
          actor: l.actor ?? DEFAULT_ACTOR,
          action: l.action,
          entityType: l.entityType,
          entityId: l.entityId ?? null,
          details: l.details ?? null,
          createdAt: l.createdAt,
        }),
      );
      await this.repo.save(rows);
      this.logger.log(`[audit] Migration JSON → base : ${rows.length} log(s) importé(s).`);
    } catch (e) {
      this.logger.warn(`[audit] Migration JSON impossible : ${e instanceof Error ? e.message : e}`);
    }
  }

  private toApi(e: AuditLogEntity): AuditLog {
    return {
      id: e.id,
      actor: e.actor,
      // Rôle dérivé de l'utilisateur lié (jointure) — pas une copie figée.
      actorRole: e.actorUser?.role ?? null,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? undefined,
      details: e.details ?? undefined,
      createdAt: e.createdAt,
    };
  }

  async getSettings(): Promise<LogsSettings> {
    await ensureFileExists(
      this.settingsStore.getPath(),
      JSON.stringify({ retentionDays: 'illimite' } satisfies LogsSettings, null, 2),
    );
    return this.settingsStore.read();
  }

  async setSettings(settings: LogsSettings): Promise<LogsSettings> {
    const next: LogsSettings = { retentionDays: settings.retentionDays };
    await this.settingsStore.write(next);
    return next;
  }

  /**
   * Liste paginée + filtrée. Sans `from`/`to` : 7 derniers jours par défaut.
   * Avec des dates : la plage demandée (toute l'historique reste consultable).
   */
  async list(query: ListAuditLogsQuery = {}): Promise<PagedAuditLogs> {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(query.limit) || 15));

    let fromIso: string | undefined;
    let toIso: string | undefined;
    if (!query.from && !query.to) {
      // Défaut : fenêtre glissante des 7 derniers jours.
      const d = new Date();
      d.setDate(d.getDate() - DEFAULT_WINDOW_DAYS);
      fromIso = d.toISOString();
    } else {
      if (query.from) {
        const f = new Date(query.from);
        if (!Number.isNaN(f.getTime())) {
          f.setHours(0, 0, 0, 0);
          fromIso = f.toISOString();
        }
      }
      if (query.to) {
        const t = new Date(query.to);
        if (!Number.isNaN(t.getTime())) {
          t.setHours(23, 59, 59, 999);
          toIso = t.toISOString();
        }
      }
    }

    // createdAt est stocké en ISO 8601 → l'ordre lexical == ordre chronologique.
    // Jointure vers l'utilisateur pour dériver son rôle (sans charger le hash).
    const qb = this.repo
      .createQueryBuilder('l')
      .leftJoin('l.actorUser', 'u')
      .addSelect(['u.id', 'u.role']);
    if (fromIso) qb.andWhere('l.createdAt >= :from', { from: fromIso });
    if (toIso) qb.andWhere('l.createdAt <= :to', { to: toIso });
    const q = (query.q ?? '').trim();
    if (q) {
      qb.andWhere(
        '(l.actor LIKE :q OR l.action LIKE :q OR l.entityType LIKE :q OR l.details LIKE :q)',
        { q: `%${q}%` },
      );
    }
    qb.orderBy('l.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [rows, total] = await qb.getManyAndCount();
    return { items: rows.map((r) => this.toApi(r)), total, page, limit };
  }

  async add(input: AddAuditLogDto, actor?: string, actorUserId?: string): Promise<AuditLog> {
    const entity = this.repo.create({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      // L'acteur issu du JWT (serveur) prime sur le champ client (anti-usurpation).
      actor: actor ?? input.actor ?? DEFAULT_ACTOR,
      // Lien vers l'utilisateur (si l'action est authentifiée) → rôle dérivé.
      actorUserId: actorUserId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      details: input.details ?? null,
      createdAt: new Date().toISOString(),
    });
    const saved = await this.repo.save(entity);
    return this.toApi(saved);
  }
}
