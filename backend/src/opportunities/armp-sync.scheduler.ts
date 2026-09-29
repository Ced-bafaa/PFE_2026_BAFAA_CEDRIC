import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { ScraperOrchestratorService } from '../scraper/scraper-orchestrator.service';
import { SettingsService } from '../settings/settings.service';
import type { SourceItem } from '../settings/sources.types';
import { OpportunitiesService } from './opportunities.service';
import type { Opportunity } from '../seed/mock-data';

/** Intervalle de vérification interne (toutes les minutes). */
const CHECK_INTERVAL_MS = 60 * 1000;

@Injectable()
export class ArmpSyncSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(ArmpSyncSchedulerService.name);
  private syncInProgress = false;
  /**
   * Clé de date (YYYY-MM-DD dans le fuseau cible) du dernier passage planifié.
   * Garantit qu'on ne lance la collecte qu'une seule fois par jour ouvrable.
   */
  private lastScheduledDayKey: string | null = null;

  constructor(
    private readonly opportunities: OpportunitiesService,
    private readonly settings: SettingsService,
    private readonly orchestrator: ScraperOrchestratorService,
    private readonly config: ConfigService,
  ) {}

  /** Activé par défaut ; `false`, `0`, `no`, `off` désactivent la synchro auto. */
  private isAutoSyncEnabled(): boolean {
    const raw = this.config
      .get<string>('ARMP_SYNC_AUTO', 'true')
      ?.trim()
      .toLowerCase();
    return !['false', '0', 'no', 'off'].includes(raw ?? '');
  }

  // ── Planification : jours ouvrables à heure fixe, tout est surchargeable ──────
  //   ARMP_SYNC_TZ   : fuseau IANA (défaut Africa/Douala)
  //   ARMP_SYNC_HOUR : heure de déclenchement 0-23 (défaut 8)
  //   ARMP_SYNC_DAYS : jours actifs 0=dim..6=sam, séparés par des virgules
  //                    (défaut 1,2,3,4,5 = lundi à vendredi)

  private tz(): string {
    return this.config.get<string>('ARMP_SYNC_TZ', 'Africa/Douala') || 'Africa/Douala';
  }

  private targetHour(): number {
    const h = parseInt(this.config.get<string>('ARMP_SYNC_HOUR', '8') ?? '8', 10);
    return Number.isFinite(h) && h >= 0 && h <= 23 ? h : 8;
  }

  private workingDays(): Set<number> {
    const raw = this.config.get<string>('ARMP_SYNC_DAYS', '1,2,3,4,5') ?? '1,2,3,4,5';
    const set = new Set<number>();
    for (const part of raw.split(',')) {
      const d = parseInt(part.trim(), 10);
      if (Number.isFinite(d) && d >= 0 && d <= 6) set.add(d);
    }
    return set.size > 0 ? set : new Set([1, 2, 3, 4, 5]);
  }

  /** Date/heure courante dans le fuseau cible (sans dépendance externe). */
  private nowInTz(): { dayKey: string; weekday: number; hour: number } {
    const now = new Date();
    const tz = this.tz();
    const dayKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now); // YYYY-MM-DD
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      hour: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
    const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '0';
    const map: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    let hour = parseInt(hourStr, 10);
    if (!Number.isFinite(hour)) hour = 0;
    if (hour === 24) hour = 0; // certains ICU renvoient « 24 » à minuit
    return { dayKey, weekday: map[wd] ?? 0, hour };
  }

  onModuleInit(): void {
    if (!this.isAutoSyncEnabled()) {
      this.logger.log('Synchro automatique désactivée (ARMP_SYNC_AUTO).');
      return;
    }
    // Si le service démarre après l'heure planifiée, on marque le jour comme
    // « déjà fait » pour ne pas relancer un passage planifié en plus du démarrage.
    const { dayKey, hour } = this.nowInTz();
    if (hour >= this.targetHour()) this.lastScheduledDayKey = dayKey;
    this.logger.log(
      `Collecte planifiée : jours [${[...this.workingDays()].sort().join(',')}] à ` +
        `${String(this.targetHour()).padStart(2, '0')}:00 (${this.tz()}).`,
    );
    void this.runSync('démarrage');
  }

  /**
   * Vérifie chaque minute et déclenche la collecte une fois par jour ouvrable,
   * à l'heure planifiée (défaut : lundi-vendredi à 08:00, fuseau Africa/Douala).
   */
  @Interval(CHECK_INTERVAL_MS)
  async handleScheduledSync(): Promise<void> {
    if (!this.isAutoSyncEnabled()) return;

    const { dayKey, weekday, hour } = this.nowInTz();
    if (this.lastScheduledDayKey === dayKey) return; // déjà lancé aujourd'hui
    if (!this.workingDays().has(weekday)) return; // pas un jour ouvrable
    if (hour < this.targetHour()) return; // pas encore l'heure

    this.lastScheduledDayKey = dayKey;
    void this.runSync(
      `planifié (${dayKey} ${String(this.targetHour()).padStart(2, '0')}:00 ${this.tz()})`,
    );
  }

  private activeScrapeSources(sources: SourceItem[]): SourceItem[] {
    return (sources ?? []).filter((s) => {
      if (!s || typeof s !== 'object') return false;
      if (s.active !== true) return false;
      const mode = (s.collectionMode ?? 'scrape').toLowerCase();
      return mode === 'scrape';
    });
  }

  private async runSync(source: string): Promise<void> {
    if (this.syncInProgress) {
      this.logger.warn(`Synchro ignorée (${source}) : une synchro est déjà en cours.`);
      return;
    }
    this.syncInProgress = true;
    try {
      const settings = await this.settings.getSourcesSettings();
      const globalKeywords = settings.globalKeywords ?? [];
      const sources = this.activeScrapeSources(settings.sources ?? []);

      if (sources.length === 0) {
        this.logger.log(`Synchro sources (${source}) : 0 source active (scrape)`);
        return;
      }

      const CONCURRENCY = 2;
      const allOpportunities: Opportunity[] = [];
      let partial = false;

      const semaphore = { active: 0, queue: [] as Array<() => void> };
      const acquire = () =>
        new Promise<void>((resolve) => {
          if (semaphore.active < CONCURRENCY) {
            semaphore.active++;
            resolve();
          } else {
            semaphore.queue.push(() => { semaphore.active++; resolve(); });
          }
        });
      const release = () => {
        semaphore.active--;
        const next = semaphore.queue.shift();
        if (next) next();
      };

      await Promise.all(
        sources.map(async (s) => {
          await acquire();
          try {
            const kw = [...(globalKeywords ?? []), ...(s.keywords ?? [])].filter(Boolean);
            const rows = await this.orchestrator.fetchOpportunitiesFromUrl(s.url, {
              keywords: kw,
            });
            this.logger.debug(
              `Synchro source "${s.url}" : ${rows.length} opportunité(s) récupérée(s)`,
            );
            allOpportunities.push(...rows);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.error(`Échec scrape source "${s.url}" : ${msg}`);
            partial = true;
          } finally {
            release();
          }
        }),
      );

      const total = allOpportunities.length;
      const res = await this.opportunities.upsertFromExternal(allOpportunities);
      partial = partial || res.partial;

      this.logger.log(
        `Synchro sources (${source}) : ${res.upserted} opportunité(s) upsert (brut=${total})${partial ? ' — PARTIAL' : ''}`,
      );

      // En mode 'api' (défaut), la collecte planifiée doit AUSSI scorer les
      // nouveaux avis, comme le bouton « Lancer une collecte ». On rejoue le
      // pipeline transitoire sur les avis encore sans décision (idempotent).
      const extractionMode = (
        this.config.get<string>('KIAMA_EXTRACTION_MODE', 'api') ?? 'api'
      )
        .trim()
        .toLowerCase();
      if (extractionMode !== 'watcher') {
        try {
          const scored = await this.opportunities.processPendingViaExtractorApi({
            limit: 80,
          });
          this.logger.log(
            `Scoring planifié (${source}) : ${scored.processed} scorée(s), ${scored.skipped} ignorée(s)`,
          );
          if (scored.errors.length > 0) {
            this.logger.warn(
              `Scoring planifié erreurs (${source}) : ${scored.errors.slice(0, 5).join('; ')}`,
            );
          }
        } catch (err) {
          this.logger.warn(
            `Scoring planifié échoué (${source}) : ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `Échec synchro sources (${source})`,
        err instanceof Error ? err.stack : String(err),
      );
    } finally {
      this.syncInProgress = false;
    }
  }
}
