import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import type { DecisionEnginePredictResult } from './decision-engine.types';

@Injectable()
export class DecisionEngineClient {
  private readonly logger = new Logger(DecisionEngineClient.name);
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = (
      this.config.get<string>('DECISION_ENGINE_URL') ?? 'http://localhost:8765'
    ).replace(/\/$/, '');
  }

  async health(): Promise<{ status: string; model_exists: boolean; shap_ready: boolean; groq_available: boolean }> {
    const { data } = await axios.get(`${this.baseUrl}/health`, { timeout: 5000 });
    return data;
  }

  /**
   * Lance l'inférence GO/NO-GO sur un DAO.
   * @param dao              JSON extrait du DAO
   * @param companyProfile   Profil entreprise (optionnel, sinon company_profile.json côté Python)
   * @param skipQualitative  Si true, saute l'analyse Groq (plus rapide, score financier seul)
   */
  async predict(
    dao: Record<string, unknown>,
    companyProfile?: Record<string, unknown>,
    skipQualitative = false,
    partners?: Array<Record<string, unknown>>,
  ): Promise<DecisionEnginePredictResult> {
    try {
      const { data } = await axios.post<DecisionEnginePredictResult>(
        `${this.baseUrl}/predict`,
        {
          dao,
          company_profile: companyProfile ?? undefined,
          partners: partners && partners.length ? partners : undefined,
          skip_qualitative: skipQualitative,
        },
        { timeout: 60_000 }, // MCDA + embeddings + Groq borné (10 s) : marge de sécurité
      );
      return data;
    } catch (err) {
      const ax = err as AxiosError<{ detail?: string }>;
      const detail = ax.response?.data?.detail ?? ax.message ?? 'Erreur decision-engine';
      this.logger.warn(`POST /predict failed: ${detail}`);
      throw new Error(detail);
    }
  }
}
