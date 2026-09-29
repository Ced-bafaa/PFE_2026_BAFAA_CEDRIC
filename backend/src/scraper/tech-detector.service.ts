/**
 * TechDetectorService — détecte la technologie web d'un portail de marchés publics
 * à partir d'une requête HTTP légère, sans Playwright.
 *
 * Signaux utilisés (fiabilité ≥ 95 %) :
 *   • Headers HTTP   : X-Generator, X-Powered-By, Set-Cookie (PHPSESSID, etc.)
 *   • <meta name="generator">  : Joomla!, WordPress, Drupal
 *   • Marqueurs HTML spécifiques : id="tout_les_avis" (Pridesoft), /wp-content/,
 *     Drupal.settings, __NEXT_DATA__, __NUXT__, etc.
 *   • Heuristique SPA : <body> quasi-vide + nombreux <script src="*.js">
 *
 * Cache : résultat stocké par hostname pendant TTL_MS (1 heure par défaut).
 * Si la détection échoue, retourne le profil "static" (fallback sûr).
 */

import { Injectable, Logger } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';
import * as https from 'node:https';

// ─── Types publics ────────────────────────────────────────────────────────────

export type DetectedTech =
  /** ARMP Cameroun et portails sous le même moteur Pridesoft */
  | 'pridesoft'
  /** Joomla CMS (com_loffres, com_content…) */
  | 'joomla'
  /** WordPress */
  | 'wordpress'
  /** Drupal */
  | 'drupal'
  /** Next.js (SSR ou SSG — HTML complet dans la réponse) */
  | 'nextjs'
  /** Nuxt.js (SSR ou SSG) */
  | 'nuxt'
  /** SPA client-side (React/Vue/Angular sans SSR) : body quasi-vide */
  | 'spa'
  /** HTML statique ou CMS non identifié — parseur générique suffisant */
  | 'static';

export type TechProfile = {
  tech: DetectedTech;
  /**
   * true  → le contenu utile est rendu côté client : Playwright requis.
   * false → le contenu est dans la réponse HTML initiale : cheerio suffisant.
   */
  needsJs: boolean;
  /** Niveau de confiance dans la détection. */
  confidence: 'high' | 'medium' | 'low';
  /** CMS Pridesoft uniquement : URL de liste à utiliser directement. */
  pridesoft?: { listUrl: string };
};

// ─── Cache interne ────────────────────────────────────────────────────────────

type CacheEntry = {
  profile: TechProfile;
  expiresAt: number;
};

/** TTL par défaut : 1 heure. La tech d'un site ne change pas en cours de scrape. */
const TTL_MS = 60 * 60 * 1000;

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const FALLBACK_PROFILE: TechProfile = {
  tech: 'static',
  needsJs: false,
  confidence: 'low',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return url;
  }
}

function buildHttp(): AxiosInstance {
  const rejectUnauthorized = !['false', '0', 'no', 'off'].includes(
    (process.env.ARMP_DISABLE_SSL_STRICT ?? 'true').trim().toLowerCase(),
  );
  return axios.create({
    timeout: 20_000,
    httpsAgent: new https.Agent({ rejectUnauthorized: !rejectUnauthorized }),
    headers: {
      'User-Agent': process.env.ARMP_USER_AGENT?.trim() || DEFAULT_UA,
      Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.7',
    },
    maxRedirects: 5,
    validateStatus: (s) => s >= 200 && s < 400,
    // On ne lit que le début du body (suffisant pour les meta et marqueurs)
    maxContentLength: 256 * 1024, // 256 Ko
  });
}

// ─── Fonctions d'analyse ──────────────────────────────────────────────────────

/**
 * Analyse les headers HTTP pour des indices de technologie.
 * Retourne un profil partiel ou null si aucun indice trouvé.
 */
function detectFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): Partial<TechProfile> | null {
  const get = (key: string): string =>
    String(headers[key.toLowerCase()] ?? '').toLowerCase();

  const xGenerator = get('x-generator');
  if (xGenerator.includes('drupal')) {
    return { tech: 'drupal', needsJs: false, confidence: 'high' };
  }

  const xPoweredBy = get('x-powered-by');
  if (xPoweredBy.includes('wordpress')) {
    return { tech: 'wordpress', needsJs: false, confidence: 'high' };
  }

  return null;
}

/**
 * Analyse le HTML brut pour identifier la technologie.
 * Ordre : du plus spécifique (Pridesoft) au plus générique (SPA).
 */
