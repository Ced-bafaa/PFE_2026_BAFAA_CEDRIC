import { Module } from '@nestjs/common';
import { OpportunitiesModule } from '../opportunities/opportunities.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [OpportunitiesModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
