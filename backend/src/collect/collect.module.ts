import { Module } from '@nestjs/common';
import { CollectController } from './collect.controller';
import { CollectService } from './collect.service';
import { RssFetchService } from './rss-fetch.service';
import { ScrapeFetchService } from './scrape-fetch.service';
import { DecisionEngineModule } from '../decision-engine/decision-engine.module';
import { OpportunitiesModule } from '../opportunities/opportunities.module';
import { ScraperModule } from '../scraper/scraper.module';

@Module({
  imports: [ScraperModule, OpportunitiesModule, DecisionEngineModule],
  controllers: [CollectController],
  providers: [CollectService, RssFetchService, ScrapeFetchService],
})
export class CollectModule {}
