import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OpportunityEntity } from '../opportunities/entities/opportunity.entity';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  imports: [TypeOrmModule.forFeature([OpportunityEntity])],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
