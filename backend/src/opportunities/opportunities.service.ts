import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as fs from 'node:fs/promises';
import * as crypto from 'node:crypto';
import * as path from 'path';
import { DataSource, In, Repository } from 'typeorm';
import { ScraperFactory } from '../scraper/scraper.factory';
import { ScraperOrchestratorService } from '../scraper/scraper-orchestrator.service';
import { DownloadService } from '../scraper/download.service';
import { ExtractorApiClient } from '../decision-engine/extractor-api.client';
import { DecisionScoringService } from '../decision-engine/decision-scoring.service';
import { resolveExtractionRawPdfDir } from '../scraper/extraction-raw-path';
import type { Opportunity } from '../seed/mock-data';
import { SettingsService } from '../settings/settings.service';
import { OpportunityEntity } from './entities/opportunity.entity';
import { OpportunityFavoriteEntity } from './entities/opportunity-favorite.entity';
import { OpportunityReadEntity } from './entities/opportunity-read.entity';
import { OpportunitySubmissionJustificatifEntity } from './entities/opportunity-submission-justificatif.entity';
import { OpportunityStatusOverrideEntity } from './entities/opportunity-status-override.entity';
import {
  entityToOpportunity,
  opportunityToEntity,
} from './opportunity-persistence.mapper';
import { applyDecisionToPublicOpportunity } from './opportunity-decision.util';
import {
  dedupeOpportunitiesByStableKey,
  toPublicOpportunity,
  toPublicOpportunityDetail,
  toPublicOpportunityList,
} from './opportunity-public.util';

@Injectable()
export class OpportunitiesService {
  private readonly logger = new Logger(OpportunitiesService.name);

  // N2 — throttle du log « Veille » (appelé à chaque tick/poll du front).
  private lastVeilleLogAt = 0;

  private sourceHostFromUrl(raw: string): string {
    try {
      const u = new URL(String(raw ?? '').trim());
      return u.hostname.replace(/^www\./i, '').toLowerCase();
    } catch {
      return '';
    }
  }

