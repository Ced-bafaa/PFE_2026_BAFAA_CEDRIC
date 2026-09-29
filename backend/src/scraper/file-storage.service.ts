import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { v4 as uuidv4 } from 'uuid';

import { PlaywrightScraperService } from './playwright-scraper.service';
import { resolveExtractionRawPdfDir } from './extraction-raw-path';

/**
 * URL susceptible de renvoyer un PDF : suffixe .pdf OU scripts de téléchargement
 * (ex. ARMP `0903_publications_dl` — souvent .php sans ".pdf" dans le chemin).
 */
function looksLikePdfDownloadUrl(raw: string): boolean {
  const s = String(raw ?? '').trim();
  if (!s) return false;
  const lower = s.toLowerCase();
  let pathname = '';
  try {
    pathname = new URL(s).pathname.toLowerCase();
  } catch {
    pathname = lower.split('?')[0];
  }
  if (pathname.endsWith('.pdf')) return true;
  if (lower.includes('0903_publications_dl')) return true;
  if (lower.includes('publications_dl')) return true;
  return false;
}

/** Résout un href relatif (ex. /0903_...) grâce à detailUrl ou à la source. */
export function resolveTenderAssetUrl(
  link: string,
  tender: { detailUrl?: string; downloadLink?: string; source?: string },
): string {
  const s = String(link ?? '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  const base =
    String(tender.detailUrl ?? '').trim() ||
    String(tender.downloadLink ?? '').trim();
  try {
    if (base) return new URL(s, base).toString();
  } catch {
    /* ignore */
  }
  const host = String(tender.source ?? '')
    .trim()
    .replace(/^www\./i, '');
  if (host && !/\s/.test(host) && host.includes('.')) {
    try {
      return new URL(s, `https://${host}/`).toString();
    } catch {
      /* ignore */
    }
  }
  return s;
}

@Injectable()
export class FileStorageService {
  private readonly logger = new Logger(FileStorageService.name);

  constructor(private readonly playwrightPdf: PlaywrightScraperService) {}

  /**
   * Télécharge un PDF dans `ao_extractor/data/<uuid>.pdf` (aligné pipeline extraction/scoring).
   */
  async downloadPdfIfNeeded(opts: {
    opportunityId: string;
    url?: string | null;
    kind?: 'downloadLink' | 'detailUrl' | 'unknown';
  }): Promise<{ saved: boolean; internalFileId?: string; filePath?: string }> {
    const url = String(opts.url ?? '').trim();
    if (!looksLikePdfDownloadUrl(url)) return { saved: false };

    const dir = resolveExtractionRawPdfDir();
    await fs.mkdir(dir, { recursive: true });

    const uuid = uuidv4();
    const filePath = path.join(dir, `${uuid}.pdf`);

    try {
      const buf = await this.playwrightPdf.fetchPdfBufferPreferringBrowser(url, {
        timeoutMs: 60_000,
        userAgent:
          process.env.ARMP_USER_AGENT ||
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      });

      await fs.writeFile(filePath, buf);
      this.logger.debug(
        `PDF téléchargé internalFileId=${uuid} (${buf.length} octets, ${opts.kind ?? 'unknown'}) -> ${filePath}`,
      );
      return { saved: true, internalFileId: uuid, filePath };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Téléchargement PDF échoué (${url}) — ${msg}`);
      return { saved: false };
    }
  }
}

