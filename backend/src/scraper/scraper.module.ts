import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OpportunityEntity } from '../opportunities/entities/opportunity.entity';
import { ArmpSpecificScraper } from '../armp/armp-specific.scraper';
import { MultiPortalScraper } from '../armp/multi-portal.scraper';
import { GenericScraperService } from './generic-scraper.service';
import { PlaywrightScraperService } from './playwright-scraper.service';
import { TechDetectorService } from './tech-detector.service';
import { DownloadService } from './download.service';
import { FileStorageService } from './file-storage.service';
import { ScraperFactory } from './scraper.factory';
import { ScraperOrchestratorService } from './scraper-orchestrator.service';
import { ScraperController } from './scraper.controller';
import { TENDER_SCRAPER_PROVIDERS } from './scraper.strategy';
import { DecisionEngineModule } from '../decision-engine/decision-engine.module';

@Module({
  imports: [DecisionEngineModule, TypeOrmModule.forFeature([OpportunityEntity])],
  controllers: [ScraperController],
  providers: [
    ArmpSpecificScraper,
    MultiPortalScraper,
    GenericScraperService,
    PlaywrightScraperService,
    TechDetectorService,
    DownloadService,
    FileStorageService,
    ScraperFactory,
    ScraperOrchestratorService,
    {
      provide: TENDER_SCRAPER_PROVIDERS,
      // Ordre : spécifiques d'abord, MultiPortal avant le générique,
      // puis Playwright (SPA/JS-heavy), le Generic reste le fallback implicite.
      useValue: [ArmpSpecificScraper, MultiPortalScraper, PlaywrightScraperService],
    },
  ],
  exports: [ScraperFactory, ScraperOrchestratorService, DownloadService, FileStorageService],
})
export class ScraperModule {}

