import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CollectModule } from './collect/collect.module';
import { OpportunitiesModule } from './opportunities/opportunities.module';
import { PartnersModule } from './partners/partners.module';
import { TrackingModule } from './tracking/tracking.module';
import { TrashModule } from './trash/trash.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuditModule } from './audit/audit.module';
import { SettingsModule } from './settings/settings.module';
import { ScraperModule } from './scraper/scraper.module';
import { ChatModule } from './chat/chat.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'mysql' as const,
        host: config.get<string>('DB_HOST', 'localhost'),
        port: parseInt(config.get<string>('DB_PORT', '3306'), 10),
        username: config.get<string>('DB_USER', 'root'),
        password: config.get<string>('DB_PASSWORD', ''),
        database: config.get<string>('DB_NAME', 'v_tech'),
        autoLoadEntities: true,
        synchronize: config.get<string>('TYPEORM_SYNC') === 'true',
        logging:
          config.get<string>('DB_LOGGING') === 'true' ||
          config.get<string>('TYPEORM_LOGGING') === 'true',
      }),
    }),
    AuthModule,
    CollectModule,
    ScraperModule,
    OpportunitiesModule,
    PartnersModule,
    TrackingModule,
    TrashModule,
    NotificationsModule,
    AuditModule,
    SettingsModule,
    ChatModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
