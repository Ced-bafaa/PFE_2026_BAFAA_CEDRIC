import { Injectable, Logger } from '@nestjs/common';
import {
  CollectionMode,
  type CollectBatchDto,
  type CollectPreviewDto,
  type SourceItemDto,
} from './dto/source-item.dto';
import { inferCollectionMode } from './infer-collection-mode';
import { RssFetchService } from './rss-fetch.service';
import { ScrapeFetchService } from './scrape-fetch.service';
import { DecisionScoringService } from '../decision-engine/decision-scoring.service';
import { ScraperOrchestratorService } from '../scraper/scraper-orchestrator.service';
import { OpportunitiesService } from '../opportunities/opportunities.service';
import type {
  CollectedItem,
  SourceCollectResult,
} from './types/collected-item';

function normalizeKeywords(
  global: string[] | undefined,
  source: SourceItemDto,
): string[] {
  const raw = [...(global ?? []), ...(source.keywords ?? [])]
    .map((k) => k.trim())
    .filter(Boolean);
  const lower = new Set<string>();
  const out: string[] = [];
  for (const k of raw) {
    const l = k.toLowerCase();
    if (lower.has(l)) continue;
    lower.add(l);
    out.push(k);
  }
  return out;
}

function matchesKeywords(
  item: CollectedItem,
  keywordsLower: string[],
): boolean {
  if (keywordsLower.length === 0) return true;
  const hay = `${item.title} ${item.url} ${item.summary ?? ''}`.toLowerCase();
  return keywordsLower.some((kw) => hay.includes(kw.toLowerCase()));
}

function resolveMode(source: SourceItemDto): CollectionMode {
  if (source.collectionMode) return source.collectionMode;
  return inferCollectionMode(source.url);
}

@Injectable()
export class CollectService {
  private readonly logger = new Logger(CollectService.name);
  private batchInProgress = false;

  /** État d'avancement de la collecte, pour la barre de progression du front. */
  private progress = {
    running: false,
    phase: 'idle' as 'idle' | 'collecte' | 'scoring' | 'done' | 'error',
    sourcesTotal: 0,
    sourcesDone: 0,
    collected: 0,
    scoreTotal: 0,
    scoreDone: 0,
    message: '',
    startedAtMs: 0,
    finishedAtMs: 0,
  };

  getProgress() {
    const end = this.progress.finishedAtMs || Date.now();
    const elapsedSec = this.progress.startedAtMs
      ? Math.max(0, Math.floor((end - this.progress.startedAtMs) / 1000))
      : 0;
    return { ...this.progress, elapsedSec };
  }

  constructor(
    private readonly rss: RssFetchService,
    private readonly scrape: ScrapeFetchService,
    private readonly orchestrator: ScraperOrchestratorService,
    private readonly opportunities: OpportunitiesService,
    private readonly decisionScoring: DecisionScoringService,
  ) {}

  async preview(dto: CollectPreviewDto): Promise<SourceCollectResult> {
    return this.collectOne(dto.source, dto.globalKeywords ?? []);
  }

