import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { v4 as uuidv4 } from 'uuid';

import { resolveExtractionRawPdfDir } from './extraction-raw-path';
import { PlaywrightScraperService } from './playwright-scraper.service';

const DEFAULT_TIMEOUT_MS = 45_000;

@Injectable()
export class DownloadService {
  private readonly logger = new Logger(DownloadService.name);

  constructor(private readonly playwrightPdf: PlaywrightScraperService) {}

  /**
   * API "pipeline" : télécharge et stocke un PDF dans `ao_extractor/data/`
   * en le renommant `<uuid>.pdf`.
   */
  async downloadAndStorePdf(
    downloadLink: string,
  ): Promise<{ uuid: string; filePath: string }> {
    return this.downloadPdf(downloadLink);
  }

  /**
   * Option 2 — récupère les octets d'un PDF en mémoire, SANS écriture disque.
   * Utilisé par le pipeline « PDF transitoire » (envoi direct à l'API extracteur).
   */
  async fetchPdfBytes(downloadLink: string): Promise<Buffer> {
    const url = String(downloadLink ?? '').trim();
    if (!url) throw new Error('downloadLink vide');
    if (!/^https?:\/\//i.test(url)) throw new Error(`downloadLink invalide: ${url}`);
    return this.playwrightPdf.fetchPdfBufferPreferringBrowser(url, {
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  }

  async downloadPdf(downloadLink: string): Promise<{ uuid: string; filePath: string }> {
    const url = String(downloadLink ?? '').trim();
    if (!url) throw new Error('downloadLink vide');
    if (!/^https?:\/\//i.test(url)) throw new Error(`downloadLink invalide: ${url}`);

    const uuid = uuidv4();
    const dir = resolveExtractionRawPdfDir();
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${uuid}.pdf`);

    const buf = await this.playwrightPdf.fetchPdfBufferPreferringBrowser(url, {
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });

    await fs.writeFile(filePath, buf);
    this.logger.debug(
      `PDF téléchargé internalFileId=${uuid} (${buf.length} octets) → ${filePath}`,
    );
    return { uuid, filePath };
  }
}

