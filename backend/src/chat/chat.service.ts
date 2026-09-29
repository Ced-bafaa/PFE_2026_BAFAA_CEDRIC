import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import * as fs from 'fs';
import { OpportunityEntity } from '../opportunities/entities/opportunity.entity';
import type { ChatMessageDto } from './dto/chat.dto';

interface GroqMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(OpportunityEntity)
    private readonly opportunityRepo: Repository<OpportunityEntity>,
  ) {}

  // ── Profil entreprise ────────────────────────────────────────────────────────

  private loadCompanyProfile(): Record<string, unknown> {
    try {
      // Surchargé par COMPANY_PROFILE_PATH (.env / conteneur). Défaut portable :
      // chemin relatif depuis le cwd du backend, valable Windows comme Linux.
      const path = this.config.get<string>(
        'COMPANY_PROFILE_PATH',
        '../decision_engine/data/company_profile.json',
      );
      const raw = fs.readFileSync(path, 'utf-8');
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private summarizeProfile(profile: Record<string, unknown>): string {
    const lines: string[] = [];
    if (profile.company_name) lines.push(`Entreprise : ${profile.company_name}`);
    if (profile.description) lines.push(`Activité : ${profile.description}`);
    if (profile.years_experience) lines.push(`Ancienneté : ${profile.years_experience} ans`);
    if (profile.staff_headcount) lines.push(`Effectif : ${profile.staff_headcount} collaborateurs`);
    if (profile.annual_revenue) {
      lines.push(`CA annuel : ${Number(profile.annual_revenue).toLocaleString('fr-FR')} FCFA`);
    }
    const comps = profile.competencies as Array<{ domain?: string }> | undefined;
    if (Array.isArray(comps) && comps.length > 0) {
      lines.push(`Domaines : ${comps.map((c) => c.domain).filter(Boolean).join(', ')}`);
    }
    return lines.join('\n');
  }

  // ── Contexte AOs ─────────────────────────────────────────────────────────────

  private formatAos(
    entities: OpportunityEntity[],
    maxChars = 8_000,
  ): { text: string; aoCount: number; contextChars: number } {
    if (entities.length === 0) {
      return { text: 'Aucun appel d\'offres en base actuellement.', aoCount: 0, contextChars: 0 };
    }

    // On remplit jusqu'au budget de caractères pour rester sous 6 000 TPM (tier gratuit Groq).
    // ~4 chars ≈ 1 token. 8 000 chars ≈ 2 000 tokens pour les AOs.
    const lines: string[] = [];
    let total = 0;

    for (const e of entities) {
      const enrichment = (e.enrichment ?? {}) as Record<string, unknown>;
      const decision = enrichment.decision as Record<string, unknown> | undefined;
      const verdict = decision?.verdict ?? '?';
      const title = String(e.title ?? '').slice(0, 80);
      const line = `[${e.id}] ${title} | ${e.location || '?'} | ${e.deadline || '?'} | ${e.budget || '?'} | ${verdict}`;

      if (total + line.length > maxChars) break;
      lines.push(line);
      total += line.length + 1; // +1 pour le \n
    }

    return { text: lines.join('\n'), aoCount: lines.length, contextChars: total };
  }

  // ── Prompt système ───────────────────────────────────────────────────────────

  private buildSystemPrompt(profile: Record<string, unknown>, aosContext: string): string {
    const today = new Date().toLocaleDateString('fr-FR', {
      day: '2-digit', month: 'long', year: 'numeric',
    });

    return `Tu es l'assistant IA de KIAMA, un système de veille stratégique des marchés publics au Cameroun.
Tu aides les équipes commerciales à analyser, filtrer et prioriser les appels d'offres.
Aujourd'hui nous sommes le ${today}.

## Profil de l'entreprise
${this.summarizeProfile(profile) || 'Profil non configuré.'}

## Appels d'offres disponibles en base
${aosContext}

## Format des identifiants d'AO
Chaque AO est préfixée par son identifiant entre crochets, ex. [armp-abc123]. Cet identifiant
commence toujours par "armp-". Quand tu mentionnes une AO, écris son identifiant tel quel
(ex. armp-abc123) EN PLUS de son titre : l'interface le transforme automatiquement en lien
cliquable vers la fiche.

## Instructions
- Réponds TOUJOURS en français, de façon concise et structurée.
- Quand tu références une AO, cite son titre exact entre guillemets ET son identifiant armp-… .
- Dès que tu compares plusieurs AOs (budget, échéance, verdict, lieu…), présente-les sous forme
  de tableau Markdown avec en-tête et ligne de séparation (| Colonne | … | puis |---|---|).
  Inclus une colonne "Réf." contenant l'identifiant armp-… de chaque AO.
- Pour les listes simples, utilise des tirets (-).
- Pour les montants, utilise le format "XX 000 000 FCFA".
- Mets en gras (**…**) les éléments décisifs (verdict, montant clé, échéance imminente).
- Ne réponds qu'à partir des données fournies — ne fabrique pas d'AOs ni d'identifiants.
- Si tu ne sais pas, dis-le honnêtement.
- Sois direct et actionnable : l'utilisateur veut prendre des décisions commerciales.`;
  }

  // ── Appel Groq ───────────────────────────────────────────────────────────────

  private async callGroq(messages: GroqMessage[]): Promise<string> {
    const apiKey = this.config.get<string>('GROQ_API_KEY', '');
    const model = this.config.get<string>('GROQ_MODEL', 'openai/gpt-oss-120b');

    if (!apiKey) {
      return 'Le chatbot IA n\'est pas configuré (GROQ_API_KEY manquant). Contactez l\'administrateur.';
    }

    try {
      const response = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model,
          messages,
          temperature: 0.4,
          max_tokens: 1500,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30_000,
        },
      );

      return (response.data as { choices: Array<{ message: { content: string } }> })
        .choices[0].message.content;
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const detail = (err.response?.data as any)?.error?.message ?? err.message;
        if (status === 429) {
          return '⚠️ L\'assistant est momentanément surchargé (limite de requêtes Groq atteinte). Réessaie dans quelques secondes.';
        }
        if (status === 401) {
          return '⚠️ Clé API Groq invalide. Vérifie la variable GROQ_API_KEY dans le fichier .env du backend.';
        }
        this.logger.error(`[Chat] Erreur Groq HTTP ${status} : ${detail}`);
        return `⚠️ Erreur du service IA (${status ?? 'réseau'}). Réessaie dans quelques instants.`;
      }
      this.logger.error('[Chat] Erreur inattendue :', err);
      return '⚠️ Une erreur inattendue s\'est produite. Réessaie dans quelques instants.';
    }
  }

  // ── Point d'entrée ───────────────────────────────────────────────────────────

  async chat(
    message: string,
    history: ChatMessageDto[] = [],
  ): Promise<{ reply: string; meta: { aoCount: number; contextChars: number; estimatedTokens: number } }> {
    const [profile, entities] = await Promise.all([
      Promise.resolve(this.loadCompanyProfile()),
      this.opportunityRepo.find({ order: { publishedAt: 'DESC' }, take: 200 }),
    ]);

    const { text: aosContext, aoCount, contextChars } = this.formatAos(entities);
    const systemPrompt = this.buildSystemPrompt(profile, aosContext);

    const messages: GroqMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: message },
    ];

    const totalChars = systemPrompt.length + message.length;
    const estimatedTokens = Math.round(totalChars / 4);

    this.logger.log(
      `[Chat] message="${message.slice(0, 80)}…" history=${history.length} aos=${aoCount}/${entities.length} ~${estimatedTokens} tokens`,
    );

    const reply = await this.callGroq(messages);
    this.logger.log(`[Chat] réponse ${reply.length} chars`);
    return { reply, meta: { aoCount, contextChars, estimatedTokens } };
  }

  // ── Streaming (SSE) ──────────────────────────────────────────────────────────

  /** Appelle Groq en streaming et pousse chaque token via onDelta. */
  private async streamGroq(
    messages: GroqMessage[],
    onDelta: (token: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const apiKey = this.config.get<string>('GROQ_API_KEY', '');
    const model = this.config.get<string>('GROQ_MODEL', 'openai/gpt-oss-120b');
    if (!apiKey) {
      onDelta("Le chatbot IA n'est pas configuré (GROQ_API_KEY manquant). Contactez l'administrateur.");
      return;
    }

    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      { model, messages, temperature: 0.4, max_tokens: 1500, stream: true },
      {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        responseType: 'stream',
        timeout: 60_000,
        signal,
      },
    );

    const stream = response.data as NodeJS.ReadableStream;
    let buffer = '';
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf-8');
        let idx: number;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const json = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const delta = json?.choices?.[0]?.delta?.content;
            if (delta) onDelta(delta);
          } catch {
            /* fragment JSON incomplet — ignoré */
          }
        }
      });
      stream.on('end', () => resolve());
      stream.on('error', (e) => reject(e));
    });
  }

  /** Point d'entrée streaming : construit le contexte puis pousse les tokens. */
  async chatStream(
    message: string,
    history: ChatMessageDto[] = [],
    onDelta: (token: string) => void,
    signal?: AbortSignal,
  ): Promise<{ meta: { aoCount: number; contextChars: number; estimatedTokens: number } }> {
    const [profile, entities] = await Promise.all([
      Promise.resolve(this.loadCompanyProfile()),
      this.opportunityRepo.find({ order: { publishedAt: 'DESC' }, take: 200 }),
    ]);
    const { text: aosContext, aoCount, contextChars } = this.formatAos(entities);
    const systemPrompt = this.buildSystemPrompt(profile, aosContext);
    const messages: GroqMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: message },
    ];
    const estimatedTokens = Math.round((systemPrompt.length + message.length) / 4);

    try {
      await this.streamGroq(messages, onDelta, signal);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        if (status === 429) {
          onDelta("\n\n⚠️ Assistant momentanément surchargé (limite Groq). Réessaie dans quelques secondes.");
        } else if (status === 401) {
          onDelta('\n\n⚠️ Clé API Groq invalide (GROQ_API_KEY).');
        } else {
          onDelta(`\n\n⚠️ Erreur du service IA (${status ?? 'réseau'}).`);
        }
      } else if (!(err instanceof Error && err.name === 'CanceledError')) {
        onDelta('\n\n⚠️ Une erreur inattendue s\'est produite.');
      }
    }
    return { meta: { aoCount, contextChars, estimatedTokens } };
  }
}
