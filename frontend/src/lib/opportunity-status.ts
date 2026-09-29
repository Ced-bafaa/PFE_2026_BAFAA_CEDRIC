import type { Opportunity } from "@/lib/types";
import { patchOpportunityStatus } from "./opportunities-api";

export type OpportunityStatus = Opportunity["status"];

export async function setOpportunityStatus(
  id: string,
  status: OpportunityStatus,
): Promise<void> {
  await patchOpportunityStatus(id, status);
}
