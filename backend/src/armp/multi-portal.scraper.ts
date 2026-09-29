/**
 * MultiPortalScraper — scraper config-driven pour les portails de marchés publics
 * d'Afrique francophone (hors armp.cm qui est géré par ArmpSpecificScraper).
 *
 * Architecture :
 *   1. canHandle() : renvoie true si l'URL appartient à un portail du registre.
 *   2. scrape()    : délègue au parser approprié selon le CMS détecté.
 *      - 'pridesoft'      → parser dédié (#tout_les_avis > li)
 *      - 'joomla-loffres' → parser Joomla com_loffres
 *      - 'generic'        → parser générique multi-sélecteurs (cheerio)
 *
 * Robustesse :
 *   - Retry exponentiel avec jitter sur erreurs réseau.
 *   - Respect du Retry-After HTTP 429.
 *   - Budget temps (maxDurationMs) pour retour partiel.
 *   - SSL non-strict désactivable via ARMP_DISABLE_SSL_STRICT=false.
 */

import { Injectable, Logger } from '@nestjs/common';
import axios, { type AxiosInstance, type AxiosError } from 'axios';
import { load } from 'cheerio';
import * as https from 'node:https';
import type { ArmpTender } from './armp-tender.types';
import type { ITenderScraper, ScrapeOptions } from '../scraper/scraper.strategy';
import {
  findPortalConfig,
  type PortalConfig,
  type TableColumnMap,
  DEFAULT_DGMP_COLUMN_MAP,
} from './portal-configs';
import { extractTenderFields } from '../scraper/universal-field-extractor';
import { opportunityIdFromTender } from './armp-to-opportunity.mapper';

// ──────────────────────────────────────────────────────────────────────────────
// Utilitaires partagés
// ──────────────────────────────────────────────────────────────────────────────

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function withJitter(baseMs: number): number {
  return Math.round(baseMs * (0.7 + Math.random() * 0.6));
}

function isRetryableNetworkError(err: unknown): boolean {
  const code = String((err as any)?.code ?? '').toUpperCase();
  if (
    code.includes('ECONN') ||
    code.includes('ETIMEDOUT') ||
    code.includes('EAI_AGAIN') ||
    code.includes('ENOTFOUND') ||
    code.includes('ECONNRESET') ||
    code.includes('EPIPE')
  )
    return true;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('timeout') ||
    msg.includes('aborted') ||
    msg.includes('socket hang up') ||
    msg.includes('network')
  );
}

function retryAfterMs(err: unknown): number | null {
  const headers = (err as any)?.response?.headers as
    | Record<string, string>
    | undefined;
  if (!headers) return null;
  const raw = headers['retry-after'] ?? headers['Retry-After'] ?? '';
  if (!raw) return null;
  const n = parseInt(raw, 10);
  if (Number.isFinite(n) && n > 0) return n * 1000;
  const t = Date.parse(raw);
  if (Number.isFinite(t) && t > Date.now()) return t - Date.now();
  return null;
}

