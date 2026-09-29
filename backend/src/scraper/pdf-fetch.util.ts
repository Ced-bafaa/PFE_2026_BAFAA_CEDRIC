import axios from 'axios';

import {
  buildArmpPdfDownloadHeaders,
  createArmpHttpsAgent,
} from '../armp/armp-pdf-download-headers';

const PDF_VERSION_MARKER = Buffer.from('%PDF-');

/** Si false : pas de Playwright (Axios uniquement). `ARMP_PDF_PLAYWRIGHT_DISABLED=true`. */
export function isPlaywrightPdfFetchAllowed(): boolean {
  const v = (process.env.ARMP_PDF_PLAYWRIGHT_DISABLED ?? 'false')
    .trim()
    .toLowerCase();
  return !['true', '1', 'yes'].includes(v);
}

/**
 * Si true (défaut) : navigateur d’abord (meilleure détection du vrai PDF), puis Axios.
 * Si false : Axios d’abord, navigateur en secours.
 * `ARMP_PDF_PLAYWRIGHT_FIRST` (true/false).
 */
export function isPlaywrightPdfPrimary(): boolean {
  const v = (process.env.ARMP_PDF_PLAYWRIGHT_FIRST ?? 'true')
    .trim()
    .toLowerCase();
  return !['false', '0', 'no'].includes(v);
}

/** Nombre d'octets examinés pour la signature (préfixe / métadonnées possibles avant `%PDF-`). */
export const PDF_HEADER_PROBE_BYTES = 1024;

/**
 * Détecte la présence de la marque de version PDF (`%PDF-1.x`) dans les premiers octets,
 * sans exiger qu'elle soit en position 0 (données avant la ligne signature).
 */
export function bufferLooksLikePdf(buf: Buffer): boolean {
  return bufferContainsPdfVersionMarker(buf);
}

export function bufferContainsPdfVersionMarker(
  buf: Buffer,
  probeBytes: number = PDF_HEADER_PROBE_BYTES,
): boolean {
  if (!buf?.length) return false;
  const n = Math.min(probeBytes, buf.length);
  const slice = buf.subarray(0, n);
  return slice.indexOf(PDF_VERSION_MARKER) !== -1;
}

function bufferLooksLikeHtml(buf: Buffer): boolean {
  const probe = buf.subarray(0, Math.min(800, buf.length)).toString('utf8');
  const t = probe.trimStart().toLowerCase();
  return (
    t.startsWith('<!doctype') ||
    t.startsWith('<html') ||
    t.startsWith('<head') ||
    t.startsWith('<!--') ||
    (t.startsWith('<') && /<html[\s>]/i.test(probe.slice(0, 500)))
  );
}

function maybePdfDownloadUrl(u: string): boolean {
  const lower = u.toLowerCase();
  return (
    lower.includes('.pdf') ||
    lower.includes('0903_publications_dl') ||
    lower.includes('publications_dl') ||
    lower.includes('application/pdf')
  );
}

/**
 * Extrait des URLs candidates pour un PDF depuis une page HTML (iframe, liens, etc.).
 */
