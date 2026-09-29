import { Body, Controller, Get, Logger, Post } from '@nestjs/common';
import { CollectService } from './collect.service';
import { CollectBatchDto, CollectPreviewDto } from './dto/source-item.dto';
import type { SourceCollectResult } from './types/collected-item';

@Controller('collect')
export class CollectController {
  private readonly logger = new Logger(CollectController.name);

  constructor(private readonly collectService: CollectService) {}

  /**
   * Teste une source (comme depuis le formulaire Paramètres > Sources).
   */
  @Post('preview')
  preview(@Body() dto: CollectPreviewDto): Promise<SourceCollectResult> {
    return this.collectService.preview(dto);
  }

  /**
   * Lance la collecte pour toutes les sources actives du payload (même forme que le JSON frontend).
   */
  @Post('run')
  run(@Body() dto: CollectBatchDto): { status: 'Scraping started' } {
    // Non-bloquant: on déclenche, puis on répond immédiatement.
    void this.collectService.runBatch(dto).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Collect run failed: ${msg}`, err instanceof Error ? err.stack : undefined);
    });
    return { status: 'Scraping started' };
  }

  /** État d'avancement de la collecte (pour la barre de progression). */
  @Get('status')
  status() {
    return this.collectService.getProgress();
  }
}
