import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';

/**
 * Client HTTP vers le service d'extraction (ao_extractor/api_extractor.py).
 *
 * Option 2 — PDF transitoire : au lieu de déposer le PDF dans un dossier
 * partagé surveillé par un watcher, le backend envoie les octets du PDF +
 * l'identifiant de l'opportunité, et reçoit en retour le JSON structuré du DAO
 * (administratif / financier / technique / personnel_cle_struct). Le PDF n'est
 * persisté ni ici ni côté extracteur.
 */
@Injectable()
export class ExtractorApiClient {
  private readonly logger = new Logger(ExtractorApiClient.name);
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = (
      this.config.get<string>('AO_EXTRACTOR_URL') ?? 'http://localhost:8770'
    ).replace(/\/$/, '');
  }

  async health(): Promise<{ status: string; version: string }> {
    const { data } = await axios.get(`${this.baseUrl}/health`, { timeout: 5000 });
    return data as { status: string; version: string };
  }

  /**
   * Extrait un DAO à partir des octets d'un PDF.
   * @param opportunityId  identifiant de l'opportunité (corrélation, supprime tout rattachement après coup)
   * @param pdf            contenu binaire du PDF
   * @returns              le JSON d'extraction (champ `extraction` de la réponse)
   */
  async extract(
    opportunityId: string,
    pdf: Buffer,
  ): Promise<Record<string, unknown>> {
    const id = String(opportunityId ?? '').trim();
    if (!id) throw new Error('opportunityId requis pour /extract');
    if (!pdf || pdf.length === 0) throw new Error('PDF vide pour /extract');

    try {
      const { data } = await axios.post<{
        opportunity_id: string;
        extraction: Record<string, unknown>;
      }>(`${this.baseUrl}/extract`, pdf, {
        params: { opportunity_id: id },
        headers: { 'Content-Type': 'application/pdf' },
        // OCR possible : on laisse une marge confortable.
        timeout: 120_000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
      return data.extraction ?? {};
    } catch (err) {
      const ax = err as AxiosError<{ detail?: string }>;
      const detail =
        ax.response?.data?.detail ?? ax.message ?? 'Erreur extracteur';
      this.logger.warn(`POST /extract (${id}) échoué : ${detail}`);
      throw new Error(detail);
    }
  }
}
