/**
 * Backward-compatibility shim: the ARMP scraper is now a Strategy (`ArmpSpecificScraper`).
 * Keep this file for now so existing imports don't break abruptly.
 */
export { ArmpSpecificScraper as ArmpScraperService } from './armp-specific.scraper';

