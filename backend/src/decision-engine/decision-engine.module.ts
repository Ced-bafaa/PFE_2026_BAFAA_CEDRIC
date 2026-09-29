import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OpportunityEntity } from '../opportunities/entities/opportunity.entity';
import { PartnersModule } from '../partners/partners.module';
import { DecisionEngineClient } from './decision-engine.client';
import { DecisionScoringScheduler } from './decision-scoring.scheduler';
import { DecisionScoringService } from './decision-scoring.service';
import { ExtractorApiClient } from './extractor-api.client';
import { ExtractorResultsReader } from './extractor-results.reader';

@Module({
  imports: [TypeOrmModule.forFeature([OpportunityEntity]), PartnersModule],
  providers: [
    DecisionEngineClient,
    ExtractorApiClient,
    ExtractorResultsReader,
    DecisionScoringService,
    DecisionScoringScheduler,
  ],
  exports: [DecisionScoringService, DecisionEngineClient, ExtractorApiClient],
})
export class DecisionEngineModule {}