  async runBatch(dto: CollectBatchDto): Promise<SourceCollectResult[]> {
    if (this.batchInProgress) {
      this.logger.warn('Collecte ignorée : un run est déjà en cours.');
      return [];
    }
    this.batchInProgress = true;
    const global = dto.globalKeywords ?? [];
    const active = dto.sources.filter((s) => s.active);
    const results: SourceCollectResult[] = [];
    this.progress = {
      running: true,
      phase: 'collecte',
      sourcesTotal: active.length,
      sourcesDone: 0,
      collected: 0,
      scoreTotal: 0,
      scoreDone: 0,
      message: 'Collecte des sources',
      startedAtMs: Date.now(),
      finishedAtMs: 0,
    };

    try {
    for (const source of active) {
      const base = await this.collectOne(source, global);
      const mode = resolveMode(source);

      // Scrape ARMP / pages HTML : persistance catalogue via l'orchestrateur (indépendant du succès fetchLinks).
      if (mode === CollectionMode.SCRAPE) {
        try {
          const keywords = normalizeKeywords(global, source);
          this.logger.log(
            `Collect scrape ${source.url} (keywords=${keywords.length})`,
          );
          const list = await this.orchestrator.fetchOpportunitiesFromUrl(source.url, {
            keywords,
          });
          // IMPORTANT : pas d'élagage par host ici. Plusieurs sources ARMP partagent
          // le MÊME host (armp.cm) avec des `val` différents (AON, international,
          // cotation, AMI, DP). Élaguer par host faisait que chaque source SUPPRIMAIT
          // les AO des sources précédentes — il ne restait que la dernière collectée.
          // On se contente d'upsert : les familles s'accumulent. (La purge des
          // obsolètes devra se faire au niveau du lot complet, pas source par source.)
          const stored = await this.opportunities.upsertFromExternal(list);
          this.logger.log(
            `Collect ${source.url}: ${stored.upserted} opportunité(s) en base${stored.partial ? ' (partial)' : ''}`,
          );
          results.push({
            ...base,
            ok: true,
            storedCount: stored.upserted,
            partial: stored.partial,
          });
          this.progress.sourcesDone += 1;
          this.progress.collected += stored.upserted;
          continue;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(
            `Collect scrape failed for ${source.url}: ${message}`,
            err instanceof Error ? err.stack : undefined,
          );
          results.push({
            ...base,
            ok: false,
            error: message,
            storedCount: 0,
            partial: true,
          });
          this.progress.sourcesDone += 1;
          continue;
        }
      }

      results.push(base);
      this.progress.sourcesDone += 1;
    }

    this.progress.phase = 'scoring';
    this.progress.message = 'Analyse et scoring des opportunités';
    void this.runPostCollectScoring();
    return results;
    } finally {
      this.batchInProgress = false;
    }
  }

  private async runPostCollectScoring(): Promise<void> {
    const mode = (process.env.KIAMA_EXTRACTION_MODE ?? 'api').trim().toLowerCase();
    try {
      if (mode === 'watcher') {
        // Mode hérité : dépôt fichier dans ao_extractor/data → watcher → score-by-pdf.
        const backfill = await this.opportunities.backfillMissingPdfs({ limit: 80 });
        if (backfill.downloaded > 0) {
          this.logger.log(
            `Post-collect: ${backfill.downloaded} PDF(s) téléchargé(s) pour scoring`,
          );
        }
        const result = await this.decisionScoring.scoreAllPending();
        this.logger.log(
          `Post-collect scoring (watcher): ${result.scored} scorée(s), ${result.skipped} ignorée(s)`,
        );
        if (result.errors.length > 0) {
          this.logger.warn(`Post-collect scoring erreurs: ${result.errors.slice(0, 5).join('; ')}`);
        }
        return;
      }

      // Mode 'api' (Option 2, défaut) : PDF transitoire envoyé à l'API extracteur,
      // scoring direct par opportunité (aucun rattachement, aucun doublon disque).
      const result = await this.opportunities.processPendingViaExtractorApi({
        limit: 80,
        onProgress: (done, total) => {
          this.progress.scoreDone = done;
          this.progress.scoreTotal = total;
        },
      });
      this.logger.log(
        `Post-collect scoring (api): ${result.processed} traitée(s), ${result.skipped} ignorée(s)`,
      );
      if (result.errors.length > 0) {
        this.logger.warn(`Post-collect scoring erreurs: ${result.errors.slice(0, 5).join('; ')}`);
      }
    } catch (err) {
      this.progress.phase = 'error';
      this.logger.warn(
        `Post-collect scoring: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.progress.running = false;
      this.progress.finishedAtMs = Date.now();
      if (this.progress.phase !== 'error') {
        this.progress.phase = 'done';
        this.progress.message = 'Terminé';
      }
    }
  }

  private async collectOne(
    source: SourceItemDto,
    globalKeywords: string[],
  ): Promise<SourceCollectResult> {
    const mode = resolveMode(source);
    const keywords = normalizeKeywords(globalKeywords, source);
    const keywordsLower = keywords.map((k) => k.toLowerCase());

    try {
      let items: CollectedItem[] =
        mode === CollectionMode.RSS
          ? await this.rss.fetchFeed(source.url)
          : await this.scrape.fetchLinks(source.url);

      items = items.filter((item) => matchesKeywords(item, keywordsLower));

      return {
        sourceId: source.id,
        sourceTitle: source.title,
        sourceUrl: source.url,
        mode: mode === CollectionMode.RSS ? 'rss' : 'scrape',
        ok: true,
        items,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        sourceId: source.id,
        sourceTitle: source.title,
        sourceUrl: source.url,
        mode: mode === CollectionMode.RSS ? 'rss' : 'scrape',
        ok: false,
        error: message,
        items: [],
      };
    }
  }
}
