import type { Opportunity } from '../seed/mock-data';
import { OpportunityEntity } from './entities/opportunity.entity';

export function opportunityToEntity(o: Opportunity): OpportunityEntity {
  const e = new OpportunityEntity();
  e.id = o.id;
  e.stableId = o.stableId ?? null;
  e.title = o.title;
  e.source = o.source;
  e.publishedAt = o.publishedAt;
  e.scrapedAt = o.scrapedAt ?? null;
  e.deadline = o.deadline;
  e.budget = o.budget;
  e.location = o.location;
  e.domain = o.domain;
  e.score = o.score;
  e.recommendation = o.recommendation;
  e.status = o.status;
  e.description = o.description;
  e.internalFileId = o.internalFileId ?? null;
  e.enrichment = (o as any).enrichment ?? null;
  return e;
}

export function entityToOpportunity(
  e: OpportunityEntity,
  statusOverride?: string | null,
  justificatifFileName?: string | null,
): Opportunity {
  return {
    id: e.id,
    ...(e.stableId ? { stableId: e.stableId } : {}),
    title: e.title,
    source: e.source,
    publishedAt: e.publishedAt,
    ...(e.scrapedAt ? { scrapedAt: e.scrapedAt } : {}),
    deadline: e.deadline,
    budget: e.budget,
    location: e.location,
    domain: e.domain,
    score: e.score,
    recommendation: e.recommendation as Opportunity['recommendation'],
    status: (statusOverride ?? e.status) as Opportunity['status'],
    description: e.description,
    justificatifFileName: justificatifFileName ?? null,
    ...(e.internalFileId ? { internalFileId: e.internalFileId } : {}),
    ...(e.enrichment ? ({ enrichment: e.enrichment } as any) : {}),
  };
}
