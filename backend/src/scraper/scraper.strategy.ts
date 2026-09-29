import type { ArmpTender } from '../armp/armp-tender.types';

export type ScrapeOptions = {
  /** Filtre optionnel : ne remonter que les offres dont le titre contient un keyword. */
  keywords?: string[];
  /**
   * Budget temps max (ms) pour les stratégies qui le supportent (ex. ARMP multi-pages).
   * À l’échéance, retour des lignes déjà collectées au lieu d’une erreur globale.
   */
  maxDurationMs?: number;
  /**
   * Ensemble des `opportunity.id` déjà présents en base (scraping incrémental).
   * Lorsque renseigné, chaque scraper stoppe la pagination dès qu’une page entière
   * ne contient que des IDs déjà connus — évite de parcourir 500 pages pour ~30 nouveaux AOs.
   * Si absent ou vide, comportement classique (maxPages pages parcourues).
   */
  knownIds?: Set<string>;
};

export interface ITenderScraper {
  canHandle(url: string): boolean;
  scrape(url: string, options?: ScrapeOptions): Promise<ArmpTender[]>;
}

/**
 * Injection token: list of provider tokens (classes) that represent available scrapers.
 * `ScraperFactory` uses `ModuleRef` to resolve each provider and test `canHandle(url)`.
 */
export const TENDER_SCRAPER_PROVIDERS = Symbol('TENDER_SCRAPER_PROVIDERS');
