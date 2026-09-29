import { Body, Controller, Logger, Post } from '@nestjs/common';
import type { Opportunity } from '../seed/mock-data';
import {
  dedupeOpportunitiesByStableKey,
  toPublicOpportunityList,
} from '../opportunities/opportunity-public.util';
import { ScraperOrchestratorService } from './scraper-orchestrator.service';
import { ScrapeUrlDto } from './dto/scrape-url.dto';

@Controller()
export class ScraperController {
  private readonly logger = new Logger(ScraperController.name);
  constructor(private readonly orchestrator: ScraperOrchestratorService) {}

  /**
   * Point d'entrée unique de scraping pour le front.
   * Envoie une URL et récupère des opportunités normalisées (Opportunity[]).
   * Par défaut, enchaîne les stratégies jusqu’à ce qu’il y ait des résultats (sauf `directScrape: true`).
   */
  @Post('scrape')
  async scrape(@Body() dto: ScrapeUrlDto): Promise<Opportunity[]> {
    this.logger.debug(
      `POST /scrape url=${dto.url} directScrape=${dto.directScrape === true} keywords=${JSON.stringify(dto.keywords ?? [])}`,
    );
    const raw = await this.orchestrator.fetchOpportunitiesFromUrl(dto.url, {
      directScrape: dto.directScrape === true,
      keywords: dto.keywords,
    });
    const opportunities = toPublicOpportunityList(
      dedupeOpportunitiesByStableKey(raw),
    );
    console.log(
      "Nombre d'opportunités envoyées au front:",
      opportunities.length,
    );
    return opportunities;
  }
}