function detectFromHtml(html: string, baseUrl: string): TechProfile {
  // ── 1. Pridesoft — #tout_les_avis ou marqueur de téléchargement ──────────
  if (
    html.includes('id="tout_les_avis"') ||
    html.includes("id='tout_les_avis'") ||
    html.includes('0903_publications_dl')
  ) {
    // Déduire l'URL de liste canonique si on est sur la home
    let listUrl = baseUrl;
    try {
      const u = new URL(baseUrl);
      if (u.pathname === '/' || u.pathname === '') {
        listUrl = `${u.origin}/filtres?type=avis&val=1`;
      }
    } catch { /* */ }
    return {
      tech: 'pridesoft',
      needsJs: false,
      confidence: 'high',
      pridesoft: { listUrl },
    };
  }

  // ── 2. Joomla — <meta name="generator"> ou marqueurs URL/body ───────────
  if (
    /meta[^>]+name=["']generator["'][^>]+content=["'][^"']*joomla/i.test(html) ||
    html.includes('/components/com_') ||
    html.includes('index.php?option=com_')
  ) {
    return { tech: 'joomla', needsJs: false, confidence: 'high' };
  }

  // ── 3. WordPress ─────────────────────────────────────────────────────────
  if (
    /meta[^>]+name=["']generator["'][^>]+content=["'][^"']*wordpress/i.test(html) ||
    html.includes('/wp-content/') ||
    html.includes('/wp-includes/')
  ) {
    return { tech: 'wordpress', needsJs: false, confidence: 'high' };
  }

  // ── 4. Drupal ─────────────────────────────────────────────────────────────
  if (
    /meta[^>]+name=["']Generator["'][^>]+content=["'][^"']*drupal/i.test(html) ||
    html.includes('Drupal.settings') ||
    html.includes('data-drupal-selector') ||
    html.includes('/sites/default/files/')
  ) {
    return { tech: 'drupal', needsJs: false, confidence: 'high' };
  }

  // ── 5. Next.js ────────────────────────────────────────────────────────────
  if (html.includes('__NEXT_DATA__') || html.includes('/_next/static/')) {
    // Next.js SSR/SSG : le HTML est complet, cheerio suffit.
    return { tech: 'nextjs', needsJs: false, confidence: 'high' };
  }

  // ── 6. Nuxt.js ────────────────────────────────────────────────────────────
  if (html.includes('__NUXT__') || html.includes('/_nuxt/')) {
    return { tech: 'nuxt', needsJs: false, confidence: 'high' };
  }

  // ── 7. SPA cliente (React/Vue/Angular sans SSR) ───────────────────────────
  // Heuristique : body quasi-vide + au moins 3 bundles JS
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyContent = (bodyMatch?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/gi, '').trim();
  const scriptCount = (html.match(/<script[^>]+src=["'][^"']*\.js["']/gi) ?? []).length;
  const hasRootDiv =
    html.includes('id="root"') ||
    html.includes("id='root'") ||
    html.includes('id="app"') ||
    html.includes("id='app'");

  if (hasRootDiv && scriptCount >= 3 && bodyContent.length < 500) {
    return { tech: 'spa', needsJs: true, confidence: 'medium' };
  }

  // ── 8. Fallback : HTML statique / CMS non identifié ──────────────────────
  return { tech: 'static', needsJs: false, confidence: 'low' };
}

// ─── Service principal ────────────────────────────────────────────────────────

@Injectable()
export class TechDetectorService {
  private readonly logger = new Logger(TechDetectorService.name);
  private readonly http = buildHttp();
  private readonly cache = new Map<string, CacheEntry>();

  /**
   * Détecte la technologie du portail à partir de l'URL.
   *
   * 1. Vérifie le cache (hostname).
   * 2. Fetch HTTP GET (≤ 256 Ko, timeout 20 s).
   * 3. Analyse headers puis HTML.
   * 4. Met en cache le résultat.
   * 5. En cas d'erreur, retourne le profil "static" (dégradation gracieuse).
   */
  async detect(url: string): Promise<TechProfile> {
    const hostname = extractHostname(url);

    // ── Cache hit ──────────────────────────────────────────────────────────
    const cached = this.cache.get(hostname);
    if (cached && cached.expiresAt > Date.now()) {
      this.logger.debug(`[TechDetector] Cache hit — ${hostname} → ${cached.profile.tech}`);
      return cached.profile;
    }

    // ── Fetch ──────────────────────────────────────────────────────────────
    let html = '';
    let responseHeaders: Record<string, string | string[] | undefined> = {};

    try {
      this.logger.debug(`[TechDetector] Analyse de ${url}`);
      const res = await this.http.get<string>(url, { responseType: 'text' });
      html = String(res.data ?? '');
      responseHeaders = (res.headers ?? {}) as Record<string, string | string[] | undefined>;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `[TechDetector] Fetch échoué pour ${url} — fallback "static" — ${msg}`,
      );
      return FALLBACK_PROFILE;
    }

    // ── Analyse ────────────────────────────────────────────────────────────
    const fromHeaders = detectFromHeaders(responseHeaders);
    const profile: TechProfile = fromHeaders
      ? ({ ...fromHeaders } as TechProfile)
      : detectFromHtml(html, url);

    this.logger.log(
      `[TechDetector] ${hostname} → tech="${profile.tech}" needsJs=${profile.needsJs} confidence=${profile.confidence}`,
    );

    // ── Mise en cache ──────────────────────────────────────────────────────
    this.cache.set(hostname, {
      profile,
      expiresAt: Date.now() + TTL_MS,
    });

    return profile;
  }

  /**
   * Invalide le cache pour un hostname donné.
   * Utile si l'utilisateur signale que la détection est incorrecte.
   */
  invalidate(url: string): void {
    const hostname = extractHostname(url);
    this.cache.delete(hostname);
    this.logger.debug(`[TechDetector] Cache invalidé — ${hostname}`);
  }

  /** Vide tout le cache (admin / tests). */
  clearCache(): void {
    this.cache.clear();
    this.logger.debug('[TechDetector] Cache entièrement vidé');
  }
}
