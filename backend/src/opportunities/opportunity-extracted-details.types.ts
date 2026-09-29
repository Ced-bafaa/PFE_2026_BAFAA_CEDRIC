/** Section textuelle extraite du PDF (DAO). */
export type ExtractedSectionDto = {
  key: string;
  label: string;
  found: boolean;
  excerpt?: string;
};

export type OpportunityExtractedDetailsDto = {
  /** ISO — date du dernier scoring lié à cette extraction. */
  extractedAt?: string;
  administrative: {
    reference?: string;
    procedureType?: string;
    authority?: string;
    subject?: string;
    financing?: string;
    contacts?: { emails: string[]; phones: string[] };
    dates?: {
      remiseOffres?: string;
      ouverturePlis?: string;
      remiseOffresIso?: string[];
      ouverturePlisIso?: string[];
    };
    sections: ExtractedSectionDto[];
  };
  financial: {
    budgetGlobal?: string;
    cautionGlobal?: string;
    allotissementCount?: number;
    lotsDetected?: number;
    delaiGlobal?: string;
    lots?: Array<Record<string, unknown>>;
  };
  technical: {
    keywords: string[];
    baremePoints: Array<Record<string, unknown>>;
    sections: ExtractedSectionDto[];
  };
  meta?: {
    pages?: number;
    ocrUsed?: boolean;
    sectionsFound?: Record<string, boolean>;
  };
};
