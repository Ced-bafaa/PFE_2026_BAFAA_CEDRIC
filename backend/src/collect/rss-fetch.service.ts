import { Injectable, Logger } from '@nestjs/common';
import Parser from 'rss-parser';
import type { CollectedItem } from './types/collected-item';

const USER_AGENT = 'KIAMA-Veille/1.0 (RSS; +https://kiama.cm)';
const FETCH_TIMEOUT_MS = 25_000;

@Injectable()
export class RssFetchService {
  private readonly logger = new Logger(RssFetchService.name);

  async fetchFeed(feedUrl: string): Promise<CollectedItem[]> {
    const parser = new Parser({
      timeout: FETCH_TIMEOUT_MS,
      headers: { 'User-Agent': USER_AGENT },
    });

    try {
      const feed = await parser.parseURL(feedUrl);
      const items: CollectedItem[] = [];
      for (const entry of feed.items ?? []) {
        const link = entry.link ?? entry.guid;
        if (!link || typeof link !== 'string') continue;
        items.push({
          title: (entry.title ?? link).trim() || link,
          url: link.trim(),
          publishedAt: entry.pubDate ?? entry.isoDate,
          summary: entry.contentSnippet ?? entry.summary,
        });
      }
      return items;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`RSS parse failed for ${feedUrl}: ${message}`);
      throw err;
    }
  }
}
