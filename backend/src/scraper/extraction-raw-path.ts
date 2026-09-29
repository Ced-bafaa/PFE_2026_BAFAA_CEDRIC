import * as path from 'path';

/**
 * Répertoire des PDF « pipeline » (`<uuid>.pdf`).
 * Défaut : `<repo>/ao_extractor/data` (au même niveau que `backend/`).
 * Surcharge : `EXTRACTION_RAW_DIR`.
 */
export function resolveExtractionRawPdfDir(): string {
  const env = (process.env.EXTRACTION_RAW_DIR ?? '').trim();
  if (env) return path.resolve(env);
  return path.join(__dirname, '..', '..', '..', 'ao_extractor', 'data');
}
