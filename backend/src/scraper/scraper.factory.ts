import { Inject, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { GenericScraperService } from './generic-scraper.service';
import { PlaywrightScraperService } from './playwright-scraper.service';
import { ITenderScraper, TENDER_SCRAPER_PROVIDERS } from './scraper.strategy';
import { TechDetectorService, type TechProfile } from './tech-detector.service';
import { MultiPortalScraper } from '../armp/multi-portal.scraper';
import { findPortalConfig, type PortalConfig } from '../armp/portal-configs';

/** Domaines souvent lents ou rendus côté client → Playwright plutôt que fetch générique. */
function preferPlaywrightForUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    if (host.endsWith('.bj')) return true;
    const extra = (process.env.SCRAPER_PLAYWRIGHT_HOSTS ?? '')
      .split(/[,;\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    return extra.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/**
 * Injecte dynamiquement un config Pridesoft pour un portail inconnu détecté par TechDetector.
 * Permet au MultiPortalScraper de traiter des portails non enregistrés dans portal-configs.json.
 */
function buildDynamicPridesoftConfig(url: string, listUrl: string): PortalConfig {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    return {
      id: `dynamic-${host}`,
      country: 'Inconnu',
      countryCode: 'XX',
      name: `Portail Pridesoft (${host})`,
      baseUrl: u.origin,
      listUrl,
      hosts: [host],
      cms: 'pridesoft',
      paginationPageParam: 'page',
      maxPages: 10,
    };
  } catch {
    return {
      id: 'dynamic-unknown',
      country: 'Inconnu',
      countryCode: 'XX',
      name: 'Portail Pridesoft inconnu',
      baseUrl: url,
      listUrl,
      hosts: [],
      cms: 'pridesoft',
      maxPages: 10,
    };
  }
}

@Injectable()
export class ScraperFactory {
  private readonly logger = new Logger(ScraperFactory.name);

  constructor(
    private readonly moduleRef: ModuleRef,
    @Inject(TENDER_SCRAPER_PROVIDERS)
    private readonly scraperProviders: Array<new (...args: any[]) => unknown>,
    private readonly techDetector: TechDetectorService,
  ) {}

  /**
   * Sélection synchrone — basée uniquement sur canHandle() (URL / hostname).
   * Utilisé quand la détection a déjà eu lieu ou n'est pas nécessaire.
   */
  getScraper(url: string): ITenderScraper {
    if (typeof url !== 'string' || !url.trim()) {
      this.logger.warn(`Invalid url passed to getScraper(): ${String(url)}`);
    } else {
      this.logger.debug(`Factory a reçu l'URL: ${url}`);
    }

    for (const token of this.scraperProviders) {
      const instance = this.moduleRef.get(token as any, { strict: false });
      if (!instance) continue;
      if (
        typeof (instance as any).canHandle === 'function' &&
        typeof (instance as any).scrape === 'function' &&
        (instance as ITenderScraper).canHandle(url)
      ) {
        this.logger.debug(
          `Scraper sélectionné: ${token?.name ?? 'UnknownProvider'}`,
        );
        return instance as ITenderScraper;
      }
    }

    if (preferPlaywrightForUrl(url)) {
      const pw = this.moduleRef.get(PlaywrightScraperService, { strict: false });
      if (pw) {
        this.logger.debug(`Scraper sélectionné: PlaywrightScraperService (domaine dynamique)`);
        return pw as ITenderScraper;
      }
    }

    this.logger.debug(`Scraper sélectionné: GenericScraperService`);
    return this.moduleRef.get(GenericScraperService, { strict: false });
  }

  /**
   * Sélection ASYNC — détecte la technologie du portail puis choisit la stratégie optimale.
   *
   * Priorité :
   *   1. canHandle() — scrapers spécifiques enregistrés (ARMP, portails connus)
   *   2. TechDetector — analyse HTML/headers du portail
   *      • Pridesoft détecté → MultiPortalScraper (parseur Pridesoft)
   *      • Joomla détecté   → MultiPortalScraper (parseur Joomla)
   *      • SPA détecté      → PlaywrightScraperService
   *      • WordPress/Drupal/Next → GenericScraperService (SSR, cheerio suffit)
   *        NB: WordPress enregistré dans portal-configs → MultiPortalScraper (parseur wordpress)
   *            traité par canHandle() avant d'arriver ici
   *   3. Fallback → GenericScraperService
   *
   * Le résultat du détecteur est mis en cache par hostname (TTL 1h) :
   * la détection ne coûte qu'un seul fetch HTTP supplémentaire par portail.
   */
  async getScraperAsync(url: string): Promise<{
    scraper: ITenderScraper;
    profile: TechProfile;
    dynamicListUrl?: string;
  }> {
    // ── 1. canHandle() synchrone d'abord ──────────────────────────────────
    for (const token of this.scraperProviders) {
      const instance = this.moduleRef.get(token as any, { strict: false });
      if (!instance) continue;
      if (
        typeof (instance as any).canHandle === 'function' &&
        typeof (instance as any).scrape === 'function' &&
        (instance as ITenderScraper).canHandle(url)
      ) {
        const name = (token as any)?.name ?? 'UnknownProvider';
        this.logger.debug(`[AsyncFactory] Scraper spécifique sélectionné: ${name}`);
        // Profil synthétique pour un scraper connu — pas besoin de détecter.
        const syntheticProfile: TechProfile = {
          tech: name.includes('Armp') ? 'pridesoft' : 'static',
          needsJs: false,
          confidence: 'high',
        };
        return { scraper: instance as ITenderScraper, profile: syntheticProfile };
      }
    }

    // ── 2. Détection technologique ────────────────────────────────────────
    const profile = await this.techDetector.detect(url);
    this.logger.log(
      `[AsyncFactory] ${url} → tech="${profile.tech}" needsJs=${profile.needsJs} confidence=${profile.confidence}`,
    );

    const multiPortal = this.moduleRef.get(MultiPortalScraper, { strict: false });
    const playwright = this.moduleRef.get(PlaywrightScraperService, { strict: false });
    const generic = this.moduleRef.get(GenericScraperService, { strict: false });

    switch (profile.tech) {
      // ── Pridesoft détecté dynamiquement ──────────────────────────────────
      case 'pridesoft': {
        const listUrl = profile.pridesoft?.listUrl ?? url;
        if (multiPortal) {
          // Si pas déjà dans le registre, on injecte une config dynamique.
          if (!findPortalConfig(url)) {
            const dynConfig = buildDynamicPridesoftConfig(url, listUrl);
            (multiPortal as MultiPortalScraper).injectDynamicConfig(dynConfig);
            this.logger.log(
              `[AsyncFactory] Config Pridesoft dynamique injectée pour ${url}`,
            );
          }
          return { scraper: multiPortal as ITenderScraper, profile, dynamicListUrl: listUrl };
        }
        // Fallback si MultiPortal absent
        return { scraper: generic as ITenderScraper, profile };
      }

      // ── Joomla détecté ───────────────────────────────────────────────────
      case 'joomla': {
        if (multiPortal) {
          if (!findPortalConfig(url)) {
            try {
              const origin = new URL(url).origin;
              const dynConfig: PortalConfig = {
                id: `dynamic-joomla-${new URL(url).hostname.replace(/^www\./i, '').replace(/\./g, '-')}`,
                country: 'Inconnu',
                countryCode: 'XX',
                name: `Portail Joomla (${new URL(url).hostname})`,
                baseUrl: origin,
                listUrl: `${origin}/index.php?option=com_loffres`,
                hosts: [new URL(url).hostname.replace(/^www\./i, '').toLowerCase()],
                cms: 'joomla-loffres',
                paginationOffsetParam: 'limitstart',
                itemsPerPage: 15,
                maxPages: 10,
              };
              (multiPortal as MultiPortalScraper).injectDynamicConfig(dynConfig);
              this.logger.log(`[AsyncFactory] Config Joomla dynamique injectée pour ${url}`);
            } catch { /* ignore URL parse error */ }
          }
          return { scraper: multiPortal as ITenderScraper, profile };
        }
        return { scraper: generic as ITenderScraper, profile };
      }

      // ── SPA client-side : Playwright obligatoire ──────────────────────────
      case 'spa':
        this.logger.debug(`[AsyncFactory] SPA détecté → Playwright`);
        return { scraper: (playwright ?? generic) as ITenderScraper, profile };

      // ── WordPress, Drupal, Next.js, Nuxt, static : HTML serveur ──────────
      // cheerio (GenericScraperService) suffit pour du HTML rendu serveur.
      case 'wordpress':
      case 'drupal':
      case 'nextjs':
      case 'nuxt':
      case 'static':
      default:
        this.logger.debug(
          `[AsyncFactory] tech="${profile.tech}" → GenericScraperService`,
        );
        return { scraper: generic as ITenderScraper, profile };
    }
  }
}

