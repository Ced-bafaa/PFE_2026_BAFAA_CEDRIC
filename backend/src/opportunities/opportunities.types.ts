import type { Opportunity } from '../seed/mock-data';

export type OpportunityStatus = Opportunity['status'];

export type OpportunityStatusMap = Record<string, OpportunityStatus>;
