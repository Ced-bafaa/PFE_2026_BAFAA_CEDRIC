import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ensureFileExists } from '../storage/ensure-file';
import { JsonStore } from '../storage/json-store';
import { sourcesSettingsSeed } from './sources.seed';
import type { SourcesSettings } from './sources.types';

const COMPANY_PROFILE_PATH =
  process.env.COMPANY_PROFILE_PATH ??
  path.resolve(process.cwd(), '..', 'decision_engine', 'data', 'company_profile.json');

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  private readonly sourcesStore = new JsonStore<SourcesSettings>({
    fileName: 'sources-settings.json',
    defaultValue: sourcesSettingsSeed,
  });

  constructor() {}

  getSourcesSettingsPath(): string {
    return this.sourcesStore.getPath();
  }

  private async ensureSeeded(): Promise<void> {
    await ensureFileExists(
      this.sourcesStore.getPath(),
      JSON.stringify(sourcesSettingsSeed, null, 2),
    );
  }

  async getSourcesSettings(): Promise<SourcesSettings> {
    await this.ensureSeeded();
    return await this.sourcesStore.read();
  }

  async setSourcesSettings(next: SourcesSettings): Promise<SourcesSettings> {
    await this.ensureSeeded();
    await this.sourcesStore.write(next);
    if (next.companyDescription !== undefined) {
      await this.syncCompanyProfile(next.companyDescription);
    }
    return next;
  }

  async getCompanyProfile(): Promise<Record<string, unknown>> {
    try {
      const raw = await fs.readFile(COMPANY_PROFILE_PATH, 'utf-8');
      // Tolérance aux octets nuls résiduels (corruption d'écriture passée)
      return JSON.parse(raw.replace(/\u0000+/g, '')) as Record<string, unknown>;
    } catch (err) {
      this.logger.warn(
        `[Settings] Lecture company_profile.json impossible : ${(err as Error).message}`,
      );
      return {};
    }
  }

  async setCompanyProfile(dto: Record<string, unknown>): Promise<Record<string, unknown>> {
    let existing: Record<string, unknown> = {};
    try {
      const raw = await fs.readFile(COMPANY_PROFILE_PATH, 'utf-8');
      // Octets nuls résiduels possibles après une corruption d'écriture :
      // on les retire avant parsing plutôt que de perdre le contenu.
      existing = JSON.parse(raw.replace(/\u0000+/g, '')) as Record<string, unknown>;
    } catch (err) {
      // GARDE-FOU : si le fichier existe mais est illisible, fusionner sur {}
      // détruirait silencieusement tout ce que le payload ne contient pas
      // (c'est ainsi que le personnel a été perdu). On refuse la sauvegarde.
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') {
        this.logger.error(
          `[Settings] company_profile.json illisible (${(err as Error).message}) — sauvegarde refusée pour éviter une perte de données.`,
        );
        throw new Error(
          'Profil entreprise illisible sur le disque : sauvegarde annulée pour éviter une perte de données. Restaurez le fichier puis réessayez.',
        );
      }
      // ENOENT : premier démarrage, fichier absent — on part de zéro légitimement.
    }

    const merged = { ...existing, ...dto };

    // Dériver past_projects_keywords automatiquement depuis les données structurées
    const keywords = new Set<string>();

    type WithKeywords = { keywords?: string[] };
    type WithTechDomains = { technologies?: string[]; domains?: string[] };
    type WithSkills = { skills?: string[] };

    const competencies = (merged['competencies'] as Array<WithKeywords> | undefined) ?? [];
    for (const c of competencies) {
      for (const kw of (c.keywords ?? [])) keywords.add(kw.toLowerCase());
    }

    const pastProjects = (merged['past_projects'] as Array<WithTechDomains> | undefined) ?? [];
    for (const p of pastProjects) {
      for (const t of (p.technologies ?? [])) keywords.add(t.toLowerCase());
      for (const d of (p.domains ?? [])) keywords.add(d.toLowerCase());
    }

    const personnel = (merged['personnel'] as Array<WithSkills> | undefined) ?? [];
    for (const m of personnel) {
      for (const s of (m.skills ?? [])) keywords.add(s.toLowerCase());
    }

    const domaines = (merged['domaines'] as string[] | undefined) ?? [];
    for (const d of domaines) keywords.add(d.toLowerCase());

    if (keywords.size > 0) {
      merged['past_projects_keywords'] = Array.from(keywords);
    }

    await fs.writeFile(COMPANY_PROFILE_PATH, JSON.stringify(merged, null, 2), 'utf-8');
    this.logger.log('[Settings] company_profile.json sauvegardé.');

    return merged;
  }

  private async syncCompanyProfile(description?: string): Promise<void> {
    try {
      const raw = await fs.readFile(COMPANY_PROFILE_PATH, 'utf-8');
      const profile = JSON.parse(raw) as Record<string, unknown>;

      if (description !== undefined && description.trim()) {
        profile['description'] = description.trim();
      }
      // NOTE : l'écriture d'it_keywords a été retirée — plus aucun consommateur
      // depuis l'abandon du filtre de pertinence côté decision engine (le filtrage
      // par mots-clés se fait dans le backend via globalKeywords/sources-settings).

      await fs.writeFile(COMPANY_PROFILE_PATH, JSON.stringify(profile, null, 2), 'utf-8');
      this.logger.log('[Settings] company_profile.json mis a jour (description).');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[Settings] Synchronisation company_profile.json echouee : ${msg}`);
    }
  }
}
