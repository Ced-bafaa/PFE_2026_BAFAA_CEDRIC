export type SourceItem = {
  id: string;
  title: string;
  url: string;
  active: boolean;
  keywords: string[];
  collectionMode?: 'rss' | 'scrape';
};

export type SourcesSettings = {
  globalKeywords: string[];
  sources: SourceItem[];

  /** Profil entreprise — repris dans company_profile.json (description). */
  companyDescription?: string;
  /** Domaines d'expertise de l'entreprise (liste libre). */
  companyDomains?: string[];
};