function buildAxios(): AxiosInstance {
  const disableSsl = !['false', '0', 'no', 'off'].includes(
    (process.env.ARMP_DISABLE_SSL_STRICT ?? 'true').trim().toLowerCase(),
  );
  return axios.create({
    timeout: 30_000,
    httpsAgent: new https.Agent({ rejectUnauthorized: !disableSsl }),
    headers: {
      'User-Agent': process.env.ARMP_USER_AGENT?.trim() || DEFAULT_UA,
      'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.7',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      DNT: '1',
      Connection: 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
    },
    maxRedirects: 5,
    validateStatus: (s) => s >= 200 && s < 400,
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers de parsing
// ──────────────────────────────────────────────────────────────────────────────

/** Normalise un href relatif en URL absolue. */
function resolveUrl(href: string, base: string): string {
  if (!href) return '';
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

/** Extrait le texte brut d'un nœud Cheerio (compact). */
function cleanText(raw: string): string {
  return (raw ?? '').replace(/\s+/g, ' ').trim();
}

/** Filtre les dates "1970" invalides souvent renvoyées par les portails africains. */
function sanitizeDate(raw: string): string {
  return (raw ?? '').includes('1970') ? '' : (raw ?? '').trim();
}

// ──────────────────────────────────────────────────────────────────────────────
// Parser Pridesoft (même CMS qu'armp.cm)
// ──────────────────────────────────────────────────────────────────────────────

function parsePridesoft(html: string, source: string): ArmpTender[] {
  const $ = load(html);
  const tenders: ArmpTender[] = [];

  $('#tout_les_avis > li').each((_i, li) => {
    try {
      const $li = $(li);
      const title = cleanText($li.find('strong').first().text());
      if (!title) return;

      const meta: Record<string, string> = {};
      $li.find('.d-table-row').each((_j, row) => {
        const cells = $(row).find('.d-table-cell');
        if (cells.length >= 2) {
          const key = cleanText($(cells[0]).text())
            .replace(/:\s*$/, '')
            .toLowerCase();
          const val = cleanText($(cells[1]).text());
          if (key && val) meta[key] = val;
        }
      });

      let detailLink = '';
      $li.find('a').each((_j, a) => {
        const href = $(a).attr('href') || '';
        if (href.includes('/details?') && href.includes('type_publication')) {
          detailLink = href;
        }
      });
      const detailUrl = detailLink
        ? detailLink.startsWith('http')
          ? detailLink
          : resolveUrl(detailLink, source)
        : '';

      const params = new URLSearchParams(detailLink.split('?')[1] || '');
      const typePublication = params.get('type_publication') || '';
      const idPublication = params.get('id_publication') || '';
      const downloadLink =
        $li.find('a[href*="0903_publications_dl"]').attr('href') || '';

      tenders.push({
        id: `${typePublication}_${idPublication}`,
        typePublication,
        idPublication,
        title,
        authority: meta['mo/ac'] || meta['po/ca'] || meta['mo/do'] || '',
        type: meta['type'] || '',
        region: meta['région'] || meta['region'] || '',
        amount: meta['montant'] || meta['amount'] || '',
        publishedOn: meta['publié le'] || meta['published on the'] || '',
        closingDate: sanitizeDate(
          meta['date de clôture'] || meta['closing date'] || '',
        ),
        closingTime: sanitizeDate(
          meta['heure de clôture'] || meta['closing time'] || '',
        ),
        detailUrl,
        downloadLink,
        source,
      });
    } catch {
      /* ignore row error */
    }
  });

  return tenders;
}

// ──────────────────────────────────────────────────────────────────────────────
// Parser Joomla com_loffres (marchespublics.sn et variantes)
// ──────────────────────────────────────────────────────────────────────────────

function parseJoomlaLoffres(html: string, baseUrl: string): ArmpTender[] {
  const $ = load(html);
  const tenders: ArmpTender[] = [];
  const seen = new Set<string>();

  // Joomla com_loffres : items dans article, .loffres_item, ou tr de tableau
  const candidates = $('article, .loffres_item, .offre-item, table tbody tr').toArray();

  for (const el of candidates) {
    try {
      const $el = $(el);

      // Extraction structurée (labels FR/EN, tableaux, regex)
      const fields = extractTenderFields($, $el, baseUrl);

      if (!fields.title || fields.title.length < 8) continue;
      if (seen.has(fields.title.slice(0, 80))) continue;
      seen.add(fields.title.slice(0, 80));

      const urlRef = (() => {
        if (!fields.detailUrl) return '';
        try {
          const u = new URL(fields.detailUrl);
          return (
            u.searchParams.get('id') ||
            u.searchParams.get('id_publication') ||
            u.pathname.split('/').filter((s) => /\d{3,}/.test(s)).join('-')
          );
        } catch { return ''; }
      })() || fields.reference;

      tenders.push({
        id: urlRef ? `ao_${urlRef}` : `joomla_${Date.now()}_${tenders.length}`,
        typePublication: 'ao',
        idPublication: urlRef,
        title: fields.title,
        authority: fields.authority,
        type: fields.type,
        region: fields.region,
        amount: fields.amount,
        publishedOn: fields.publishedOn,
        closingDate: sanitizeDate(fields.closingDate),
        closingTime: sanitizeDate(fields.closingTime),
        detailUrl: fields.detailUrl,
        downloadLink: fields.downloadLink,
        source: baseUrl,
      });
    } catch {
      /* ignore row error */
    }
  }

  return tenders;
}

// ──────────────────────────────────────────────────────────────────────────────
// Parser WordPress + WP File Download (ARCOP Côte d'Ivoire)
// Confirmé simulation 03/06/2026 :
//   Structure : table tbody tr
//   Colonnes  : [0] Fichier (titre + lien PDF), [1] Vues, [2] Date pub, [3] Télécharger
//   Particularité : lien pointe directement vers le PDF, pas de page de détail
// ──────────────────────────────────────────────────────────────────────────────

function parseWordpress(html: string, cfg: PortalConfig): ArmpTender[] {
  const $ = load(html);
  const tenders: ArmpTender[] = [];
  const seen = new Set<string>();

  const selector = cfg.tableSelector ?? 'table tbody tr';
  $(selector).each((_i, tr) => {
    try {
      const $tr = $(tr);
      const cells = $tr.find('td');
      if (cells.length < 2) return; // ligne de header ou vide

      // Colonne 0 : titre + lien PDF (WP File Download)
      const $firstCell = $(cells[0]);
      const titleLink = $firstCell.find('a[href]').first();
      const title = cleanText(titleLink.text() || $firstCell.text());
      if (!title || title.length < 8) return;
      if (seen.has(title.slice(0, 80))) return;
      seen.add(title.slice(0, 80));

      // Le lien de la première colonne est souvent le PDF direct
      const firstHref = resolveUrl(titleLink.attr('href') ?? '', cfg.baseUrl);
      const isPdfLink = firstHref.toLowerCase().endsWith('.pdf') ||
        firstHref.includes('/download/');

      // Colonne date : cherche une cellule avec format dd/mm/yyyy ou yyyy-mm-dd
      let publishedOn = '';
      cells.each((_j, td) => {
        if (publishedOn) return;
        const t = cleanText($(td).text());
        if (/\d{2}[\/\-]\d{2}[\/\-]\d{4}/.test(t) || /\d{4}[\/\-]\d{2}[\/\-]\d{2}/.test(t)) {
          publishedOn = t;
        }
      });

      // Lien de téléchargement : dernière colonne avec <a> ou premier href PDF
      let downloadLink = '';
      const lastCell = cells.last();
      const dlHref = resolveUrl(lastCell.find('a[href]').attr('href') ?? '', cfg.baseUrl);
      if (dlHref && dlHref !== firstHref) {
        downloadLink = dlHref;
      }

      // Extraire la référence depuis le titre (pattern N° FXxx-YYYY)
      const refMatch = title.match(/N[°º\s]*([A-Z]\d+[-\s]\d{4})/i);
      const reference = refMatch ? refMatch[0] : '';

      // ID : référence ou portion numérique de l'URL PDF
      const urlRef = (() => {
        const target = isPdfLink ? firstHref : downloadLink;
        if (!target) return '';
        try {
          const parts = new URL(target).pathname.split('/').filter(Boolean);
          // WP File Download URL pattern: /download/{cat_id}/{cat_slug}/{file_id}/{slug}.pdf
          const numParts = parts.filter((p) => /^\d+$/.test(p));
          return numParts.at(-1) ?? '';
        } catch { return ''; }
      })();

      tenders.push({
        id: urlRef ? `wp_${urlRef}` : `wp_${cfg.id}_${_i}`,
        typePublication: 'ao',
        idPublication: urlRef || reference,
        title,
        // Sur ARCOP CI, l'autorité est ARCOP elle-même (pas dans le tableau)
        authority: cfg.name,
        type: '',
        region: cfg.country,
        amount: '',
        publishedOn: sanitizeDate(publishedOn),
        closingDate: '', // absent sur ce portail
        closingTime: '',
        // Sur WP File Download, le lien principal est souvent le PDF
        detailUrl: isPdfLink ? firstHref : '',
        downloadLink: isPdfLink ? firstHref : downloadLink,
        source: cfg.baseUrl,
      });
    } catch {
      /* ignore */
    }
  });

  return tenders;
}

// ──────────────────────────────────────────────────────────────────────────────
// Parser tableau positionnel — DGMP / framework custom PHP
// Confirmé simulation 03/06/2026 — marchespublics.ci :
//   Colonnes : [0] N° AO, [1] Type marché, [2] Objet, [3] Autorité, [4] Date pub, [5] Date limite
//   Particularité : dates de publication souvent corrompues (30-11--0001) pour anciens avis
// ──────────────────────────────────────────────────────────────────────────────

function parseDgmpTable(html: string, cfg: PortalConfig): ArmpTender[] {
  const $ = load(html);
  const tenders: ArmpTender[] = [];
  const seen = new Set<string>();

  const colMap: TableColumnMap = cfg.columnMap ?? DEFAULT_DGMP_COLUMN_MAP;
  const selector = cfg.tableSelector ?? 'table tbody tr';

  $(selector).each((_i, tr) => {
    try {
      const $tr = $(tr);
      const cells = $tr.find('td');
      // Ignorer les lignes avec trop peu de colonnes (headers, séparateurs)
      if (cells.length < Math.max(colMap.title, colMap.closingDate) + 1) return;

      const cell = (idx: number) =>
        idx >= 0 ? cleanText($(cells[idx]).text()) : '';

      const title = cell(colMap.title);
      if (!title || title.length < 6) return;
      // Ignorer les lignes d'en-tête répétées dans le tbody
      if (/^(?:objet|intitul|désignation|titre)/i.test(title)) return;
      if (seen.has(title.slice(0, 80))) return;
      seen.add(title.slice(0, 80));

      const reference = cell(colMap.reference);
      const type      = cell(colMap.type);
      const authority = cell(colMap.authority);
      const publishedOn = sanitizeDate(cell(colMap.publishedOn));
      const closingDate = sanitizeDate(cell(colMap.closingDate));

      // Lien de détail : dans la cellule titre ou une cellule dédiée
      let detailUrl = '';
      const detailCellIdx = colMap.detailLink >= 0 ? colMap.detailLink : colMap.title;
      const detailHref = $(cells[detailCellIdx]).find('a[href]').attr('href') ?? '';
      if (detailHref) {
        detailUrl = resolveUrl(detailHref, cfg.baseUrl);
      }

      // ID : référence AO (ex. "P 68/2022", "AOO26030423710") ou URL
      const cleanRef = reference.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\-\/]/g, '');
      const urlRef = (() => {
        if (!detailUrl) return cleanRef;
        try {
          const u = new URL(detailUrl);
          return (
            u.searchParams.get('id') ||
            u.pathname.split('/').filter((s) => /\d{3,}/.test(s)).at(-1) ||
            cleanRef
          );
        } catch { return cleanRef; }
      })();

      tenders.push({
        id: urlRef ? `dgmp_${urlRef}` : `dgmp_${cfg.id}_${_i}`,
        typePublication: type.toLowerCase().includes('international') ? 'AOI' : 'AO',
        idPublication: reference,
        title,
        authority,
        type,
        region: cfg.country, // pas de colonne région sur ce portail
        amount: '',           // pas de colonne montant sur ce portail
        publishedOn,
        closingDate,
        closingTime: '',
        detailUrl,
        downloadLink: '',
        source: cfg.baseUrl,
      });
    } catch {
      /* ignore */
    }
  });

  return tenders;
}

// ──────────────────────────────────────────────────────────────────────────────
// Parser générique (multi-sélecteurs — dernier recours)
// ──────────────────────────────────────────────────────────────────────────────

/** Sélecteurs CSS candidats pour trouver les items d'une liste d'AO. */
const GENERIC_ITEM_SELECTORS = [
  '.views-row',
  '.view-row',
  'article.node',
  'article',
  '.tender-item',
  '.offre',
  '.marche-item',
  '.appel-offre',
  'li.views-row',
  'li.offre',
  'table.views-table tbody tr',
  'table tbody tr',
];

function parseGeneric(html: string, baseUrl: string): ArmpTender[] {
  const $ = load(html);
  const tenders: ArmpTender[] = [];
  const seen = new Set<string>();

  // Trouver le conteneur de liste avec le plus grand nombre d'items homogènes
  let items: ReturnType<typeof $> | null = null;
  for (const sel of GENERIC_ITEM_SELECTORS) {
    const found = $(sel);
    if (found.length >= 2) {
      items = found;
      break;
    }
  }
  if (!items || items.length === 0) return tenders;

  items.each((_i, el) => {
    try {
      const $el = $(el);

      // ── Extraction structurée via UniversalFieldExtractor ──────────────
      const fields = extractTenderFields($, $el, baseUrl);

      // Titre obligatoire : ignorer les items sans titre substantiel
      if (!fields.title || fields.title.length < 8) return;
      const titleKey = fields.title.slice(0, 80);
      if (seen.has(titleKey)) return;
      seen.add(titleKey);

      // Construire l'ID depuis l'URL de détail ou la référence
      const urlRef = (() => {
        if (!fields.detailUrl) return '';
        try {
          const u = new URL(fields.detailUrl);
          const id =
            u.searchParams.get('id') ||
            u.searchParams.get('id_publication') ||
            u.searchParams.get('dossier') ||
            '';
          return id || u.pathname.split('/').filter((s) => /\d{3,}/.test(s)).join('-');
        } catch {
          return '';
        }
      })() || fields.reference;

      tenders.push({
        id: urlRef ? `ao_${urlRef}` : `gen_${Date.now()}_${_i}`,
        typePublication: 'ao',
        idPublication: urlRef,
        title: fields.title,
        authority: fields.authority,
        type: fields.type,
        region: fields.region,
        amount: fields.amount,
        publishedOn: fields.publishedOn,
        closingDate: sanitizeDate(fields.closingDate),
        closingTime: sanitizeDate(fields.closingTime),
        detailUrl: fields.detailUrl,
        downloadLink: fields.downloadLink,
        source: baseUrl,
      });
    } catch {
      /* ignore row error */
    }
  });

  return tenders;
}

// ──────────────────────────────────────────────────────────────────────────────
// Scraper principal
// ──────────────────────────────────────────────────────────────────────────────

@Injectable()
export class MultiPortalScraper implements ITenderScraper {
  private readonly logger = new Logger(MultiPortalScraper.name);
  private readonly http = buildAxios();

  /**
   * Configs injectées dynamiquement par le TechDetector pour des portails
   * non enregistrés dans portal-configs.json.
   * Clé = hostname sans www.
   */
  private readonly dynamicConfigs = new Map<string, PortalConfig>();

  canHandle(url: string): boolean {
    if (findPortalConfig(url) !== null) return true;
    try {
      const host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
      return this.dynamicConfigs.has(host);
    } catch {
      return false;
    }
  }

  /**
   * Injecte une config générée dynamiquement par le TechDetector.
   * Idempotent : si la config existe déjà pour ce hostname, elle est mise à jour.
   */
  injectDynamicConfig(cfg: PortalConfig): void {
    for (const host of cfg.hosts) {
      this.dynamicConfigs.set(host, cfg);
    }
  }

  /** Résolution : registre statique d'abord, configs dynamiques ensuite. */
  private resolveConfig(url: string): PortalConfig | null {
    const fromRegistry = findPortalConfig(url);
    if (fromRegistry) return fromRegistry;
    try {
      const host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
      return this.dynamicConfigs.get(host) ?? null;
    } catch {
      return null;
    }
  }

  // ── HTTP fetch avec retry + 429 handling ──────────────────────────────────

  private async fetchHtml(url: string): Promise<string> {
    const maxAttempts = Math.max(
      1,
      Math.min(4, parseInt(process.env.ARMP_HTTP_RETRIES ?? '3', 10) || 3),
    );
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await this.http.get<string>(url, { responseType: 'text' });
        return String(res.data ?? '');
      } catch (err) {
        const status = (err as any)?.response?.status as number | undefined;
        const isLast = attempt >= maxAttempts;

        if (status === 429) {
          const wait = retryAfterMs(err) ?? 60_000;
          this.logger.warn(
            `[MultiPortal] 429 rate-limit (attempt ${attempt}/${maxAttempts}) — attente ${Math.round(wait / 1000)}s — ${url}`,
          );
          if (isLast) throw err;
          await sleep(wait);
          continue;
        }

        const retryable = isRetryableNetworkError(err);
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `[MultiPortal] HTTP échec attempt ${attempt}/${maxAttempts} — ${msg}${retryable && !isLast ? ' — retry' : ''} — ${url}`,
        );
        if (!retryable || isLast) throw err;
        await sleep(withJitter(600 * Math.pow(2, attempt - 1)));
      }
    }
    throw new Error(`fetchHtml: max attempts reached for ${url}`);
  }

  // ── Génération de l'URL paginée ───────────────────────────────────────────

  private pageUrl(cfg: PortalConfig, page: number): string {
    const base = cfg.listUrl;
    if (page <= 1) return base;

    if (cfg.paginationPageParam) {
      const sep = base.includes('?') ? '&' : '?';
      return `${base}${sep}${cfg.paginationPageParam}=${page}`;
    }

    if (cfg.paginationOffsetParam) {
      const step = cfg.itemsPerPage ?? 10;
      const offset = (page - 1) * step;
      const sep = base.includes('?') ? '&' : '?';
      return `${base}${sep}${cfg.paginationOffsetParam}=${offset}`;
    }

    return base;
  }

  // ── Parsing délégué selon le CMS ─────────────────────────────────────────

  private parsePage(html: string, cfg: PortalConfig): ArmpTender[] {
    switch (cfg.cms) {
      case 'pridesoft':
        return parsePridesoft(html, cfg.baseUrl);
      case 'joomla-loffres':
        return parseJoomlaLoffres(html, cfg.baseUrl);
      case 'wordpress':
        return parseWordpress(html, cfg);
      case 'dgmp-table':
        return parseDgmpTable(html, cfg);
      default:
        return parseGeneric(html, cfg.baseUrl);
    }
  }

  // ── Filtre par mots-clés ──────────────────────────────────────────────────

  private matchesKeywords(title: string, keywords: string[]): boolean {
    if (keywords.length === 0) return true;
    const t = title.toLowerCase();
    return keywords.some((k) => t.includes(k));
  }

  // ── Point d'entrée principal ──────────────────────────────────────────────

  async scrape(url: string, options?: ScrapeOptions): Promise<ArmpTender[]> {
    const cfg = this.resolveConfig(url);
    if (!cfg) {
      this.logger.warn(`[MultiPortal] canHandle() passed but no config for: ${url}`);
      return [];
    }

    const keywords = (options?.keywords ?? [])
      .map((k) => String(k).trim().toLowerCase())
      .filter(Boolean);

    const maxPages = cfg.maxPages ?? 10;
    const startedMs = Date.now();
    const budgetMs = options?.maxDurationMs;
    const delay = withJitter(parseInt(process.env.ARMP_REQUEST_DELAY_MS ?? '2000', 10) || 2000);

    const all: ArmpTender[] = [];
    const seen = new Set<string>();

    this.logger.log(
      `[MultiPortal] Début scraping ${cfg.name} (${cfg.country}) — maxPages=${maxPages} — ${url}`,
    );

    for (let page = 1; page <= maxPages; page++) {
      const elapsed = Date.now() - startedMs;
      if (budgetMs && budgetMs > 0 && elapsed >= budgetMs) {
        this.logger.warn(
          `[MultiPortal] Budget temps (${budgetMs}ms) atteint avant page ${page} — ${cfg.name} — ${all.length} avis`,
        );
        break;
      }

      const pageUrl = this.pageUrl(cfg, page);
      this.logger.debug(`[MultiPortal] Page ${page}/${maxPages} — ${pageUrl}`);

      let html: string;
      try {
        html = await this.fetchHtml(pageUrl);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (all.length > 0) {
          this.logger.warn(
            `[MultiPortal] Erreur page ${page} après ${all.length} avis — retour partiel — ${msg}`,
          );
        } else {
          this.logger.error(`[MultiPortal] Erreur page ${page} — ${cfg.name} — ${msg}`);
        }
        break;
      }

      const tenders = this.parsePage(html, cfg);
      if (tenders.length === 0 && page > 1) {
        this.logger.debug(
          `[MultiPortal] Page ${page} vide — fin de pagination — ${cfg.name}`,
        );
        break;
      }

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
            `[MultiPortal] ${cfg.name} page ${page} — ${tenders.length} avis tous déjà en base → arrêt incrémental (${all.length} nouveau(x) collecté(s))`,
          );
          break;
        }
      }

      let added = 0;
      for (const t of tenders) {
        // Injection du pays via source
        t.source = cfg.baseUrl;
        if (!this.matchesKeywords(t.title, keywords)) continue;
        const key = t.id && t.id !== '_' ? t.id : `${t.title.slice(0, 60)}_${t.publishedOn}`;
        if (!seen.has(key)) {
          seen.add(key);
          all.push(t);
          added++;
        }
      }
      this.logger.debug(
        `[MultiPortal] Page ${page} — ${tenders.length} avis bruts, ${added} retenus — ${cfg.name}`,
      );

      const elapsedAfter = Date.now() - startedMs;
      if (budgetMs && budgetMs > 0 && elapsedAfter >= budgetMs) {
        this.logger.warn(
          `[MultiPortal] Budget temps atteint après page ${page} — ${cfg.name} — ${all.length} avis`,
        );
        break;
      }

      if (page < maxPages) await sleep(delay);
    }

    this.logger.log(
      `[MultiPortal] Fin scraping ${cfg.name} — ${all.length} avis au total`,
    );
    return all;
  }
}
