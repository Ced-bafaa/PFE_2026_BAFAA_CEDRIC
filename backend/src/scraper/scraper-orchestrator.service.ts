import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { OpportunityEntity } from '../opportunities/entities/opportunity.entity';
import type { Opportunity } from '../seed/mock-data';
import type { ArmpTender } from '../armp/armp-tender.types';
import { mapArmpTenderToOpportunity } from '../armp/armp-to-opportunity.mapper';
import {
  dedupeArmpTendersByRefAndUrl,
  isBeninPublicHost,
} from './armp-tender-merge.util';
import {
  dedupeOpportunitiesByStableKey,
  toPublicOpportunityList,
} from '../opportunities/opportunity-public.util';
import { ScraperFactory } from './scraper.factory';
import { PlaywrightScraperService } from './playwright-scraper.service';
import { GenericScraperService } from './generic-scraper.service';
import { DownloadService } from './download.service';
import { textMatchesAnyKeyword } from './keyword-match.util';
import { ArmpSpecificScraper } from '../armp/armp-specific.scraper';
import { MultiPortalScraper } from '../armp/multi-portal.scraper';
import { findPortalConfig } from '../armp/portal-configs';
import type { ScrapeOptions } from './scraper.strategy';
import {
  FileStorageService,
  resolveTenderAssetUrl,
} from './file-storage.service';

type Attempt = {
  name: string;
  run: () => Promise<ArmpTender[]>;
};

/** Timeout global scraper (10 min). Les stratégies coopératives (ARMP) renvoient aussi des données partielles si le budget est dépassé. */
const ORCHESTRATOR_TIMEOUT_MS = 600_000;

/** Marge réseau après arrêt coopératif : évite un rejet dur si une requête HTTP traîne légèrement. */
const ORCHESTRATOR_HARD_CAP_EXTRA_MS = 180_000;

function isArmpHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    return host === 'armp.cm' || host.endsWith('.armp.cm');
  } catch {
    return String(url).toLowerCase().includes('armp.cm');
  }
}

/**
 * Identifie les hôtes gouvernementaux / portails publics africains connus.
 * Pour ces hosts, la concurrence PDF est réduite à 1 afin d'éviter le bannissement.
 */
function isGovernmentHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    // Tous les portails enregistrés dans le registre multi-portail sont gouvernementaux.
    if (findPortalConfig(url) !== null) return true;
    return (
      host === 'armp.cm' ||
      host.endsWith('.armp.cm') ||
      host === 'arcop.bf' ||
      host.endsWith('.arcop.bf') ||
      host === 'marchespublics.gov.bf' ||
      host.endsWith('.gov.bf') ||
      host.endsWith('.gouv.bj') ||
      host === 'armp.bj' ||
      host.endsWith('.armp.bj') ||
      host.endsWith('.gov.cm') ||
      host.endsWith('.gouv.cm') ||
      host.endsWith('.gouv.sn') ||
      host.endsWith('.gov.sn') ||
      host.endsWith('.gouv.ci') ||
      host.endsWith('.gouv.ml') ||
      host.endsWith('.gouv.tg') ||
      host.endsWith('.gov.ne') ||
      host.endsWith('.gouv.ga') ||
      host.endsWith('.gov.gn')
    );
  } catch {
    return false;
  }
}

/** Délai aléatoire entre téléchargements PDF sur un même hôte (600–1400 ms). */
const pdfInterDelay = () =>
  new Promise<void>((r) => setTimeout(r, 600 + Math.random() * 800));

function normalizeArmpFilterUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    if (!(host === 'armp.cm' || host.endsWith('.armp.cm'))) return rawUrl;
    // Si on pointe la home page (ou une page non filtre), basculer sur un filtre avis.
    // ARMP fournit des listes via /filtres?type=avis&val=...
    if (u.pathname === '/' || u.pathname === '') {
      return `${u.origin}/filtres?type=avis&val=1`;
    }
    if (u.pathname.toLowerCase() === '/filtres') {
      // garantir "type=avis"
      if (!u.searchParams.get('type')) u.searchParams.set('type', 'avis');
      if (!u.searchParams.get('val')) u.searchParams.set('val', '1');
      return u.toString();
    }
    return rawUrl;
  } catch {
    return rawUrl;
  }
}

