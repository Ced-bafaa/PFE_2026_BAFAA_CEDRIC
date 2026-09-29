import * as https from 'node:https';

/**
 * Referer attendu par les scripts de téléchargement ARMP / pridesoft.
 */
export const ARMP_SITE_REFERER = 'https://www.armp.cm/';

const DEFAULT_BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function shouldDisableSslStrict(): boolean {
  const raw = (process.env.ARMP_DISABLE_SSL_STRICT ?? 'true').trim().toLowerCase();
  return !['false', '0', 'no', 'off'].includes(raw);
}

/** Agent HTTPS aligné sur le scraper ARMP (certificats parfois problématiques). */
export function createArmpHttpsAgent(): https.Agent {
  return new https.Agent({
    rejectUnauthorized: !shouldDisableSslStrict(),
  });
}

/**
 * En-têtes « navigateur » pour les URLs de publication (0903_publications_dl, etc.).
 */
export function buildArmpPdfDownloadHeaders(options?: {
  userAgent?: string;
}): Record<string, string> {
  const ua =
    options?.userAgent?.trim() ||
    process.env.ARMP_USER_AGENT?.trim() ||
    DEFAULT_BROWSER_UA;

  return {
    'User-Agent': ua,
    Referer: ARMP_SITE_REFERER,
    Accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.8',
    'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.7',
    // Cache-Control: no-cache retiré — un navigateur n'envoie pas no-cache sur
    // les téléchargements initiés depuis un lien (seulement sur reload manuel).
    DNT: '1',
    Connection: 'keep-alive',
  };
}
