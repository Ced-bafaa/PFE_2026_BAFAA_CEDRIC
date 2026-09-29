import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { DecisionEngineModule } from '../decision-engine/decision-engine.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [DecisionEngineModule, AuditModule],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
