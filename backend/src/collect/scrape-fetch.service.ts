import { Injectable, Logger } from '@nestjs/common';
import { load } from 'cheerio';
import type { CollectedItem } from './types/collected-item';

const USER_AGENT = 'KIAMA-Veille/1.0 (HTML; +https://kiama.cm)';
const FETCH_TIMEOUT_MS = 25_000;
const MAX_LINKS = 200;

@Injectable()
export class ScrapeFetchService {
  private readonly logger = new Logger(ScrapeFetchService.name);

  async fetchLinks(pageUrl: string): Promise<CollectedItem[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(pageUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'fr,fr-FR;q=0.9,en;q=0.5',
        },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const html = await res.text();
      const $ = load(html);
      const base = new URL(pageUrl);
      const seen = new Set<string>();
      const out: CollectedItem[] = [];

      $('a[href]').each((_, el) => {
        if (out.length >= MAX_LINKS) return false;
        const href = $(el).attr('href')?.trim();
        if (!href || href.startsWith('#') || href.startsWith('javascript:'))
          return;
        let absolute: string;
        try {
          absolute = new URL(href, base).href;
        } catch {
          return;
        }
        if (!/^https?:\/\//i.test(absolute)) return;
        const norm = absolute.split('#')[0];
        if (seen.has(norm)) return;
        seen.add(norm);
        const text = $(el).text().replace(/\s+/g, ' ').trim();
        out.push({
          title: text || norm,
          url: norm,
        });
        return;
      });

      return out;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Scrape failed for ${pageUrl}: ${message}`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
