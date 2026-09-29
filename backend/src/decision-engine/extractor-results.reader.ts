import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export type ExtractorResultEntry = Record<string, unknown> & {
  nom_fichier?: string;
  administratif?: Record<string, unknown>;
  financier?: Record<string, unknown>;
  technique?: Record<string, unknown>;
};

@Injectable()
export class ExtractorResultsReader {
  private readonly logger = new Logger(ExtractorResultsReader.name);
  private readonly resultatsPath: string;

  constructor(private readonly config: ConfigService) {
    const explicit = this.config.get<string>('AO_EXTRACTOR_RESULTATS_PATH');
    if (explicit?.trim()) {
      this.resultatsPath = path.resolve(explicit.trim());
    } else {
      const base =
        this.config.get<string>('AO_EXTRACTOR_OUTPUT_DIR') ??
        path.resolve(process.cwd(), '..', 'ao_extractor', 'output');
      this.resultatsPath = path.join(base, 'resultats.json');
    }
  }

  getResultatsPath(): string {
    return this.resultatsPath;
  }

  async loadAll(): Promise<ExtractorResultEntry[]> {
    try {
      const raw = await fs.readFile(this.resultatsPath, 'utf-8');
      const data = JSON.parse(raw) as unknown;
      if (Array.isArray(data)) return data as ExtractorResultEntry[];
      if (data && typeof data === 'object') return [data as ExtractorResultEntry];
      return [];
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return [];
      this.logger.warn(`Lecture ${this.resultatsPath}: ${(err as Error).message}`);
      return [];
    }
  }

  /** Index nom_fichier (minuscule) → entrée extracteur */
  async loadByFileName(): Promise<Map<string, ExtractorResultEntry>> {
    const entries = await this.loadAll();
    const map = new Map<string, ExtractorResultEntry>();
    for (const entry of entries) {
      const name = String(entry.nom_fichier ?? '').trim().toLowerCase();
      if (!name) continue;
      map.set(name, entry);
    }
    return map;
  }

  toDaoPayload(entry: ExtractorResultEntry): Record<string, unknown> {
    const { nom_fichier: _n, ...rest } = entry;
    const personnelStruct = (rest as Record<string, unknown>)['personnel_cle_struct'];
    return {
      administratif: rest.administratif ?? {},
      financier: rest.financier ?? {},
      ...(rest.technique ? { technique: rest.technique } : {}),
      ...(rest.meta ? { meta: rest.meta } : {}),
      // Exigences de personnel extraites du DAO — consommées par la
      // qualification déterministe du decision engine (evaluate_eligibility).
      ...(Array.isArray(personnelStruct) ? { personnel_cle_struct: personnelStruct } : {}),
    };
  }
}
