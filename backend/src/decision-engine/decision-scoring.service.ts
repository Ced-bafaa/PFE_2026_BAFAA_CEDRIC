import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Opportunity } from '../seed/mock-data';
import { OpportunityEntity } from '../opportunities/entities/opportunity.entity';
import { entityToOpportunity } from '../opportunities/opportunity-persistence.mapper';
import {
  applyDecisionToPublicOpportunity,
  decisionToRecommendation,
  decisionToScore,
  getDecisionFromEnrichment,
} from '../opportunities/opportunity-decision.util';
import { toPublicOpportunityDetail } from '../opportunities/opportunity-public.util';
import { DecisionEngineClient } from './decision-engine.client';
import {
  ExtractorResultsReader,
  type ExtractorResultEntry,
} from './extractor-results.reader';
import type { OpportunityDecision } from './decision-engine.types';
import { PartnersService } from '../partners/partners.service';

@Injectable()
export class DecisionScoringService {
  private readonly logger = new Logger(DecisionScoringService.name);

  constructor(
    private readonly decisionClient: DecisionEngineClient,
    private readonly extractorReader: ExtractorResultsReader,
    private readonly partnersService: PartnersService,
    @InjectRepository(OpportunityEntity)
    private readonly opportunityRepo: Repository<OpportunityEntity>,
  ) {}

  /** Charge les partenaires (profils complets) transmis au moteur pour la reco de groupement. */
  private async loadPartners(): Promise<Array<Record<string, unknown>>> {
    try {
      return (await this.partnersService.list()) as unknown as Array<Record<string, unknown>>;
    } catch {
      return [];
    }
  }

  private pdfCandidates(opportunity: OpportunityEntity): string[] {
    const names: string[] = [];
    if (opportunity.internalFileId?.trim()) {
      const id = opportunity.internalFileId.trim();
      names.push(`${id}.pdf`, id.toLowerCase().endsWith('.pdf') ? id : `${id}.pdf`);
    }
    names.push(`${opportunity.id}.pdf`);
    return [...new Set(names.map((n) => n.toLowerCase()))];
  }

  findExtractorEntry(
    opportunity: OpportunityEntity,
    byFile: Map<string, ExtractorResultEntry>,
  ): ExtractorResultEntry | null {
    for (const candidate of this.pdfCandidates(opportunity)) {
      const hit = byFile.get(candidate);
      if (hit) return hit;
    }
    return null;
  }

  private stemFromNomFichier(nomFichier: string): string {
    return String(nomFichier ?? '')
      .trim()
      .toLowerCase()
      .replace(/\.pdf$/i, '');
  }

