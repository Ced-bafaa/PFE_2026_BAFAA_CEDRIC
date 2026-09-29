export type CollectedItem = {
  title: string;
  url: string;
  publishedAt?: string;
  summary?: string;
};

export type SourceCollectResult = {
  sourceId: string;
  sourceTitle: string;
  sourceUrl: string;
  mode: 'rss' | 'scrape';
  ok: boolean;
  error?: string;
  items: CollectedItem[];
  /** Nombre d'opportunités persistées en DB pour cette source (si mode scrape). */
  storedCount?: number;
  /** Indique que le scraping a été écourté (timeout / retour partiel). */
  partial?: boolean;
};