function withTimeout<T>(p: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return p;
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout ${timeoutMs}ms: ${label}`)), timeoutMs);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.min(6, Math.floor(concurrency || 1)));
  const out: R[] = new Array(items.length);
  let idx = 0;
  const workers = new Array(limit).fill(0).map(async () => {
    while (true) {
      const i = idx;
      idx += 1;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

@Injectable()
export class ScraperOrchestratorService {
  private readonly logger = new Logger(ScraperOrchestratorService.name);

  constructor(
    private readonly factory: ScraperFactory,
    private readonly playwright: PlaywrightScraperService,
    private readonly generic: GenericScraperService,
    private readonly download: DownloadService,
    private readonly fileStorage: FileStorageService,
    private readonly multiPortal: MultiPortalScraper,
    @InjectRepository(OpportunityEntity)
    private readonly opportunityRepo: Repository<OpportunityEntity>,
  ) {}

  /**
   * Persiste l'internalFileId dès le téléchargement du PDF : le matching
   * exact par nom de fichier devient le chemin nominal du scoring (plus
   * besoin du matching flou par similarité de titres).
   * L'upsert de l'opportunité étant concurrent au téléchargement, on
   * retente une fois si la ligne n'existe pas encore en base.
   */
  private persistInternalFileId(opportunityId: string, internalFileId: string): void {
    const attempt = async (): Promise<number> => {
      const res = await this.opportunityRepo.update(
        { id: opportunityId },
        { internalFileId },
      );
      return res.affected ?? 0;
    };
    void attempt()
      .then(async (affected) => {
        if (affected === 0) {
          await new Promise((r) => setTimeout(r, 5_000));
          const retried = await attempt();
          if (retried === 0) {
            this.logger.warn(
              `internalFileId ${internalFileId} non persisté : opportunité ${opportunityId} absente en base.`,
            );
          }
        }
      })
      .catch((err) =>
        this.logger.warn(`Persistance internalFileId ${internalFileId} échouée : ${err}`),
      );
  }

  private filterTendersByKeywords(tenders: ArmpTender[], keywords?: string[]): ArmpTender[] {
    const list = (keywords ?? []).map((k) => String(k).trim()).filter(Boolean);
    if (list.length === 0) return tenders;
    return (tenders ?? []).filter((t) => {
      const title = String(t?.title ?? '');
      if (!title) return false;
      // Match « début de mot » (sigles courts en mot entier) → supprime les
      // faux positifs de sous-chaîne (« TIC » ≠ « logistique »/« diagnostic »).
      return textMatchesAnyKeyword(title, list);
    });
  }

  /**
   * Appelle le filtre sémantique du decision_engine (POST /relevance).
   * Renvoie null si indisponible (service répond available=false, ou erreur réseau),
   * auquel cas l'appelant retombe automatiquement sur les mots-clés.
   */
  private async classifyRelevance(
    objets: string[],
  ): Promise<Array<{ pertinent: boolean }> | null> {
    const base = (process.env.DECISION_ENGINE_URL ?? 'http://localhost:8765').replace(/\/$/, '');
    // Le modèle d'embeddings est CPU-bound : classer 200 objets d'un coup dépasse
    // les 30 s et faisait basculer tout le filtre en repli (→ on gardait tout).
    // On découpe en paquets pour que l'hybride s'exécute VRAIMENT sur chaque source.
    const CHUNK = 40;
    const TIMEOUT_MS = 60_000;
    const out: Array<{ pertinent: boolean }> = [];
    for (let i = 0; i < objets.length; i += CHUNK) {
      const slice = objets.slice(i, i + CHUNK);
      let res: Array<{ pertinent: boolean }> | null = null;
      for (let attempt = 1; attempt <= 2 && res === null; attempt++) {
        try {
          const { data } = await axios.post<{
            available: boolean;
            results: Array<{ pertinent: boolean }>;
          }>(`${base}/relevance`, { objets: slice }, { timeout: TIMEOUT_MS });
          if (!data?.available) return null; // filtre désactivé côté engine → repli global
          res = data.results ?? [];
        } catch (err) {
          this.logger.warn(
            `/relevance paquet ${i}-${i + slice.length} échec (tentative ${attempt}/2) : ${err}`,
          );
        }
      }
      if (res === null || res.length !== slice.length) {
        this.logger.warn('/relevance indisponible après relance — repli sur les mots-clés.');
        return null;
      }
      out.push(...res);
    }
    return out;
  }

  /**
   * Filtrage de pertinence. RELEVANCE_MODE=semantic → filtre sémantique (embeddings)
   * du decision_engine, avec repli automatique sur les mots-clés si indisponible.
   * Sinon (défaut "keywords") → filtre par mots-clés inchangé.
   */
  private async relevanceFilter(
    tenders: ArmpTender[],
    keywords?: string[],
  ): Promise<ArmpTender[]> {
    const mode = (process.env.RELEVANCE_MODE ?? 'keywords').toLowerCase();
    if (mode !== 'semantic') {
      return this.filterTendersByKeywords(tenders, keywords);
    }
    const list = (tenders ?? []).filter((t) => String(t?.title ?? '').trim());
    const res = await this.classifyRelevance(list.map((t) => String(t.title)));
    if (!res || res.length !== list.length) {
      this.logger.warn('Filtre sémantique indisponible → repli sur les mots-clés.');
      return this.filterTendersByKeywords(tenders, keywords);
    }
    const kept = list.filter((_, i) => res[i]?.pertinent !== false);
    this.logger.log(
      `Filtre sémantique : ${kept.length}/${list.length} AO retenus (mots-clés débranchés).`,
    );
    return kept;
  }

  private async opportunitiesFromTenders(
    tenders: ArmpTender[],
    opts?: { keywords?: string[]; sourceUrl?: string },
  ): Promise<Opportunity[]> {
    // Filtrage de pertinence : sémantique (embeddings) si RELEVANCE_MODE=semantic,
    // sinon mots-clés (globalKeywords + keywords par source). Repli auto sur mots-clés.
    const filtered = await this.relevanceFilter(tenders, opts?.keywords);

    // Concurrence PDF adaptée à l'hôte source : 1 pour les portails gouvernementaux
    // (ARMP, ARCOP, portails .gouv.*), 2 pour les autres sources.
    const govHost = opts?.sourceUrl ? isGovernmentHost(opts.sourceUrl) : true;
    const pdfConcurrency = govHost ? 1 : 2;

    const mapped = filtered.map((t) => ({ t, opp: mapArmpTenderToOpportunity(t) }));
    const opportunities = mapped.map((m) => m.opp);

    // ── Phase 1 : déduplication et retour immédiat ────────────────────────
    // Les métadonnées sont retournées sans attendre les PDFs — la DB est mise
    // à jour immédiatement et le front peut afficher les résultats.
    const total = opportunities.length;
    const finalList = dedupeOpportunitiesByStableKey(opportunities);
    this.logger.debug(
      `Doublons supprimés: ${total - finalList.length} (total: ${total}, uniques: ${finalList.length})`,
    );

    // ── Phase 2 : téléchargement PDFs en arrière-plan (mode 'watcher' uniquement) ──
    // En mode 'api' (Option 2, défaut), le PDF est transitoire et traité par
    // OpportunitiesService.processPendingViaExtractorApi APRÈS la persistance —
    // ce qui supprime la race condition et les doublons de téléchargement.
    // Ce bloc « eager » n'est conservé que pour le mode hérité 'watcher'.
    const extractionMode = (process.env.KIAMA_EXTRACTION_MODE ?? 'api')
      .trim()
      .toLowerCase();
    if (extractionMode === 'watcher')
      mapWithConcurrency(mapped, pdfConcurrency, async ({ t, opp }) => {
      if (t.internalFileId?.trim()) return;

      const dlRaw = String((t as any)?.downloadLink ?? '').trim();
      const duRaw = String((t as any)?.detailUrl ?? '').trim();
      const dl = dlRaw ? resolveTenderAssetUrl(dlRaw, t) : '';
      const du = duRaw ? resolveTenderAssetUrl(duRaw, t) : '';

      const tryUrl = async (url: string, kind: 'downloadLink' | 'detailUrl') => {
        const r = await this.fileStorage.downloadPdfIfNeeded({
          opportunityId: opp.id,
          url,
          kind,
        });
        if (r.saved && r.internalFileId) {
          t.internalFileId = r.internalFileId;
          opp.internalFileId = r.internalFileId;
          this.persistInternalFileId(opp.id, r.internalFileId);
        }
        return r.saved;
      };

      if (dl && (await tryUrl(dl, 'downloadLink'))) {
        if (govHost) await pdfInterDelay();
        return;
      }
      if (du) {
        await tryUrl(du, 'detailUrl');
        if (govHost) await pdfInterDelay();
      }
    }).catch((err) => {
      this.logger.warn(
        `[PDF arrière-plan] Erreur : ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    return finalList;
  }

  /**
   * Même jeu de lignes brutes que pour une fusion Bénin (Playwright + HTTP), réutilisable par la sync.
   */
  async mergedTendersForBeninUrl(url: string, options?: { keywords?: string[] }): Promise<ArmpTender[]> {
    const bundle: ArmpTender[] = [];
    try {
      bundle.push(...(await this.playwright.scrape(url, { keywords: options?.keywords })));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Playwright (BJ) : ${msg}`);
    }
    try {
      bundle.push(...(await this.generic.scrape(url, { keywords: options?.keywords })));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Generic HTTP (BJ) : ${msg}`);
    }
    const out = dedupeArmpTendersByRefAndUrl(bundle);
    this.logger.log(
      `mergedTendersForBeninUrl : ${out.length} avis unique(s) (brut combiné ${bundle.length})`,
    );
    return out;
  }

  /**
   * Mode "universel" : Playwright (rendu DOM) + Generic (fetch HTML) en parallèle.
   * Retourne ce qui est disponible sans bloquer indéfiniment sur un site lent.
   */
  async mergedTendersForDynamicUrl(url: string, options?: { keywords?: string[] }): Promise<ArmpTender[]> {
    const bundle: ArmpTender[] = [];
    const tasks = [
      withTimeout(
        this.playwright.scrape(url, { keywords: options?.keywords }),
        55_000,
        `Playwright scrape ${url}`,
      ).then(
        (rows) => ({ name: 'Playwright', rows }),
        (err) => ({ name: 'Playwright', rows: [], err }),
      ),
      withTimeout(
        this.generic.scrape(url, { keywords: options?.keywords }),
        35_000,
        `Generic scrape ${url}`,
      ).then(
        (rows) => ({ name: 'Generic', rows }),
        (err) => ({ name: 'Generic', rows: [], err }),
      ),
    ];
    const settled = await Promise.all(tasks);
    for (const s of settled) {
      if ((s as any).err) {
        const e = (s as any).err;
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(`${s.name} (universel) : ${msg}`);
      }
      bundle.push(...s.rows);
    }
    const out = dedupeArmpTendersByRefAndUrl(bundle);
    this.logger.log(
      `mergedTendersForDynamicUrl : ${out.length} avis unique(s) (brut combiné ${bundle.length}) — ${url}`,
    );
    return out;
  }

  async fetchOpportunitiesFromUrl(
    url: string,
    options?: { directScrape?: boolean; keywords?: string[]; knownIds?: Set<string> },
  ): Promise<Opportunity[]> {
    try {
      const normalizedUrl = isArmpHost(url) ? normalizeArmpFilterUrl(url) : url;
      if (normalizedUrl !== url) {
        this.logger.debug(`ARMP: URL normalisée vers filtres: ${url} -> ${normalizedUrl}`);
      } else if (isArmpHost(url) && !String(url).includes('type=avis')) {
        this.logger.debug(`ARMP: URL utilisée (attendu filtres type=avis): ${url}`);
      }

      /** Bénin : si le portail est géré par MultiPortalScraper (registre), on utilise son parseur.
       *  Sinon (portail .bj inconnu), on fusionne Playwright + Generic comme avant. */
      if (isBeninPublicHost(normalizedUrl) && options?.directScrape !== true && findPortalConfig(normalizedUrl) === null) {
        const tenders = await this.mergedTendersForBeninUrl(normalizedUrl, {
          keywords: options?.keywords,
        });
        return toPublicOpportunityList(
          await this.opportunitiesFromTenders(tenders, {
            keywords: options?.keywords,
            sourceUrl: normalizedUrl,
          }),
        );
      }

      // Stratégie universelle (dynamique) : tentative fusion Playwright + Generic si l'URL est lente / SPA.
      // Activable via env : SCRAPER_MERGE_DYNAMIC=true (par défaut).
      const mergeDynamicRaw = (process.env.SCRAPER_MERGE_DYNAMIC ?? 'true')
        .trim()
        .toLowerCase();
      const mergeDynamic = !['false', '0', 'no', 'off'].includes(mergeDynamicRaw);
      // IMPORTANT: ARMP et les portails multi-pays ont leur propre parseur spécifique.
      // Ne jamais lancer Playwright/Generic en fusion parallèle pour ces portails.
      const hasSpecificScraper =
        isArmpHost(normalizedUrl) || findPortalConfig(normalizedUrl) !== null;
      if (mergeDynamic && options?.directScrape !== true && !hasSpecificScraper) {
        const tenders = await this.mergedTendersForDynamicUrl(normalizedUrl, {
          keywords: options?.keywords,
        });
        const list = await this.opportunitiesFromTenders(tenders, {
          keywords: options?.keywords,
          sourceUrl: normalizedUrl,
        });
        if (list.length > 0) return toPublicOpportunityList(list);
      }

      // Utiliser getScraperAsync : détecte la technologie si le portail est inconnu.
      // Pour les portails déjà enregistrés (ARMP, MultiPortal), retour immédiat depuis le cache.
      const { scraper: primary, profile: techProfile, dynamicListUrl } =
        await this.factory.getScraperAsync(normalizedUrl);
      const primaryName = primary.constructor?.name ?? 'UnknownScraper';
      this.logger.debug(
        `Factory selected ${primaryName} for ${normalizedUrl} (tech=${techProfile.tech}, confidence=${techProfile.confidence})`,
      );
      // Si le détecteur a fourni une URL de liste canonique (ex. Pridesoft home → /filtres),
      // on l'utilise à la place de l'URL originale.
      const effectiveUrl = dynamicListUrl ?? normalizedUrl;

      const scrapeOpts: ScrapeOptions = {
        keywords: options?.keywords,
        maxDurationMs: ORCHESTRATOR_TIMEOUT_MS,
        knownIds: options?.knownIds,
      };

      // Séquençage strict : ARMP et MultiPortal ont leur propre parseur —
      // ne jamais enchaîner Playwright/Generic pour ces portails.
      const isArmpSpecific = primary instanceof ArmpSpecificScraper;
      const isMultiPortal = primary instanceof MultiPortalScraper;
      const isSpecificScraper = isArmpSpecific || isMultiPortal;

      const attempts: Attempt[] = [
        {
          name: primaryName,
          run: () => primary.scrape(effectiveUrl, scrapeOpts),
        },
      ];

      // Fallback chain: Playwright then Generic.
      // Éviter de relancer la même stratégie, et ne pas dupliquer les portails spécifiques.
      if (!isSpecificScraper && !(primary instanceof PlaywrightScraperService)) {
        attempts.push({
          name: this.playwright.constructor?.name ?? 'PlaywrightScraperService',
          run: () => this.playwright.scrape(effectiveUrl, scrapeOpts),
        });
      }
      if (!isSpecificScraper && !(primary instanceof GenericScraperService)) {
        attempts.push({
          name: this.generic.constructor?.name ?? 'GenericScraperService',
          run: () => this.generic.scrape(effectiveUrl, scrapeOpts),
        });
      }

      const hardCapMs = ORCHESTRATOR_TIMEOUT_MS + ORCHESTRATOR_HARD_CAP_EXTRA_MS;

      for (const a of attempts) {
        try {
          this.logger.log(
            `Lancement du scraping pour ${effectiveUrl} (Timeout: ${Math.round(
              ORCHESTRATOR_TIMEOUT_MS / 1000,
            )}s, plafond dur ${Math.round(hardCapMs / 1000)}s) — ${a.name}`,
          );
          const tenders = await withTimeout(
            a.run(),
            hardCapMs,
            `${a.name} scrape ${effectiveUrl}`,
          );
          this.logger.debug(
            `Raw tenders from ${a.name} for ${effectiveUrl}: ${tenders.length}`,
          );
          const finalList = await this.opportunitiesFromTenders(tenders, {
            keywords: options?.keywords,
            sourceUrl: effectiveUrl,
          });
          this.logger.debug(
            `Final opportunities after mapper+filter for ${effectiveUrl}: ${finalList.length}`,
          );
          // Mode direct : réponse après la première stratégie (même vide), sans enchaîner Playwright / Generic.
          if (options?.directScrape === true) {
            return toPublicOpportunityList(finalList);
          }
          if (finalList.length > 0) {
            return toPublicOpportunityList(finalList);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(
            `Scraper ${a.name} failed for ${effectiveUrl}: ${msg}`,
            err instanceof Error ? err.stack : undefined,
          );
          // Séquençage strict : si le scraper spécifique échoue, pas de fallback.
          if (isSpecificScraper) break;
        }
      }

      // All attempts failed => return empty array (no network error to Swagger)
      return [];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `ScraperOrchestratorService failed for ${url}: ${msg}`,
        err instanceof Error ? err.stack : undefined,
      );
      return [];
    }
  }

  /**
   * Scrape plusieurs URLs avec parallélisme limité et timeouts.
   * Utile pour agréger plusieurs sources et renvoyer une liste partielle si certains sites sont lents.
   */
  async fetchOpportunitiesFromUrls(
    urls: string[],
    options?: { concurrency?: number; timeoutMs?: number },
  ): Promise<{
    opportunities: Opportunity[];
    timedOutUrls: string[];
  }> {
    const list = (urls ?? []).map((u) => String(u).trim()).filter(Boolean);
    const timedOutUrls: string[] = [];
    const timeoutMs = options?.timeoutMs ?? ORCHESTRATOR_TIMEOUT_MS;
    const concurrency = options?.concurrency ?? 2;

    const results = await mapWithConcurrency(list, concurrency, async (u) => {
      try {
        const res = await withTimeout(this.fetchOpportunitiesFromUrl(u), timeoutMs, `fetch ${u}`);
        return res;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.toLowerCase().includes('timeout')) timedOutUrls.push(u);
        this.logger.warn(`Source lente/KO (retour partiel) — ${u} — ${msg}`);
        return [] as Opportunity[];
      }
    });

    const merged = results.flat();
    return {
      opportunities: toPublicOpportunityList(dedupeOpportunitiesByStableKey(merged)),
      timedOutUrls,
    };
  }
}
