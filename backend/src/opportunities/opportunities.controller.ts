import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DecisionScoringService } from '../decision-engine/decision-scoring.service';
import { OpportunitiesService } from './opportunities.service';
import { UpdateOpportunityStatusDto } from './dto/update-status.dto';
import { EnrichOpportunityDto } from './dto/enrich-opportunity.dto';
import { ScoreByPdfDto } from './dto/score-by-pdf.dto';
import type { Opportunity } from '../seed/mock-data';
import { opportunitiesSeed } from '../seed/mock-data';

const PDF_MAX_BYTES = 20 * 1024 * 1024;

@Controller()
export class OpportunitiesController {
  private readonly logger = new Logger(OpportunitiesController.name);
  constructor(
    private readonly opportunities: OpportunitiesService,
    private readonly decisionScoring: DecisionScoringService,
  ) {}

  @Get('opportunities')
  async list(
    @Query('keywords') keywords?: string[] | string,
  ): Promise<Opportunity[]> {
    this.logger.debug(
      `GET /opportunities keywords(raw)=${JSON.stringify(keywords ?? null)}`,
    );
    const kw =
      typeof keywords === 'string'
        ? keywords
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : (keywords ?? []).map((s) => String(s).trim()).filter(Boolean);
    this.logger.debug(
      `GET /opportunities keywords(parsed)=${JSON.stringify(kw)}`,
    );
    const opportunities = await this.opportunities.list({ keywords: kw });
    console.log(
      "Nombre d'opportunités envoyées au front:",
      opportunities.length,
    );
    return opportunities;
  }

  @Post('opportunities/sync-armp')
  syncArmp(): Promise<{ count: number }> {
    return this.opportunities.syncFromArmp();
  }

  /** Injecte les données de démonstration en base (idempotent — upsert). */
  @Post('opportunities/seed-demo')
  async seedDemo(): Promise<{ seeded: number }> {
    const res = await this.opportunities.upsertFromExternal(opportunitiesSeed);
    return { seeded: res.upserted };
  }

  @Get('opportunities/:id/justificatif')
  async getJustificatif(@Param('id') id: string): Promise<StreamableFile> {
    const row = await this.opportunities.getJustificatif(id);
    if (!row) {
      throw new NotFoundException('Justificatif introuvable');
    }
    return new StreamableFile(row.pdfData, {
      type: 'application/pdf',
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(row.fileName)}`,
    });
  }

  @Post('opportunities/:id/submit')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: PDF_MAX_BYTES } }),
  )
  submitWithJustificatif(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<{ id: string; status: Opportunity['status'] }> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Fichier PDF requis.');
    }
    const m = file.mimetype?.toLowerCase() ?? '';
    const nameOk = Boolean(file.originalname?.toLowerCase().endsWith('.pdf'));
    if (m !== 'application/pdf' && !nameOk) {
      throw new BadRequestException('Seuls les fichiers PDF sont acceptés.');
    }
    return this.opportunities.submitWithJustificatif(
      id,
      file.originalname?.trim() || 'justificatif.pdf',
      file.buffer,
    );
  }

  @Get('opportunities/:id')
  get(@Param('id') id: string): Promise<Opportunity> {
    return this.opportunities.get(id);
  }

  @Patch('opportunities/:id/status')
  setStatus(@Param('id') id: string, @Body() dto: UpdateOpportunityStatusDto) {
    return this.opportunities.setStatus(id, dto.status);
  }

  /**
   * Endpoint pour enrichissement (pipeline Python).
   * Le script envoie un JSON (montant exact, critères, contacts, features extraites…).
   */
  @Patch('opportunities/:id/enrich')
  enrich(@Param('id') id: string, @Body() dto: EnrichOpportunityDto) {
    return this.opportunities.enrich(id, dto);
  }

  /** Score (ou re-score) une opportunité. Mode 'api' (défaut) : API extracteur. */
  @Post('opportunities/:id/score')
  scoreOne(@Param('id') id: string): Promise<Opportunity> {
    return this.isWatcherMode()
      ? this.decisionScoring.scoreOpportunityById(id)
      : this.opportunities.scoreOneViaExtractorApi(id);
  }

  /** Score les opportunités en attente. Mode 'api' (défaut) : pipeline transitoire. */
  @Post('opportunities/score-pending')
  async scorePending(): Promise<{ scored: number; skipped: number; errors: string[] }> {
    if (this.isWatcherMode()) {
      return this.decisionScoring.scoreAllPending();
    }
    const r = await this.opportunities.processPendingViaExtractorApi({ limit: 150 });
    return { scored: r.processed, skipped: r.skipped, errors: r.errors };
  }

  /** Rattrapage : scoring des opportunités en attente (après scrape interrompu). */
  @Post('opportunities/backfill-scores')
  async backfillScores(): Promise<{
    downloaded: number;
    scored: number;
    skipped: number;
    errors: string[];
  }> {
    if (!this.isWatcherMode()) {
      const r = await this.opportunities.processPendingViaExtractorApi({ limit: 150 });
      return { downloaded: r.processed, scored: r.processed, skipped: r.skipped, errors: r.errors };
    }
    const pdf = await this.opportunities.backfillMissingPdfs({ limit: 150 });
    const score = await this.decisionScoring.scoreAllPending();
    return {
      downloaded: pdf.downloaded,
      scored: score.scored,
      skipped: score.skipped,
      errors: [...pdf.errors, ...score.errors],
    };
  }

  private isWatcherMode(): boolean {
    return (process.env.KIAMA_EXTRACTION_MODE ?? 'api').trim().toLowerCase() === 'watcher';
  }

  /**
   * Scoring déclenché par ao_extractor après extraction d'un PDF.
   * Répond 202 immédiatement et traite en arrière-plan.
   */
  @Post('opportunities/score-by-pdf')
  @HttpCode(202)
  scoreByPdf(@Body() dto: ScoreByPdfDto): { accepted: true; nomFichier: string } {
    // Fire-and-forget : on ne bloque pas ao_extractor sur le scoring asynchrone
    this.decisionScoring.scoreByNomFichier(dto.nomFichier).catch((err) => {
      this.logger.error(
        `[score-by-pdf] Échec scoring ${dto.nomFichier}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    return { accepted: true, nomFichier: dto.nomFichier };
  }

  @Get('opportunities-read')
  getReadIds() {
    return this.opportunities.getReadIds();
  }

  @Post('opportunities/:id/read')
  markRead(@Param('id') id: string) {
    return this.opportunities.markRead(id);
  }

  @Get('favorites')
  getFavorites() {
    return this.opportunities.getFavoriteIds();
  }

  @Post('favorites/:id/toggle')
  toggleFavorite(@Param('id') id: string) {
    return this.opportunities.toggleFavorite(id);
  }
}
