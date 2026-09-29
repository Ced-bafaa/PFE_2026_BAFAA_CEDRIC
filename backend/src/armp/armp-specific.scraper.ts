import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { load } from 'cheerio';
import * as https from 'node:https';
import type { ArmpTender } from './armp-tender.types';
import type { ITenderScraper, ScrapeOptions } from '../scraper/scraper.strategy';
import { fetchPdfBufferFollowingHtml } from '../scraper/pdf-fetch.util';
import { opportunityIdFromTender } from './armp-to-opportunity.mapper';

const DEFAULT_BASE = 'https://armp.cm';

// Types de publication qui ne sont PAS des marchés à soumissionner : communiqués
// (résultats) et décisions d'attribution. On les exclut au scrape — ils polluaient
// le catalogue et étaient même recommandés « soumission » à tort.
const RESULT_NOTICE_TYPES = new Set([
  'COMM', 'COMMUNIQUE', 'DEC', 'DECISION', 'RESULTAT', 'RESULTATS', 'ATTRIBUTION',
]);

// Second filet, basé sur le LIBELLÉ : certaines décisions d'attribution / avis
// de résultat sont publiées sous le type du marché d'origine (ONIT, AONO…) et
// échappent donc à RESULT_NOTICE_TYPES. On les écarte via des formules très
// spécifiques (FR/EN) d'attribution — non soumissionnables (marché déjà attribué).
const RESULT_TITLE_RE = new RegExp(
  [
    'award decision',
    'bearing the award',
    "portant attribution",
    "d[eé]cision d['’]attribution",
    "avis d['’]attribution",
    "notification d['’]attribution",
    'attribution (?:du|de la|des|de) march',
  ].join('|'),
  'i',
);