  private normalizeKeywordForSearch(raw: string): string {
    const s0 = String(raw ?? '').trim().toLowerCase();
    if (!s0) return '';
    // Retire les accents côté JS pour homogénéiser les keywords.
    const s1 = s0.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    // Remplace la ponctuation "simple" par espaces.
    const s2 = s1.replace(/[.,;:!?()[\]{}"'’“”\-_/\\|]+/g, ' ');
    return s2.replace(/\s+/g, ' ').trim();
  }

  private sqlFuzzyExpr(columnSql: string): string {
    const type = String((this.dataSource.options as any)?.type ?? '').toLowerCase();
    if (type === 'postgres') {
      // Requires extension `unaccent` enabled in the DB.
      return `LOWER(regexp_replace(unaccent(${columnSql}), '[[:punct:]]+', ' ', 'g'))`;
    }
    if (type === 'mysql' || type === 'mariadb') {
      const sqlCharLiteral = (ch: string): string => {
        // SQL string literal escaping for MySQL/MariaDB:
        // - single quote is escaped by doubling:  '  ->  ''
        // - backslash kept as-is inside the quoted string (we already pass a literal backslash)
        const safe = ch.replace(/'/g, "''");
        return `'${safe}'`;
      };
      // Compatible MySQL/MariaDB (sans REGEXP_REPLACE) : on enlève une ponctuation basique via REPLACE.
      // Accent-insensitive: utf8mb4_general_ci (ou utf8mb4_unicode_ci selon serveur).
      const base = `CONVERT(${columnSql} USING utf8mb4) COLLATE utf8mb4_general_ci`;
      const cleaned = [
        '.',
        ',',
        ';',
        ':',
        '!',
        '?',
        '(',
        ')',
        '[',
        ']',
        '{',
        '}',
        '"',
        "'",
        '’',
        '-',
        '_',
        '/',
        '\\\\',
        '|',
        '+',
        '=',
      ].reduce((expr, ch) => `REPLACE(${expr}, ${sqlCharLiteral(ch)}, ' ')`, base);
      return `LOWER(TRIM(REPLACE(REPLACE(${cleaned}, '  ', ' '), '  ', ' ')))`;
    }
    // Generic fallback.
    return `LOWER(${columnSql})`;
  }

  private nowIso(): string {
    return new Date().toISOString();
  }

  private hasMajorChange(existing: OpportunityEntity, next: Opportunity): boolean {
    const norm = (v: unknown) => String(v ?? '').trim();
    return (
      norm(existing.title) !== norm(next.title) ||
      norm(existing.source) !== norm(next.source) ||
      norm(existing.publishedAt) !== norm(next.publishedAt) ||
      norm(existing.deadline) !== norm(next.deadline) ||
      norm(existing.budget) !== norm(next.budget) ||
      norm(existing.location) !== norm(next.location) ||
      norm(existing.domain) !== norm(next.domain) ||
      norm(existing.description) !== norm(next.description)
    );
  }

  /**
   * Préserve `scrapedAt` si aucune info majeure n'a changé.
   * Met à jour `scrapedAt` si nouvelle opportunité ou changement majeur.
   */
  private async applyScrapedAtPolicy(
    list: Opportunity[],
  ): Promise<Opportunity[]> {
    const items = list ?? [];
    if (items.length === 0) return [];

    const ids = items.map((o) => o.id);
    const existing = await this.opportunityRepo.findBy({ id: In(ids) });
    const map = new Map(existing.map((e) => [e.id, e]));
    const now = this.nowIso();

    return items.map((o) => {
      const ex = map.get(o.id);
      if (!ex) return { ...o, scrapedAt: o.scrapedAt || now };
      const prevScrapedAt = (ex.scrapedAt ?? '').trim();
      if (!prevScrapedAt) return { ...o, scrapedAt: o.scrapedAt || now };
      if (this.hasMajorChange(ex, o)) return { ...o, scrapedAt: now };
      // Pas de changement majeur : conserver la date originale.
      return { ...o, scrapedAt: prevScrapedAt };
    });
  }

  constructor(
    private readonly scraperFactory: ScraperFactory,
    private readonly scraperOrchestrator: ScraperOrchestratorService,
    private readonly downloadService: DownloadService,
    private readonly extractorApi: ExtractorApiClient,
    private readonly decisionScoring: DecisionScoringService,
    private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
    @InjectRepository(OpportunityEntity)
    private readonly opportunityRepo: Repository<OpportunityEntity>,
    @InjectRepository(OpportunityStatusOverrideEntity)
    private readonly statusOverrideRepo: Repository<OpportunityStatusOverrideEntity>,
    @InjectRepository(OpportunityFavoriteEntity)
    private readonly favoriteRepo: Repository<OpportunityFavoriteEntity>,
    @InjectRepository(OpportunityReadEntity)
    private readonly readRepo: Repository<OpportunityReadEntity>,
    @InjectRepository(OpportunitySubmissionJustificatifEntity)
    private readonly justificatifRepo: Repository<OpportunitySubmissionJustificatifEntity>,
  ) {}

  /**
   * Préserve `internalFileId` en base si la ligne scrapée n’a pas de nouveau téléchargement
   * (`opportunityToEntity` mettrait null sinon). Si l’UUID change, supprime l’ancien `<uuid>.pdf`
   * sous `ao_extractor/data` (voir `EXTRACTION_RAW_DIR`).
   */
  /** Conserve extraction + décision en base lors d’un upsert scrape (évite d’effacer les scores). */
  private async applyEnrichmentMergeFromExisting(
    entities: OpportunityEntity[],
  ): Promise<void> {
    const ids = [...new Set(entities.map((e) => e.id).filter(Boolean))];
    if (ids.length === 0) return;

    const previousRows = await this.opportunityRepo.find({
      where: { id: In(ids) },
    });
    const prevById = new Map(previousRows.map((e) => [e.id, e]));

    for (const ent of entities) {
      const prev = prevById.get(ent.id);
      if (!prev?.enrichment) continue;
      const incoming = ent.enrichment;
      if (!incoming || typeof incoming !== 'object') {
        ent.enrichment = prev.enrichment;
        continue;
      }
      const merged = {
        ...(prev.enrichment as Record<string, unknown>),
        ...(incoming as Record<string, unknown>),
      };
      const prevDecision = (prev.enrichment as Record<string, unknown>).decision;
      const incDecision = (incoming as Record<string, unknown>).decision;
      if (prevDecision && !incDecision) {
        merged.decision = prevDecision;
      }
      ent.enrichment = merged as OpportunityEntity['enrichment'];
    }
  }

  private async applyInternalFileIdMergeFromExisting(
    entities: OpportunityEntity[],
  ): Promise<void> {
    const ids = [...new Set(entities.map((e) => e.id).filter(Boolean))];
    if (ids.length === 0) return;

    const previousRows = await this.opportunityRepo.find({
      where: { id: In(ids) },
    });
    const prevById = new Map(previousRows.map((e) => [e.id, e]));
    const rawDir = resolveExtractionRawPdfDir();

    for (const ent of entities) {
      const prev = prevById.get(ent.id);
      const incoming = ent.internalFileId?.trim() || null;
      const oldId = prev?.internalFileId?.trim() || null;

      if (!incoming && oldId) {
        ent.internalFileId = oldId;
        continue;
      }

      if (incoming && oldId && incoming !== oldId) {
        const oldPath = path.join(rawDir, `${oldId}.pdf`);
        try {
          await fs.unlink(oldPath);
          this.logger.debug(
            `internalFileId remplacé : fichier obsolète supprimé ${oldPath} (nouveau=${incoming})`,
          );
        } catch {
          /* fichier déjà absent ou verrouillé */
        }
      }
    }
  }

  /** ID reçu via URL / multipart (trim, décodage URL si besoin). */
  private normalizeOpportunityParam(raw: string): string {
    let s = raw.trim();
    try {
      s = decodeURIComponent(s);
    } catch {
      /* conserver la valeur brute */
    }
    return s.trim();
  }

  private extractDownloadUrlFromDescription(description: string): string | null {
    const m = String(description ?? '').match(
      /T[ée]l[ée]chargement\s*:\s*(https?:\/\/\S+)/i,
    );
    return m?.[1]?.trim() || null;
  }

  /**
   * Télécharge les PDF manquants (lien dans la description) pour permettre extraction + scoring.
   */
  async backfillMissingPdfs(options?: {
    limit?: number;
  }): Promise<{ downloaded: number; errors: string[] }> {
    const limit = Math.min(200, Math.max(1, options?.limit ?? 50));
    const rows = await this.opportunityRepo
      .createQueryBuilder('o')
      .where('(o.internal_file_id IS NULL OR TRIM(o.internal_file_id) = \'\')')
      .orderBy('o.scraped_at', 'DESC')
      .limit(limit)
      .getMany();

    let downloaded = 0;
    const errors: string[] = [];

    for (const row of rows) {
      const url = this.extractDownloadUrlFromDescription(row.description);
      if (!url) continue;
      try {
        const { uuid } = await this.downloadService.downloadAndStorePdf(url);
        row.internalFileId = uuid;
        await this.opportunityRepo.save(row);
        downloaded += 1;
      } catch (err) {
        errors.push(`${row.id}: ${(err as Error).message}`);
      }
    }

    return { downloaded, errors };
  }

  /**
   * Option 2 — télécharge le PDF d'UNE opportunité (en mémoire), l'envoie à
   * l'API extracteur et la score. Aucun fichier sur disque, aucun rattachement
   * (l'opportunité est connue : on passe son id à l'extracteur).
   */
  private async scoreRowViaExtractorApi(
    row: OpportunityEntity,
  ): Promise<Opportunity> {
    // Les AMI (TDR) et DP (lettre d'invitation) n'ont pas de DAO standard et
    // saturent l'extracteur (timeout 120 s). On les score directement sur les
    // métadonnées (objet/budget/délai) — le MCDA n'a pas besoin du PDF lourd ici.
    const typ = (row.id.split('-')[1] || '').toUpperCase();
    // Seuls AO (national) et AOI (international) ont un vrai DAO exploitable.
    // Tout le reste (AMI, DP, DC, COMM, ADDITIF…) sature l'extracteur (timeout
    // 120 s) sans bénéfice réel → on score directement sur les métadonnées.
    const skipPdf = !(typ === 'AO' || typ === 'AOI');

    const url = skipPdf ? '' : this.extractDownloadUrlFromDescription(row.description);
    let dao: Record<string, unknown>;
    if (url) {
      try {
        const pdf = await this.downloadService.fetchPdfBytes(url);
        const sha256 = crypto.createHash('sha256').update(pdf).digest('hex');
        dao = (await this.extractorApi.extract(row.id, pdf)) as Record<string, unknown>;
        // Empreinte du PDF source : traçabilité + détection de changement (addendum).
        dao.source_pdf_sha256 = sha256;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Extraction PDF échouée pour ${row.id} (${msg}) — scoring sur métadonnées (sans PDF).`,
        );
        dao = this.buildMetadataDao(row);
      }
    } else {
      if (!skipPdf) {
        this.logger.warn(`Pas de lien PDF pour ${row.id} — scoring sur métadonnées.`);
      }
      dao = this.buildMetadataDao(row);
    }
    return this.decisionScoring.scoreOpportunityFromDao(row, dao);
  }

  /**
   * Mini-DAO bâti depuis les métadonnées de la ligne (titre, budget, délai,
   * financement) — utilisé quand le PDF est absent, échoue, ou pour les AMI/DP.
   * Le MCDA score alors sur l'objet + budget + délai ; éligibilité non applicable.
   */
  private buildMetadataDao(row: OpportunityEntity): Record<string, unknown> {
    const budget =
      parseInt(String(row.budget ?? '').replace(/[^\d]/g, ''), 10) || 0;
    const fin =
      /financement\s*:\s*([^\n|]+)/i.exec(row.description ?? '')?.[1]?.trim() ?? '';
    return {
      administratif: {
        objet: row.title ?? '',
        reference: row.id,
        date_cloture: row.deadline ?? '',
        financement: fin,
      },
      financier: { montant: budget, budget, caution: 0 },
      technique: { hard_filters: {} },
      metadata_only: true,
    };
  }

  /**
   * Score (ou re-score) une opportunité par id.
   *  - Si le DAO est DÉJÀ extrait (enrichment.extractor), on re-score à partir de
   *    lui : aucun re-téléchargement ni ré-extraction (rapide).
   *  - Sinon (première fois), flux complet : téléchargement → API extracteur → score.
   */
  async scoreOneViaExtractorApi(id: string): Promise<Opportunity> {
    const row = await this.opportunityRepo.findOne({ where: { id: id.trim() } });
    if (!row) throw new NotFoundException('Opportunity not found');

    const enr = (row.enrichment ?? {}) as Record<string, unknown>;
    const stored = enr.extractor as Record<string, unknown> | undefined;
    if (stored && Object.keys(stored).length > 0) {
      // DAO déjà extrait → on ne relance QUE le scoring (decision engine + Groq).
      return this.decisionScoring.scoreOpportunityFromDao(row, stored);
    }
    return this.scoreRowViaExtractorApi(row);
  }

  /**
   * Option 2 — pipeline « PDF transitoire » sur les opportunités non encore
   * scorées (idempotent : saute celles qui ont déjà une décision).
   */
  async processPendingViaExtractorApi(options?: {
    limit?: number;
    onProgress?: (done: number, total: number) => void;
  }): Promise<{ processed: number; skipped: number; errors: string[] }> {
    const limit = Math.min(200, Math.max(1, options?.limit ?? 50));
    const rows = await this.opportunityRepo
      .createQueryBuilder('o')
      .orderBy('o.scraped_at', 'DESC')
      .limit(limit)
      .getMany();

    let processed = 0;
    let skipped = 0;
    const errors: string[] = [];

    // On saute les AO déjà décidés ; le reste (y compris sans lien PDF) est scoré
    // via scoreRowViaExtractorApi qui retombe sur les métadonnées si besoin.
    const pending = rows.filter((row) => {
      const enr = (row.enrichment ?? {}) as Record<string, unknown>;
      if (enr.decision) {
        skipped += 1;
        return false;
      }
      return true;
    });
    options?.onProgress?.(0, pending.length);

    // SÉQUENTIEL : la concurrence saturait le modèle d'embeddings mono-thread
    // (/predict timeout 30 s), le réseau (ENOBUFS) et la mémoire (OOM). Le vrai
    // gain de vitesse vient de skipPdf (métadonnées) ci-dessus, pas du parallélisme.
    const CONCURRENCY = 1;
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < pending.length) {
        const row = pending[cursor++];
        try {
          await this.scoreRowViaExtractorApi(row);
          processed += 1;
        } catch (err) {
          errors.push(`${row.id}: ${(err as Error).message}`);
        }
        options?.onProgress?.(cursor, pending.length);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, pending.length) }, () => worker()),
    );

    return { processed, skipped, errors };
  }

  /** Synchronise le catalogue (settings UI + téléchargement PDF + mots-clés). */
  async syncFromArmp(): Promise<{ count: number }> {
    const cfg = await this.settings.getSourcesSettings();
    const globalKeywords = (cfg.globalKeywords ?? []).map((k) => String(k).trim()).filter(Boolean);
    const sources = (cfg.sources ?? []).filter((s) => s?.active === true);

    // Scraping incrémental : chargement unique des IDs déjà en base.
    // Chaque scraper s'arrête dès qu'une page entière ne contient que des IDs connus.
    const knownIds = new Set(
      (await this.opportunityRepo.find({ select: ['id'] })).map((e) => e.id),
    );
    this.logger.log(`syncFromArmp: ${knownIds.size} opportunité(s) déjà en base (scraping incrémental activé)`);

    const all: Opportunity[] = [];
    for (const s of sources) {
      const kw = [
        ...globalKeywords,
        ...((s.keywords ?? []) as string[]).map((k) => String(k).trim()).filter(Boolean),
      ];
      try {
        const rows = await this.scraperOrchestrator.fetchOpportunitiesFromUrl(s.url, {
          keywords: kw,
          knownIds,
        });
        all.push(...rows);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `syncFromArmp: échec pour ${s.url} — ${message}`,
          err instanceof Error ? err.stack : undefined,
        );
      }
    }

    // Fallback supprimé : il contournait globalKeywords et le filtre sémantique,
    // laissant passer des AOs non-IT (BTP, véhicules…).
    // Si all.length === 0, c'est soit un problème réseau, soit les mots-clés
    // sont trop restrictifs. Le catalogue existant est conservé.

    const ops = await this.applyScrapedAtPolicy(dedupeOpportunitiesByStableKey(all));

    if (ops.length === 0) {
      const existing = await this.opportunityRepo.count();
      this.logger.warn(
        `syncFromArmp: 0 opportunité à persister — catalogue conservé (${existing} ligne(s)).`,
      );
      return { count: 0 };
    }

    const res = await this.upsertFromExternal(ops);
    return { count: res.upserted };
  }

  /**
   * Upsert "safe" depuis des scrapers externes (Collect / ScraperController).
   * Conserve la DB (pas de suppression), déduplique globalement sur stableId.
   */
  async upsertFromExternal(
    opportunities: Opportunity[],
    options?: { pruneSource?: string },
  ): Promise<{ upserted: number; partial: boolean }> {
    const listRaw = dedupeOpportunitiesByStableKey(opportunities ?? []);
    const list = await this.applyScrapedAtPolicy(listRaw);
    const entities = list.map(opportunityToEntity);
    const pruneSource = (options?.pruneSource ?? '').trim();
    if (entities.length === 0) {
      // Si on est en mode "replace" pour une source et qu'il n'y a plus rien,
      // on purge quand même la source pour éviter de garder des résultats obsolètes.
      if (pruneSource) {
        await this.opportunityRepo.delete({ source: pruneSource });
      }
      return { upserted: 0, partial: false };
    }
    await this.applyEnrichmentMergeFromExisting(entities);
    await this.applyInternalFileIdMergeFromExisting(entities);
    try {
      if (pruneSource) {
        const ids = entities.map((e) => e.id);
        await this.dataSource.transaction(async (manager) => {
          const repo = manager.getRepository(OpportunityEntity);
          // Supprime les opportunités existantes de la même source qui ne font plus partie
          // de la liste filtrée (keywords) — évite l'illusion "trié au début puis bruit".
          await repo
            .createQueryBuilder()
            .delete()
            .from(OpportunityEntity)
            .where('source = :source', { source: pruneSource })
            .andWhere('id NOT IN (:...ids)', { ids })
            .execute();
          await repo.save(entities);
        });
      } else {
        await this.opportunityRepo.save(entities);
      }
      return { upserted: entities.length, partial: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `upsertFromExternal failed: ${message}`,
        err instanceof Error ? err.stack : undefined,
      );
      // Indicate partial so the caller can surface a warning.
      return { upserted: 0, partial: true };
    }
  }

  /** Catalogue courant (DB). Retourne les opportunités des sources actives (filtrage sémantique déjà appliqué au scraping). */
  async list(_options?: { keywords?: string[] }): Promise<Opportunity[]> {
    const cfg = await this.settings.getSourcesSettings();

    const cfgSourcesRaw = Array.isArray((cfg as any)?.sources) ? ((cfg as any).sources as any[]) : [];
    const activeSources = cfgSourcesRaw.filter((s) => s?.active === true);

    // On inclut les deux formes : hostname seul (armp.cm) ET URL complète normalisée
    // car o.source stocke cfg.baseUrl (URL complète) selon le scraper.
    const activeHosts = activeSources
      .flatMap((s) => {
        const full = String(s.url ?? '').trim().toLowerCase().replace(/\/+$/, '');
        const host = this.sourceHostFromUrl(s.url);
        return [full, host].filter(Boolean);
      })
      .filter(Boolean);

    const nowMs = Date.now();
    if (nowMs - this.lastVeilleLogAt > 15 * 60_000) {
      this.lastVeilleLogAt = nowMs;
      this.logger.debug(`Veille: sources actives=${activeHosts.length}`);
    }

    const qb = this.opportunityRepo.createQueryBuilder('o');

    // Si des sources actives sont configurées, on filtre par host.
    // Sinon on retourne tout le catalogue (cas bootstrapping sans sources configurées).
    if (activeHosts.length > 0) {
      qb.andWhere('LOWER(o.source) IN (:...hosts)', { hosts: activeHosts });
    }

    const totalInDb = await this.opportunityRepo.count();
    const [entities, overrides] = await Promise.all([
      qb
        // Veille: tri par récence métier (publishedAt ISO string) en premier.
        .orderBy('o.publishedAt', 'DESC')
        .addOrderBy('o.scrapedAt', 'DESC')
        .getMany(),
      this.statusOverrideRepo.find(),
    ]);
    if (entities.length === 0 && totalInDb > 0) {
      this.logger.warn(
        `Veille: ${totalInDb} opportunité(s) en base mais 0 après filtre host (hosts=${activeHosts.join(', ')})`,
      );
    } else if (totalInDb === 0) {
      this.logger.warn(
        'Veille: catalogue vide en base — lancez une collecte (front) ou POST /opportunities/sync-armp',
      );
    }
    const overrideMap = new Map<string, string>(
      overrides.map((o: OpportunityStatusOverrideEntity) => [
        o.opportunityId,
        o.status,
      ]),
    );
    const ids = entities.map((e) => e.id);
    const justRows =
      ids.length === 0
        ? []
        : await this.justificatifRepo.find({
            where: { opportunityId: In(ids) },
          });
    const justMap = new Map(
      justRows.map((j: OpportunitySubmissionJustificatifEntity) => [
        j.opportunityId,
        j.fileName,
      ]),
    );
    const raw = entities.map((e: OpportunityEntity) =>
      entityToOpportunity(e, overrideMap.get(e.id), justMap.get(e.id) ?? null),
    );
    const graceCutoff = new Date();
    graceCutoff.setDate(graceCutoff.getDate() - 30);
    const graceCutoffIso = graceCutoff.toISOString().slice(0, 10);
    const notExpired = (o: Opportunity) => {
      const d = String(o.deadline ?? '').trim();
      // Masque uniquement les AOs expirés depuis plus de 30 jours.
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d >= graceCutoffIso;
      return true;
    };
    const deduped = dedupeOpportunitiesByStableKey(raw).filter(notExpired);
    return deduped.map((o) =>
      toPublicOpportunity(applyDecisionToPublicOpportunity(o)),
    );
  }

  async get(id: string): Promise<Opportunity> {
    const oid = this.normalizeOpportunityParam(id);
    const e = await this.opportunityRepo.findOne({ where: { id: oid } });
    if (!e) throw new NotFoundException('Opportunity not found');
    const override = await this.statusOverrideRepo.findOne({
      where: { opportunityId: oid },
    });
    const just = await this.justificatifRepo.findOne({
      where: { opportunityId: oid },
    });
    const opp = entityToOpportunity(e, override?.status, just?.fileName ?? null);
    return toPublicOpportunityDetail(applyDecisionToPublicOpportunity(opp));
  }

  async setStatus(
    id: string,
    status: Opportunity['status'],
  ): Promise<{ id: string; status: Opportunity['status'] }> {
    const oid = this.normalizeOpportunityParam(id);
    const exists = await this.opportunityRepo.exist({ where: { id: oid } });
    if (!exists) throw new NotFoundException('Opportunity not found');
    await this.statusOverrideRepo.save({ opportunityId: oid, status });
    return { id: oid, status };
  }

  async submitWithJustificatif(
    id: string,
    fileName: string,
    pdfBuffer: Buffer,
  ): Promise<{ id: string; status: Opportunity['status'] }> {
    const oid = this.normalizeOpportunityParam(id);
    const exists = await this.opportunityRepo.exist({ where: { id: oid } });
    if (!exists) throw new NotFoundException('Opportunity not found');
    const status: Opportunity['status'] = 'soumis';
    await this.statusOverrideRepo.save({ opportunityId: oid, status });
    await this.justificatifRepo.save({
      opportunityId: oid,
      fileName,
      pdfData: pdfBuffer,
    });
    return { id: oid, status };
  }

  async getJustificatif(
    id: string,
  ): Promise<{ fileName: string; pdfData: Buffer } | null> {
    const oid = this.normalizeOpportunityParam(id);
    const row = await this.justificatifRepo.findOne({
      where: { opportunityId: oid },
    });
    if (!row) return null;
    return { fileName: row.fileName, pdfData: row.pdfData };
  }

  async getReadIds(): Promise<string[]> {
    const rows = await this.readRepo.find({
      order: { opportunityId: 'ASC' },
    });
    return rows.map((r: OpportunityReadEntity) => r.opportunityId);
  }

  async markRead(id: string): Promise<{ id: string; read: true }> {
    const oid = this.normalizeOpportunityParam(id);
    const exists = await this.opportunityRepo.exist({ where: { id: oid } });
    if (!exists) throw new NotFoundException('Opportunity not found');
    const already = await this.readRepo.exist({
      where: { opportunityId: oid },
    });
    if (!already) {
      await this.readRepo.save({ opportunityId: oid });
    }
    return { id: oid, read: true };
  }

  async getFavoriteIds(): Promise<string[]> {
    const rows = await this.favoriteRepo.find({
      order: { opportunityId: 'ASC' },
    });
    return rows.map((r: OpportunityFavoriteEntity) => r.opportunityId);
  }

  async toggleFavorite(id: string): Promise<{ id: string; favorite: boolean }> {
    const oid = this.normalizeOpportunityParam(id);
    const exists = await this.opportunityRepo.exist({ where: { id: oid } });
    if (!exists) throw new NotFoundException('Opportunity not found');
    const row = await this.favoriteRepo.findOne({
      where: { opportunityId: oid },
    });
    if (row) {
      await this.favoriteRepo.delete({ opportunityId: oid });
      return { id: oid, favorite: false };
    }
    await this.favoriteRepo.save({ opportunityId: oid });
    return { id: oid, favorite: true };
  }

  async enrich(
    id: string,
    dto: {
      budget?: string;
      contact?: string;
      eligibilityCriteria?: string;
      data?: Record<string, any>;
    },
  ): Promise<{ id: string; updated: true }> {
    const oid = this.normalizeOpportunityParam(id);
    const e = await this.opportunityRepo.findOne({ where: { id: oid } });
    if (!e) throw new NotFoundException('Opportunity not found');

    const patch: Partial<OpportunityEntity> = {};
    if (dto?.budget != null && String(dto.budget).trim() !== '') {
      patch.budget = String(dto.budget).trim();
    }

    const nextEnrichment: Record<string, any> = {
      ...(e.enrichment ?? {}),
      ...(dto?.data && typeof dto.data === 'object' ? dto.data : {}),
    };
    if (dto?.contact) nextEnrichment.contact = String(dto.contact).trim();
    if (dto?.eligibilityCriteria) {
      nextEnrichment.eligibilityCriteria = String(dto.eligibilityCriteria).trim();
    }
    patch.enrichment = Object.keys(nextEnrichment).length ? nextEnrichment : null;

    // Option: append a short enrichment footer to description for quick human visibility.
    // (kept minimal to avoid duplicating large JSON)
    const parts: string[] = [];
    if (dto?.contact) parts.push(`Contact: ${String(dto.contact).trim()}`);
    if (dto?.eligibilityCriteria) parts.push(`Eligibilité: ${String(dto.eligibilityCriteria).trim()}`);
    if (parts.length > 0) {
      const base = String(e.description ?? '').trim();
      const footer = `\n\n[ENRICH]\n${parts.join('\n')}`.trim();
      patch.description = base.includes('[ENRICH]') ? base : `${base}${footer}`;
    }

    await this.opportunityRepo.save({ ...e, ...patch });
    return { id: oid, updated: true };
  }
}