  private isUuidStem(stem: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      stem,
    );
  }

  private normalizeForMatch(text: string): string {
    return String(text ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private titleOverlapScore(a: string, b: string): number {
    const wa = new Set(
      this.normalizeForMatch(a)
        .split(' ')
        .filter((w) => w.length > 3),
    );
    const wb = new Set(
      this.normalizeForMatch(b)
        .split(' ')
        .filter((w) => w.length > 3),
    );
    if (wa.size === 0 || wb.size === 0) return 0;
    let inter = 0;
    for (const w of wa) {
      if (wb.has(w)) inter += 1;
    }
    return inter / Math.max(wa.size, wb.size);
  }

  /**
   * Associe un PDF extrait à une opportunité :
   * internalFileId / id / nom armp-*.pdf / similarité titre.
   */
  findEntityForPdf(
    nomFichier: string,
    entry: ExtractorResultEntry,
    entities: OpportunityEntity[],
  ): { entity: OpportunityEntity; matchedBy: string } | null {
    const key = String(nomFichier ?? '').trim().toLowerCase();
    const stem = this.stemFromNomFichier(key);

    for (const e of entities) {
      if (this.pdfCandidates(e).includes(key)) return { entity: e, matchedBy: 'filename' };
    }

    const byId = entities.find((e) => e.id.toLowerCase() === stem);
    if (byId) return { entity: byId, matchedBy: 'id' };

    const byStable = entities.find(
      (e) => (e.stableId ?? '').toLowerCase() === stem,
    );
    if (byStable) return { entity: byStable, matchedBy: 'stableId' };

    const adm = entry.administratif as Record<string, unknown> | undefined;
    const ref = String(adm?.reference ?? '').trim();
    const objet = String(adm?.objet ?? '').slice(0, 500).trim();
    const corpus = `${ref} ${objet}`.trim();
    if (corpus.length < 12) return null;

    // Dernier recours : similarité de titres. Règles de prudence :
    //  - seuil élevé (un faux rattachement ne se détecte jamais, un « skipped »
    //    est rattrapé par le cron de 5 minutes)
    //  - marge nette exigée sur le 2e meilleur candidat (ambiguïté → refus)
    const FUZZY_MIN_SCORE = 0.55;
    const FUZZY_MIN_MARGIN = 0.15;

    let best: OpportunityEntity | null = null;
    let bestScore = 0;
    let secondScore = 0;
    for (const e of entities) {
      const score = Math.max(
        this.titleOverlapScore(corpus, e.title),
        ref ? this.titleOverlapScore(ref, e.title) : 0,
      );
      if (score > bestScore) {
        secondScore = bestScore;
        bestScore = score;
        best = e;
      } else if (score > secondScore) {
        secondScore = score;
      }
    }

    if (best && bestScore >= FUZZY_MIN_SCORE && bestScore - secondScore >= FUZZY_MIN_MARGIN) {
      this.logger.log(
        `Lien PDF ${nomFichier} → opportunité ${best.id} (similarité ${(bestScore * 100).toFixed(0)}%, marge ${((bestScore - secondScore) * 100).toFixed(0)}%)`,
      );
      return { entity: best, matchedBy: `fuzzy(${bestScore.toFixed(2)})` };
    }

    if (best) {
      this.logger.warn(
        `PDF ${nomFichier} non rattaché : similarité insuffisante ou ambiguë ` +
          `(meilleur ${(bestScore * 100).toFixed(0)}%, 2e ${(secondScore * 100).toFixed(0)}%).`,
      );
    }
    return null;
  }

  private backfillInternalFileId(
    entity: OpportunityEntity,
    nomFichier: string,
  ): void {
    const stem = this.stemFromNomFichier(nomFichier);
    if (!stem) return;
    if (this.isUuidStem(stem) && !entity.internalFileId?.trim()) {
      entity.internalFileId = stem;
    }
  }

  buildDecisionPayload(
    result: Awaited<ReturnType<DecisionEngineClient['predict']>>,
    nomFichier?: string,
    matchedBy?: string,
  ): OpportunityDecision {
    return {
      ...(matchedBy ? { matchedBy } : {}),
      verdict: result.verdict,
      prediction_final: result.prediction_final ?? result.prediction,
      scoreGlobal: result.fusion?.score_global,
      qualitative: result.qualitative ?? null,
      fusion: result.fusion ?? null,
      eligibility: result.eligibility ?? null,
      prediction: result.prediction,
      confidenceGoPct: result.confidence_go_pct,
      features: result.features,
      shapContributions: result.shap_contributions ?? null,
      budgetFcfa: result.budget_fcfa,
      cautionFcfa: result.caution_fcfa,
      ruleLabel: result.rule_label,
      mcda: result.mcda ?? null,
      recommendedExperts: result.recommended_experts ?? null,
      recommendedPartners: result.recommended_partners ?? null,
      scoredAt: new Date().toISOString(),
      ...(nomFichier ? { nomFichier } : {}),
    };
  }

  async scoreByNomFichier(nomFichier: string): Promise<Opportunity> {
    const key = String(nomFichier ?? '').trim().toLowerCase();
    if (!key) {
      throw new NotFoundException('nomFichier requis');
    }

    const byFile = await this.extractorReader.loadByFileName();
    const entry = byFile.get(key);
    if (!entry) {
      throw new NotFoundException(
        `Aucune extraction pour le fichier ${nomFichier} dans resultats.json`,
      );
    }

    const entities = await this.opportunityRepo.find();
    const match = this.findEntityForPdf(nomFichier, entry, entities);
    if (!match) {
      throw new NotFoundException(
        `Aucune opportunité liée au PDF ${nomFichier}. Vérifiez que le marché est bien en base (sync ARMP).`,
      );
    }

    return this.scoreWithExtractorEntry(match.entity, entry, match.matchedBy);
  }

  async scoreOpportunityById(id: string): Promise<Opportunity> {
    const oid = id.trim();
    const entity = await this.opportunityRepo.findOne({ where: { id: oid } });
    if (!entity) throw new NotFoundException('Opportunity not found');

    const byFile = await this.extractorReader.loadByFileName();
    const entry = this.findExtractorEntry(entity, byFile);
    if (!entry) {
      throw new NotFoundException(
        `Aucune extraction trouvée pour l'opportunité ${oid} (PDF attendu: ${this.pdfCandidates(entity).join(', ')})`,
      );
    }

    return this.scoreWithExtractorEntry(entity, entry);
  }

  async scoreWithExtractorEntry(
    entity: OpportunityEntity,
    entry: ExtractorResultEntry,
    matchedBy = 'direct',
  ): Promise<Opportunity> {
    const dao = this.extractorReader.toDaoPayload(entry);
    const partners = await this.loadPartners();
    const prediction = await this.decisionClient.predict(dao, undefined, false, partners);
    const nomFichier = String(entry.nom_fichier ?? '');
    const decision = this.buildDecisionPayload(prediction, nomFichier, matchedBy);

    this.backfillInternalFileId(entity, nomFichier);
    return this.persistScoredDecision(entity, dao, decision);
  }

  /**
   * Option 2 — scoring direct à partir d'un DAO déjà extrait (renvoyé par
   * l'API extracteur), sans passer par resultats.json. L'opportunité est connue
   * de l'appelant : aucun rattachement n'est nécessaire.
   */
  async scoreOpportunityFromDao(
    entity: OpportunityEntity,
    dao: Record<string, unknown>,
    matchedBy = 'api',
  ): Promise<Opportunity> {
    const partners = await this.loadPartners();
    const prediction = await this.decisionClient.predict(dao, undefined, false, partners);
    const decision = this.buildDecisionPayload(prediction, undefined, matchedBy);
    return this.persistScoredDecision(entity, dao, decision);
  }

  private async persistScoredDecision(
    entity: OpportunityEntity,
    dao: Record<string, unknown>,
    decision: OpportunityDecision,
  ): Promise<Opportunity> {
    const budgetLabel = `${decision.budgetFcfa.toLocaleString('fr-FR')} FCFA`;
    const nextEnrichment = {
      ...(entity.enrichment ?? {}),
      extractor: dao,
      decision,
    };

    entity.enrichment = nextEnrichment;
    entity.score = decisionToScore(decision);
    entity.recommendation = decisionToRecommendation(decision);
    if (decision.budgetFcfa > 0) {
      entity.budget = budgetLabel;
    }

    await this.opportunityRepo.save(entity);
    this.logger.log(
      `Scored ${entity.id}: ${decision.verdict} (${decision.confidenceGoPct}%)`,
    );

    const opp = entityToOpportunity(entity);
    return toPublicOpportunityDetail(applyDecisionToPublicOpportunity(opp));
  }

  /** Score les opportunités du catalogue qui ont une extraction mais pas encore de décision. */
  async scoreUnscoredInCatalog(): Promise<{
    scored: number;
    skipped: number;
    errors: string[];
  }> {
    const byFile = await this.extractorReader.loadByFileName();
    const entities = await this.opportunityRepo.find();
    let scored = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const entity of entities) {
      if (getDecisionFromEnrichment(entity.enrichment as Record<string, unknown>)) {
        skipped += 1;
        continue;
      }
      const entry = this.findExtractorEntry(entity, byFile);
      if (!entry) {
        skipped += 1;
        continue;
      }
      try {
        await this.scoreWithExtractorEntry(entity, entry);
        scored += 1;
      } catch (err) {
        errors.push(`${entity.id}: ${(err as Error).message}`);
      }
    }

    if (scored > 0) {
      this.logger.log(`Catalogue: ${scored} opportunité(s) scorée(s)`);
    }
    return { scored, skipped, errors };
  }

  async scorePendingFromExtractor(): Promise<{
    scored: number;
    skipped: number;
    errors: string[];
  }> {
    const byFile = await this.extractorReader.loadByFileName();
    if (byFile.size === 0) {
      return { scored: 0, skipped: 0, errors: [] };
    }

    const entities = await this.opportunityRepo.find();
    let scored = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const [key, entry] of byFile) {
      const nom = String(entry.nom_fichier ?? key);
      const match = this.findEntityForPdf(nom, entry, entities);
      if (!match) {
        skipped += 1;
        continue;
      }
      const entity = match.entity;

      const existing = (entity.enrichment as Record<string, unknown> | null)?.decision as
        | OpportunityDecision
        | undefined;
      if (
        existing?.nomFichier?.toLowerCase() === nom.toLowerCase() &&
        existing?.scoredAt
      ) {
        skipped += 1;
        continue;
      }

      try {
        await this.scoreWithExtractorEntry(entity, entry, match.matchedBy);
        scored += 1;
      } catch (err) {
        errors.push(`${nom}: ${(err as Error).message}`);
      }
    }

    return { scored, skipped, errors };
  }

  /** Rattrapage complet : catalogue sans score + entrées extracteur restantes. */
  async scoreAllPending(): Promise<{
    scored: number;
    skipped: number;
    errors: string[];
  }> {
    const catalog = await this.scoreUnscoredInCatalog();
    const files = await this.scorePendingFromExtractor();
    return {
      scored: catalog.scored + files.scored,
      skipped: catalog.skipped + files.skipped,
      errors: [...catalog.errors, ...files.errors],
    };
  }

}
