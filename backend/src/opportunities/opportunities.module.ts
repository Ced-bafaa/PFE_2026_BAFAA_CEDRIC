import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DecisionEngineModule } from '../decision-engine/decision-engine.module';
import { ScraperModule } from '../scraper/scraper.module';
import { SettingsModule } from '../settings/settings.module';
import { OpportunityEntity } from './entities/opportunity.entity';
import { OpportunityFavoriteEntity } from './entities/opportunity-favorite.entity';
import { OpportunityReadEntity } from './entities/opportunity-read.entity';
import { OpportunitySubmissionJustificatifEntity } from './entities/opportunity-submission-justificatif.entity';
import { OpportunityStatusOverrideEntity } from './entities/opportunity-status-override.entity';
import { ArmpSyncSchedulerService } from './armp-sync.scheduler';
import { OpportunitiesController } from './opportunities.controller';
import { OpportunitiesService } from './opportunities.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OpportunityEntity,
      OpportunityStatusOverrideEntity,
      OpportunityFavoriteEntity,
      OpportunityReadEntity,
      OpportunitySubmissionJustificatifEntity,
    ]),
    ScraperModule,
    SettingsModule,
    DecisionEngineModule,
  ],
  controllers: [OpportunitiesController],
  providers: [
    OpportunitiesService,
    ArmpSyncSchedulerService,
  ],
  exports: [OpportunitiesService],
})
export class OpportunitiesModule {}
