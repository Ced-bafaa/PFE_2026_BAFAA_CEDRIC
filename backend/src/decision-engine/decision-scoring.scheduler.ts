import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DecisionScoringService } from './decision-scoring.service';

@Injectable()
export class DecisionScoringScheduler {
  private readonly logger = new Logger(DecisionScoringScheduler.name);
  private readonly enabled: boolean;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly scoring: DecisionScoringService,
  ) {
    this.enabled = this.config.get<string>('DECISION_SCORING_AUTO', 'true') === 'true';
  }

  /**
   * Filet de secours : rejoue le scoring des extractions dont la notification
   * immédiate (POST /opportunities/score-by-pdf) a échoué — backend éteint au
   * moment du dépôt, erreur réseau, etc.
   * ACTIVÉ par défaut ; se désactive avec DECISION_SCORING_AUTO=false.
   * Le chemin nominal reste la notification immédiate du watcher : ce cron ne
   * fait que ramasser les restes, d'où une cadence de 5 minutes suffisante.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleCron(): Promise<void> {
    if (!this.enabled || this.running) return;
    this.running = true;
    try {
      const result = await this.scoring.scorePendingFromExtractor();
      if (result.scored > 0) {
        this.logger.log(
          `Scoring auto: ${result.scored} opportunité(s), ${result.skipped} ignorée(s)`,
        );
      }
      if (result.errors.length > 0) {
        this.logger.warn(`Scoring auto erreurs: ${result.errors.join('; ')}`);
      }
    } catch (err) {
      this.logger.warn(`Scoring auto: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
