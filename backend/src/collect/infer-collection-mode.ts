import { CollectionMode } from './dto/source-item.dto';

const RSS_HINTS = [
  '/rss',
  '/feed',
  '/atom',
  'rss.xml',
  'feed.xml',
  'atom.xml',
  '.xml',
  'format=rss',
  'format=xml',
];

/**
 * Heuristique : flux RSS/Atom probable vs page HTML à scraper.
 */
export function inferCollectionMode(url: string): CollectionMode {
  const lower = url.toLowerCase();
  for (const hint of RSS_HINTS) {
    if (lower.includes(hint)) return CollectionMode.RSS;
  }
  return CollectionMode.SCRAPE;
}