export function extractPdfRelatedUrls(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  const push = (raw: string) => {
    const s = String(raw ?? '').trim();
    if (!s || s.startsWith('javascript:') || s.startsWith('#')) return;
    if (!maybePdfDownloadUrl(s)) return;
    try {
      out.push(new URL(s, baseUrl).href);
    } catch {
      /* ignore */
    }
  };

  const patterns: RegExp[] = [
    /<iframe[^>]+src\s*=\s*["']([^"']+)["']/gi,
    /<embed[^>]+src\s*=\s*["']([^"']+)["']/gi,
    /<object[^>]+\bdata\s*=\s*["']([^"']+)["']/gi,
    /<a[^>]+\bhref\s*=\s*["']([^"']+)["']/gi,
    /\bhref\s*=\s*["']([^"']+)["']/gi,
    /\bsrc\s*=\s*["']([^"']+)["']/gi,
  ];

  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      push(m[1]);
    }
  }

  // Heuristique scripts / quoted URLs
  const jsUrlRe = /["']([^"']*(?:\.pdf|publications_dl)[^"']*)["']/gi;
  let mJs: RegExpExecArray | null;
  while ((mJs = jsUrlRe.exec(html)) !== null) {
    push(mJs[1]);
  }

  const metaRefresh =
    /<meta[^>]+http-equiv\s*=\s*["']refresh["'][^>]+content\s*=\s*["']([^"']+)["']/gi;
  let mMeta: RegExpExecArray | null;
  while ((mMeta = metaRefresh.exec(html)) !== null) {
    const content = mMeta[1];
    const urlPart = content.split(/;\s*/i).find((p) => /url\s*=/i.test(p));
    if (urlPart) {
      const u = urlPart.replace(/^[^=]+\s*=\s*/i, '').trim();
      push(u);
    }
  }

  // URLs « nues » dans le document (certaines pages ARMP n'utilisent pas d'attributs classiques)
  const looseRe =
    /https?:\/\/[^\s"'<>)]+(?:0903_publications_dl|publications_dl)[^\s"'<>)]*/gi;
  let mLoose: RegExpExecArray | null;
  while ((mLoose = looseRe.exec(html)) !== null) {
    push(mLoose[0]);
  }

  return [...new Set(out)];
}

function primaryMime(contentType: string): string {
  return String(contentType ?? '').split(';')[0].trim().toLowerCase();
}

function utf8Preview(buf: Buffer, maxLen: number): string {
  const slice = buf.subarray(0, Math.min(buf.length, maxLen));
  let s = slice.toString('utf8');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > 1200) return `${s.slice(0, 1200)}…`;
  return s || '(vide)';
}

export type PdfFetchOptions = {
  timeoutMs?: number;
  userAgent?: string;
  maxHtmlFollowDepth?: number;
};

/**
 * Télécharge un PDF : signature `%PDF-` cherchée dans les 1024 premiers octets ;
 * en-têtes Axios = navigateur + Referer ARMP (`buildArmpPdfDownloadHeaders`).
 * Si la réponse est une page HTML intermédiaire, suit les liens vers le vrai fichier.
 */
export async function fetchPdfBufferFollowingHtml(
  url: string,
  opts: PdfFetchOptions = {},
): Promise<Buffer> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const headers = buildArmpPdfDownloadHeaders(
    opts.userAgent ? { userAgent: opts.userAgent } : undefined,
  );
  const httpsAgent = createArmpHttpsAgent();
  const maxDepth = opts.maxHtmlFollowDepth ?? 4;

  const fetchOnce = async (
    u: string,
    depth: number,
    seen: Set<string>,
  ): Promise<Buffer> => {
    if (seen.has(u)) {
      throw new Error(`Boucle de redirections HTML (${u})`);
    }
    seen.add(u);
    if (depth > maxDepth) {
      throw new Error(
        `Impossible d'obtenir un PDF après ${maxDepth} niveau(x) HTML`,
      );
    }

    const res = await axios.get<ArrayBuffer>(u, {
      responseType: 'arraybuffer',
      timeout: timeoutMs,
      headers,
      httpsAgent,
      maxRedirects: 10,
      validateStatus: (s) => s >= 200 && s < 400,
    });

    const buf = Buffer.from(res.data);
    const rawCt = String(res.headers['content-type'] ?? '');
    const mime = primaryMime(rawCt);

    if (bufferLooksLikePdf(buf)) {
      return buf;
    }

    const ctLower = rawCt.toLowerCase();
    const asHtml =
      mime === 'text/html' ||
      mime === 'application/xhtml+xml' ||
      ctLower.includes('text/html') ||
      ctLower.includes('application/xhtml') ||
      bufferLooksLikeHtml(buf);

    if (asHtml) {
      const html = buf.toString('utf8');
      const candidates = extractPdfRelatedUrls(html, u);
      if (candidates.length === 0) {
        const preview = utf8Preview(buf, 2500);
        throw new Error(
          `Page HTML sans lien PDF (${u}). Content-Type=${rawCt || '?'}. Extrait: ${preview}`,
        );
      }

      let lastErr: Error | undefined;
      for (const next of candidates) {
        try {
          return await fetchOnce(next, depth + 1, seen);
        } catch (e) {
          lastErr = e instanceof Error ? e : new Error(String(e));
        }
      }
      throw lastErr ?? new Error('Suivi HTML sans succès');
    }

    // Pas HTML : si le serveur annonce PDF/octet-stream mais pas de `%PDF-` dans la fenêtre analysée
    const preview = utf8Preview(buf, 2500);
    if (mime === 'application/pdf' || mime === 'application/octet-stream') {
      throw new Error(
        `Content-Type ${mime} mais pas de signature %PDF- dans les ${PDF_HEADER_PROBE_BYTES} premiers octets. URL=${u} Extrait: ${preview}`,
      );
    }

    throw new Error(
      `Réponse non exploitable comme PDF (Content-Type=${rawCt || '?'}, pas de %PDF- dans les ${PDF_HEADER_PROBE_BYTES} octets). URL=${u} Extrait: ${preview}`,
    );
  };

  return fetchOnce(String(url).trim(), 0, new Set());
}