/** Parse une date ARMP (jj-mm-aaaa, jj/mm/aaaa ou aaaa-mm-jj) → Date, sinon null. */
function parseArmpDate(s: string): Date | null {
  const t = (s || '').trim();
  let m = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(t); // aaaa-mm-jj
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = /(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(t); // jj-mm-aaaa
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function isRetryableNetworkError(err: unknown): boolean {
  const e = err as Partial<AxiosError> | undefined;
  const code = String((e as any)?.code ?? '').toUpperCase();
  // Timeouts + transient network errors
  if (
    code.includes('ECONN') ||
    code.includes('ETIMEDOUT') ||
    code.includes('EAI_AGAIN') ||
    code.includes('ENOTFOUND') ||
    code.includes('ECONNRESET') ||
    code.includes('EPIPE')
  ) {
    return true;
  }
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (
    msg.includes('timeout') ||
    msg.includes('aborted') ||
    msg.includes('socket hang up') ||
    msg.includes('network')
  ) {
    return true;
  }
  return false;
}

/** Retourne le délai Retry-After en ms depuis un header HTTP 429, ou null si absent/invalide. */
function retryAfterMs(err: unknown): number | null {
  const headers = (err as any)?.response?.headers as Record<string, string> | undefined;
  if (!headers) return null;
  const raw = headers['retry-after'] ?? headers['Retry-After'] ?? '';
  if (!raw) return null;
  const n = parseInt(raw, 10);
  if (Number.isFinite(n) && n > 0) return n * 1000;
  // Format HTTP-date
  const t = Date.parse(raw);
  if (Number.isFinite(t) && t > Date.now()) return t - Date.now();
  return null;
}

/** Ajoute un jitter de ±30 % au délai de base pour éviter les empreintes temporelles régulières. */
function withJitter(baseMs: number): number {
  return Math.round(baseMs * (0.7 + Math.random() * 0.6));
}

function shouldDisableSslStrict(): boolean {
  const raw = (process.env.ARMP_DISABLE_SSL_STRICT ?? 'true').trim().toLowerCase();
  return !['false', '0', 'no', 'off'].includes(raw);
}

function buildAxios(): ReturnType<typeof axios.create> {
  const httpsAgent = new https.Agent({
    // IMPORTANT: uniquement car certains sites gouvernementaux ont des certifs mal configurés.
    // Désactivable via ARMP_DISABLE_SSL_STRICT=false
    rejectUnauthorized: !shouldDisableSslStrict(),
  });
  return axios.create({
    timeout: 15_000,
    httpsAgent,
    headers: {
      'User-Agent': process.env.ARMP_USER_AGENT?.trim() || DEFAULT_UA,
      'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.7',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      // Pas de Cache-Control: no-cache ici — un navigateur normal n'envoie pas
      // no-cache en navigation standard (seulement sur reload explicite).
      DNT: '1',
      Connection: 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
    },
    maxRedirects: 5,
    validateStatus: (s) => s >= 200 && s < 400,
  });
}

@Injectable()
export class ArmpSpecificScraper implements ITenderScraper {
  private readonly logger = new Logger(ArmpSpecificScraper.name);
  private readonly http = buildAxios();

  canHandle(url: string): boolean {
    try {
      const host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
      return host === 'armp.cm' || host.endsWith('.armp.cm');
    } catch {
      return url.toLowerCase().includes('armp.cm');
    }
  }

  private baseUrl(): string {
    return process.env.ARMP_BASE_URL?.trim() || DEFAULT_BASE;
  }

  private maxPages(): number {
    const n = parseInt(process.env.ARMP_MAX_PAGES ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : 15;
  }

  private requestDelayMs(): number {
    const n = parseInt(process.env.ARMP_REQUEST_DELAY_MS ?? '', 10);
    const base = Number.isFinite(n) && n >= 0 ? n : 800;
    // Jitter ±30 % : un humain met parfois 1,4s, parfois 3,2s — jamais exactement 2s.
    return withJitter(base);
  }

  private keywordsFromOptions(options?: ScrapeOptions): string[] {
    return (options?.keywords ?? [])
      .map((k) => String(k).trim())
      .filter(Boolean)
      .map((k) => k.toLowerCase());
  }

  /**
   * Pertinence par mots-clés — correspondance sur MOT ENTIER (mono ou
   * multi-mots), accents ignorés. On normalise titre et mot-clé (minuscule,
   * sans accent), on remplace toute ponctuation par des espaces, puis on
   * cherche le mot-clé bordé d'espaces. Ainsi « SI » ne matche plus « conSIdering »
   * ni « deciSIon » : seule une occurrence en tant que mot compte.
   */
  private titleMatchesKeywords(title: string, keywords: string[]): boolean {
    if (keywords.length === 0) return true;
    const norm = (s: string) =>
      String(s ?? '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '') // retire les accents (marques combinantes)
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    const t = ` ${norm(title)} `;
    if (t.trim().length === 0) return false;
    return keywords.some((k) => {
      const kk = norm(k);
      return kk.length > 0 && t.includes(` ${kk} `);
    });
  }

  private async scrapePage(
    sourceUrl: string,
    pageNumber: number,
    baseUrl: string,
    keywords: string[],
  ): Promise<ArmpTender[]> {
    const url =
      pageNumber === 1
        ? sourceUrl
        : `${sourceUrl}${sourceUrl.includes('?') ? '&' : '?'}page=${pageNumber}`;

    this.logger.debug(`Page ${pageNumber} : ${url}`);

    let html = '';
    const maxAttempts = Math.max(
      1,
      Math.min(5, parseInt(process.env.ARMP_HTTP_RETRIES ?? '3', 10) || 3),
    );
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await this.http.get<string>(url, { responseType: 'text' });
        html = String(res.data ?? '');
        break;
      } catch (err) {
        const status = (err as any)?.response?.status as number | undefined;
        const msg = err instanceof Error ? err.message : String(err);
        const isLast = attempt >= maxAttempts;

        // 429 Too Many Requests — respecter le Retry-After avant tout retry.
        if (status === 429) {
          const wait = retryAfterMs(err) ?? 60_000;
          this.logger.warn(
            `ARMP 429 Rate-Limit (attempt ${attempt}/${maxAttempts}) — attente ${Math.round(wait / 1000)}s avant retry`,
          );
          if (isLast) throw err;
          await sleep(wait);
          continue;
        }

        const retryable = isRetryableNetworkError(err);
        this.logger.warn(
          `ARMP HTTP échec (attempt ${attempt}/${maxAttempts}) — ${msg}${retryable && !isLast ? ' — retry' : ''}`,
        );
        if (!retryable || isLast) throw err;
        // backoff exponentiel avec jitter (600ms × 2^n ± 30 %)
        const delay = withJitter(600 * Math.pow(2, attempt - 1));
        await sleep(delay);
      }
    }

    const $ = load(html);
    const tenders: ArmpTender[] = [];

    $('#tout_les_avis > li').each((_i, li) => {
      try {
        const $li = $(li);
        const title = $li
          .find('strong')
          .first()
          .text()
          .replace(/\s+/g, ' ')
          .trim();

        // Écarte tôt les décisions d'attribution / avis de résultat (déjà
        // attribués — non soumissionnables) que le type_publication ne capte pas.
        if (RESULT_TITLE_RE.test(title)) {
          return;
        }

        // Étape 2 pipeline : filtrer tôt → économise parsing + évite tout downloadLink inutile.
        if (!this.titleMatchesKeywords(title, keywords)) {
          return;
        }

        const meta: Record<string, string> = {};
        $li.find('.d-table-row').each((_j, row) => {
          const cells = $(row).find('.d-table-cell');
          if (cells.length >= 2) {
            const rawKey = $(cells[0]).text().replace(/\s+/g, ' ').trim();
            const key = rawKey.replace(/\s*:\s*$/, '').trim().toLowerCase();
            const val = $(cells[1]).text().replace(/\s+/g, ' ').trim();
            if (key && val) meta[key] = val;
          }
        });

        let detailLink = '';
        $li.find('a').each((_j, a) => {
          const href = $(a).attr('href') || '';
          // Accepte /details? (relatif) ET https://www.armp.cm/details? (absolu)
          if (href.includes('/details?') && href.includes('type_publication')) {
            detailLink = href;
          }
        });
        // Normalise : si absolu on garde tel quel, si relatif on préfixe le baseUrl
        const detailUrl = detailLink
          ? (detailLink.startsWith('http') ? detailLink : `${baseUrl}${detailLink}`)
          : '';

        const params = new URLSearchParams(detailLink.split('?')[1] || '');
        const typePublication = params.get('type_publication') || '';
        const idPublication = params.get('id_publication') || '';

        // Écarte les annonces de résultats / décisions d'attribution (non soumissionnables).
        if (RESULT_NOTICE_TYPES.has(typePublication.trim().toUpperCase())) {
          return;
        }

        const downloadLink =
          $li.find('a[href*="0903_publications_dl"]').attr('href') || '';

        const publishedOn = meta['publié le'] || meta['published on the'] || '';

        let closingDate = meta['date de clôture'] || meta['closing date'] || '';
        if (closingDate.includes('1970')) closingDate = '';

        let closingTime = meta['heure de clôture'] || meta['closing time'] || '';
        if (closingTime.includes('1970')) closingTime = '';

        // Écarte les AO déjà clôturés (échéance strictement passée) : non
        // soumissionnables, et ils plombaient le critère « délai » (C4=0).
        const _cd = parseArmpDate(closingDate);
        if (_cd) {
          const _today = new Date();
          _today.setHours(0, 0, 0, 0);
          if (_cd.getTime() < _today.getTime()) {
            return;
          }
        }

        tenders.push({
          id: `${typePublication}_${idPublication}`,
          typePublication,
          idPublication,
          title,
          authority: meta['mo/ac'] || meta['po/ca'] || meta['mo/do'] || '',
          type: meta['type'] || '',
          region: meta['région'] || meta['region'] || '',
          amount: meta['montant'] || meta['amount'] || '',
          publishedOn,
          closingDate,
          closingTime,
          detailUrl,
          downloadLink,
          source: '',
        });
      } catch (err) {
        this.logger.warn(
          `Erreur parsing li: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });

    return tenders;
  }

  /**
   * Scrape one ARMP list URL with pagination.
   * (Orchestration of multiple sources remains outside this strategy.)
   */
  async scrape(url: string, options?: ScrapeOptions): Promise<ArmpTender[]> {
    let all: ArmpTender[] = [];
    const seen = new Set<string>();

    try {
      const baseUrl = this.baseUrl();
      const maxPages = this.maxPages();
      const delay = this.requestDelayMs();
      const keywords = this.keywordsFromOptions(options);

      const startedMs = Date.now();
      const budgetMs = options?.maxDurationMs;

      for (let page = 1; page <= maxPages; page++) {
        const elapsed = Date.now() - startedMs;
        this.logger.debug(
          `ARMP changement de page ${page}/${maxPages} — ${elapsed}ms écoulées depuis le début du scrape — ${url}`,
        );

        if (budgetMs != null && Number.isFinite(budgetMs) && budgetMs > 0 && elapsed >= budgetMs) {
          this.logger.warn(
            `ARMP: budget temps (${budgetMs}ms) atteint avant page ${page}, ${all.length} avis conservé(s) (partiel)`,
          );
          return all;
        }

        const tenders = await this.scrapePage(url, page, baseUrl, keywords);

        // ── Arrêt incrémental ────────────────────────────────────────────────
        // Si tous les AOs de cette page sont déjà en base, on a rattrapé
        // l'historique : inutile de continuer la pagination.
        if (options?.knownIds && options.knownIds.size > 0 && tenders.length > 0) {
          const allKnown = tenders.every((t) => {
            if (!t.id || t.id === '_') return false;
            return options.knownIds!.has(opportunityIdFromTender(t));
          });
          if (allKnown) {
            this.logger.log(
              `ARMP: page ${page} — ${tenders.length} avis tous déjà en base → arrêt incrémental (${all.length} nouveau(x) collecté(s))`,
            );
            break;
          }
        }

        for (const t of tenders) {
          if (t.id && t.id !== '_' && !seen.has(t.id)) {
            seen.add(t.id);
            all.push(t);
          }
        }

        const elapsedAfter = Date.now() - startedMs;
        if (
          budgetMs != null &&
          Number.isFinite(budgetMs) &&
          budgetMs > 0 &&
          elapsedAfter >= budgetMs
        ) {
          this.logger.warn(
            `ARMP: budget temps (${budgetMs}ms) atteint après page ${page}, ${all.length} avis conservé(s) (partiel)`,
          );
          return all;
        }

        await sleep(delay);
      }

      return all;
    } catch (err) {
      if (all.length > 0) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `ARMP: erreur après collecte partielle (${all.length} avis) — retour des données déjà récupérées. Détail: ${msg}`,
        );
        return all;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `ArmpSpecificScraper.scrape failed for ${url}: ${message}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }
  }

  /**
   * Télécharge un document de publication ARMP (ex. pridesoft `0903_publications_dl`).
   * En-têtes navigateur + Referer https://www.armp.cm/, validation Content-Type et octets %PDF
   * via le pipeline partagé (`pdf-fetch.util`).
   */
  async fetchPublicationPdf(downloadUrl: string): Promise<Buffer> {
    const trimmed = String(downloadUrl ?? '').trim();
    if (!trimmed) throw new Error('downloadUrl vide');
    return fetchPdfBufferFollowingHtml(trimmed);
  }
}
