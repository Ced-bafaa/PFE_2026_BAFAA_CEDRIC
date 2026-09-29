import type { Opportunity } from '../seed/mock-data';
import type { ArmpTender } from './armp-tender.types';

function normalizeForId(raw: string): string {
  return (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}\s'-]+/gu, '')
    .trim();
}

function djb2Hash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h) ^ input.charCodeAt(i);
  }
  // Convert to unsigned and base36 for compactness.
  return (h >>> 0).toString(36);
}

/** Titres génériques répétés sur les listes (même libellé pour plusieurs fiches différentes). */
function isBoilerplateTenderTitle(raw: string): boolean {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return true;
  if (s.length <= 22) return true;
  if (/avis d['']?appel (à |a |aux )?concurrence/i.test(s)) return true;
  if (/^avis d['']?appel\b/i.test(s) && s.length < 65) return true;
  if (/^appel d['']?offres?\b/i.test(s) && s.length < 42) return true;
  if (/avis de publicit/i.test(s) && s.length < 58) return true;
  return false;
}

/**
 * Patterns de référence reconnus sur les portails africains de marchés publics.
 * Chaque pattern est testé sur le titre puis la description.
 * Le premier match est retenu comme référence canonique.
 */
const REFERENCE_PATTERNS: RegExp[] = [
  // ARCOP Burkina : ARCOP/DAO/2026/0042
  /[A-Z]{2,}[/\-](?:DAO|AON|AOI|DRP|DC|AMI|RE|CMP)[/\-]\d{4}[/\-]\d+/i,
  // ARMP Cameroun : AON N°001/MINPOSTEL/DGA/2026
  /(?:AON|AOI|DAO|DRP|DC|AMI)\s*N[°º]?\s*\d{2,}[/\-][A-Z]{2,}/i,
  // Référence numérotée générique : N°042/MINISTERE/2026
  /N[°º]\s*\d{2,}[/\-][A-Z]{2,}[/\-\w]*/i,
  // ARMP Bénin : F_PROMAC_119291
  /F_[A-Z0-9]{2,}_\d{4,}/i,
  // Portails francophones : Ref. 2026-0042 / REF-2026/042
  /\bREF[.\-:\s]*\d{4}[/\-]\d{2,}/i,
  // Identifiant numérique long autonome (ex : dossier 2026-0819)
  /\b\d{4}[/\-]\d{3,}\b/,
];

/**
 * Extrait une référence canonique depuis le texte (titre ou description).
 * Retourne null si aucun pattern ne correspond.
 */
function extractRefFromText(text: string): string | null {
  const t = (text ?? '').trim();
  if (!t) return null;
  for (const pattern of REFERENCE_PATTERNS) {
    const m = t.match(pattern);
    if (m?.[0]) {
      return normalizeForId(m[0]).slice(0, 96);
    }
  }
  return null;
}

/**
 * Extrait un paramètre d'identification stable depuis une URL.
 * Retire les tokens de session, CSRF et autres paramètres volatils.
 */
function extractRefFromUrl(rawUrl: string): string | null {
  const STABLE_PARAMS = ['id', 'dossier', 'ref', 'avis', 'publication', 'dao', 'appel'];
  const VOLATILE_PARAMS = ['token', 'session', 'csrf', 'nonce', 'timestamp', 'rand', 'sid'];
  try {
    const u = new URL(rawUrl);
    // Tenter d'abord un paramètre stable explicite
    for (const p of STABLE_PARAMS) {
      const v = u.searchParams.get(p);
      if (v && v.length >= 3) return normalizeForId(`${p}-${v}`).slice(0, 64);
    }
    // Utiliser le path si significatif (ex: /avis/detail/4821)
    const segments = u.pathname.split('/').filter((s) => s && /\d{3,}/.test(s));
    if (segments.length > 0) {
      // Vérifier qu'on n'a pas de paramètre volatile qui polluerait le path
      const hasVolatile = VOLATILE_PARAMS.some((p) => u.searchParams.has(p));
      if (!hasVolatile) {
        return normalizeForId(segments.join('-')).slice(0, 64);
      }
    }
    // Fallback : tous les params sauf les volatils
    const stableQuery = [...u.searchParams.entries()]
      .filter(([k]) => !VOLATILE_PARAMS.includes(k.toLowerCase()))
      .map(([k, v]) => `${k}-${v}`)
      .join('-');
    if (stableQuery.length >= 4) return normalizeForId(stableQuery).slice(0, 96);
  } catch {
    /* URL invalide */
  }
  return null;
}

/**
 * Dérive un code source court depuis un domaine (ex: "armp.cm" → "armp-cm").
 * Utilisé comme préfixe lisible dans le stableId final.
 */
function sourceCodeFromDomain(domain: string): string {
  return (domain ?? '')
    .replace(/^www\./i, '')
    .replace(/\.[a-z]{2,3}$/, (ext) => ext.replace('.', '-'))
    .replace(/[^a-z0-9\-]/gi, '-')
    .replace(/-+/g, '-')
    .slice(0, 20)
    .toLowerCase();
}

/**
 * Identifiant stable transverse (dédoublonnage multi-sources).
 *
 * Cascade d'identification en 4 niveaux :
 *   1. ID structuré fourni par la source (reference explicite)
 *   2. Référence extraite par regex depuis le titre ou la description
 *   3. Paramètre/path stable dans l'URL de la fiche détail
 *   4. Empreinte contenu : titre normalisé + autorité + année deadline
 *
 * Format final : "stb-{source_code}-{djb2hash(domain|ref:canonique)}"
 */
export function generateStableId(input: {
  domain: string;
  title: string;
  authority: string;
  publishedAtIso: string;
  reference?: string;
  descriptionHint?: string;
  detailUrlHint?: string;
}): string {
  const domain = normalizeForId(input.domain) || 'unknown';
  const sourceCode = sourceCodeFromDomain(input.domain);

  // ── Niveau 1 : ID structuré fourni explicitement par la source ──────────
  const rawRef = (input.reference ?? '').trim();
  if (rawRef && rawRef.length >= 4) {
    const canonicalRef = normalizeForId(rawRef).slice(0, 96);
    return `stb-${sourceCode}-${djb2Hash(`${domain}|ref:${canonicalRef}`)}`;
  }

  // ── Niveau 2 : Extraction par regex dans le titre puis la description ───
  const titleRef = extractRefFromText(input.title);
  if (titleRef) {
    return `stb-${sourceCode}-${djb2Hash(`${domain}|ref:${titleRef}`)}`;
  }
  const descRef = extractRefFromText(input.descriptionHint ?? '');
  if (descRef) {
    return `stb-${sourceCode}-${djb2Hash(`${domain}|ref:${descRef}`)}`;
  }

  // ── Niveau 3 : Paramètre ou path stable dans l'URL de la fiche détail ───
  const urlRef = extractRefFromUrl(input.detailUrlHint ?? '');
  if (urlRef) {
    return `stb-${sourceCode}-${djb2Hash(`${domain}|url:${urlRef}`)}`;
  }

  // ── Niveau 4 : Empreinte contenu (dernier recours) ───────────────────────
  const titleNorm = normalizeForId(input.title).slice(0, 80);
  const authorityNorm = normalizeForId(input.authority).slice(0, 40);
  const year = (input.publishedAtIso ?? '').slice(0, 4);
  const contentFp = [titleNorm, authorityNorm, year].filter(Boolean).join('|');
  return `stb-${sourceCode}-${djb2Hash(`${domain}|fp:${contentFp}`)}`;
}

/** Identifiant stable pour l’API / le front (les liens utilisent `encodeURIComponent` côté app). */
export function opportunityIdFromTender(t: ArmpTender): string {
  const typePublication = (t.typePublication ?? '').trim();
  const idPublication = (t.idPublication ?? '').trim();
  if (typePublication && idPublication) {
    return `armp-${typePublication}-${idPublication}`;
  }
  // Référence métier (ex. F_PROMAC_119291) — donnée la plus fiable sur les portails Bénin.
  if (idPublication.length >= 6 && /^F_[A-Z0-9_]+$/i.test(idPublication)) {
    const safe = idPublication.replace(/[^a-zA-Z0-9_\-]/g, '_');
    return `bj-ref-${safe}`;
  }
  const publishedAt = toIsoDate(t.publishedOn);
  const cleaned = cleanTitle(t.title ?? '');
  const domain =
    inferDomainFromTender(t) || normalizeForId(t.source) || 'unknown';
  return generateStableId({
    domain,
    title: cleaned,
    authority: (t.authority ?? '').trim(),
    publishedAtIso: publishedAt,
    reference: (t.idPublication ?? '').trim(),
    descriptionHint: `${t.type ?? ''} ${t.region ?? ''} ${t.amount ?? ''}`,
    detailUrlHint: (t.detailUrl ?? '').trim(),
  });
}

function monthNumberFromName(raw: string): string | null {
  const m = raw.trim().toLowerCase();
  const map: Record<string, string> = {
    jan: '01',
    january: '01',
    janvier: '01',
    feb: '02',
    february: '02',
    fev: '02',
    'février': '02',
    fevrier: '02',
    mar: '03',
    march: '03',
    mars: '03',
    apr: '04',
    april: '04',
    avr: '04',
    avril: '04',
    may: '05',
    mai: '05',
    jun: '06',
    june: '06',
    juin: '06',
    jul: '07',
    july: '07',
    juil: '07',
    juillet: '07',
    aug: '08',
    august: '08',
    aout: '08',
    août: '08',
    sep: '09',
    sept: '09',
    september: '09',
    septembre: '09',
    oct: '10',
    october: '10',
    octobre: '10',
    nov: '11',
    november: '11',
    novembre: '11',
    dec: '12',
    december: '12',
    decembre: '12',
    décembre: '12',
  };
  return map[m] ?? null;
}

/** Convertit une date en YYYY-MM-DD (support multi-formats). */
function toIsoDate(raw: string): string {
  const s = (raw ?? '').trim();
  if (!s) return new Date().toISOString().slice(0, 10);

  // dd/mm/yyyy, dd.mm.yyyy ou dd-mm-yyyy (l'ARMP utilise aussi le tiret).
  // NB : le tiret DOIT être géré ici, sinon la date tombe dans Date.parse()
  // qui l'interprète à l'américaine (MM-JJ) → inversion jour/mois.
  const fr = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (fr) {
    const d = fr[1].padStart(2, '0');
    const m = fr[2].padStart(2, '0');
    const y = fr[3];
    return `${y}-${m}-${d}`;
  }

  // yyyy/mm/dd
  const isoSlash = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (isoSlash) {
    const y = isoSlash[1];
    const m = isoSlash[2].padStart(2, '0');
    const d = isoSlash[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // "12 April 2026" / "12 avr 2026" / "12 avril 2026"
  const named = s.match(/^(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})/);
  if (named) {
    const d = named[1].padStart(2, '0');
    const month = monthNumberFromName(named[2]);
    const y = named[3];
    if (month) return `${y}-${month}-${d}`;
  }

  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);

  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function inferCountryFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const tld = host.split('.').filter(Boolean).at(-1) ?? '';
    const map: Record<string, string> = {
      bj: 'Bénin',
      cm: 'Cameroun',
      sn: 'Sénégal',
      ci: "Côte d’Ivoire",
      tg: 'Togo',
      ml: 'Mali',
      bf: 'Burkina Faso',
      ne: 'Niger',
      ga: 'Gabon',
      cd: 'RDC',
      cg: 'Congo',
    };
    return map[tld] ?? '';
  } catch {
    return '';
  }
}

function inferHostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function inferDomainFromTender(t: ArmpTender): string {
  const candidates = [
    (t.detailUrl ?? '').trim(),
    (t.downloadLink ?? '').trim(),
  ].filter(Boolean);
  for (const u of candidates) {
    const host = inferHostFromUrl(u);
    if (host) return host;
  }
  const src = String(t.source ?? '').trim();
  if (src) {
    const embedded = src.match(/\bhttps?:\/\/[^\s]+/i);
    if (embedded) return inferHostFromUrl(embedded[0]);
    if (!/\s/.test(src) && src.includes('.')) {
      try {
        const withProto = /^https?:/i.test(src) ? src : `https://${src}`;
        return inferHostFromUrl(withProto);
      } catch {
        /* ignore */
      }
    }
  }
  return '';
}

/** Complète la région lorsque le domaine (.bj / .cm) permet d'identifier le pays. */
function applyTldRegionHint(t: ArmpTender, region: string): string {
  const urls: string[] = [
    (t.detailUrl ?? '').trim(),
    (t.downloadLink ?? '').trim(),
  ].filter(Boolean);
  const src = String(t.source ?? '').trim();
  if (src && !/\s/.test(src) && src.includes('.')) {
    try {
      urls.push(/^https?:/i.test(src) ? src : `https://${src}`);
    } catch {
      /* */
    }
  }
  let hint = '';
  for (const u of urls) {
    try {
      const host = new URL(u).hostname.toLowerCase();
      if (host.endsWith('.bj')) {
        hint = 'Bénin';
        break;
      }
      if (host.endsWith('.cm')) {
        hint = 'Cameroun';
        break;
      }
    } catch {
      /* */
    }
  }
  if (!hint) return region;
  const r = region.trim();
  if (!r) return hint;
  if (r.toLowerCase().includes(hint.toLowerCase())) return r;
  return `${r} - ${hint}`;
}

function cleanTitle(raw: string): string {
  return (raw ?? '')
    .trim()
    .replace(/\b(voir le d[ée]tail|voir\s+d[ée]tails?|d[ée]tails?)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function inferCountryFromTender(t: ArmpTender): string {
  const candidates = [
    (t.detailUrl ?? '').trim(),
    (t.downloadLink ?? '').trim(),
  ].filter(Boolean);
  for (const u of candidates) {
    const country = inferCountryFromUrl(u);
    if (country) return country;
  }
  // Last resort: look for ccTLD in the "source" string if it contains a URL.
  const src = String(t.source ?? '');
  const match = src.match(/\bhttps?:\/\/[^\s]+/i);
  if (match) return inferCountryFromUrl(match[0]);
  return '';
}

function inferScope(t: ArmpTender): Opportunity['scope'] {
  const title = (t.title ?? '').toLowerCase();
  const type = (t.type ?? '').toLowerCase();
  const hay = `${title} ${type}`;
  const isInternational =
    hay.includes('international') ||
    hay.includes('ouvert aux entreprises étrangères') ||
    hay.includes('ouvert aux entreprises etrangeres') ||
    /\baoi\b/i.test(hay);
  if (isInternational) return 'International';
  const amount = extractAmountNumber(t.amount);
  if (amount !== null && amount >= 500_000_000) return 'International';
  return 'National';
}

export function extractAmountNumber(raw: string): number | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  // Keep digits only
  const digits = s.replace(/[^\d]/g, '');
  if (!digits) return null;
  try {
    const n = Number(digits);
    if (!Number.isFinite(n)) return null;
    return n;
  } catch {
    return null;
  }
}

function heuristicScore(t: ArmpTender): number {
  let s = 50;
  const amount = t.amount ?? '';
  if (amount && /\d/.test(amount)) s += 10;
  const title = (t.title ?? '').trim();
  if (title.length > 40) s += 5;
  const region = (t.region ?? '').trim();
  if (region) s += 5;
  const idPublication = (t.idPublication ?? '').trim();
  return Math.min(95, Math.max(25, s + (idPublication.length % 11)));
}

function heuristicRecommendation(score: number): Opportunity['recommendation'] {
  if (score >= 72) return 'soumission';
  if (score >= 50) return 'groupement';
  return 'non_recommande';
}

/**
 * Pays déduit du TLD (.bj / .cm) sur les URLs de la ligne, aligné sur `applyTldRegionHint`.
 * Permet d’avoir un pays même quand `inferCountryFromUrl` ne mappe pas le TLD.
 */
function inferCountryFromTldHints(t: ArmpTender): string {
  const urls: string[] = [
    (t.detailUrl ?? '').trim(),
    (t.downloadLink ?? '').trim(),
  ].filter(Boolean);
  const src = String(t.source ?? '').trim();
  if (src && !/\s/.test(src) && src.includes('.')) {
    try {
      urls.push(/^https?:/i.test(src) ? src : `https://${src}`);
    } catch {
      /* */
    }
  }
  for (const u of urls) {
    try {
      const host = new URL(u).hostname.toLowerCase();
      if (host.endsWith('.bj')) return 'Bénin';
      if (host.endsWith('.cm')) return 'Cameroun';
    } catch {
      /* */
    }
  }
  return '';
}

/** Pays pour l’affichage / filtres : URLs, domaine source, puis indices TLD .bj / .cm. */
function resolveCountryLabel(t: ArmpTender): string {
  const c0 = inferCountryFromTender(t);
  if (c0) return c0;
  const host = inferDomainFromTender(t);
  if (host) {
    const c1 = inferCountryFromUrl(`https://${host}/`);
    if (c1) return c1;
  }
  const c2 = inferCountryFromTldHints(t);
  if (c2) return c2;
  return '';
}

/**
 * Toujours inclure le pays dans `location` quand il est connu (filtre multi-pays côté front).
 * Si le pays reste indéterminé, la région seule est conservée ; sinon libellé minimal cohérent.
 */
function buildLocationWithCountry(regionWithHint: string, country: string): string {
  const r = (regionWithHint ?? '').trim();
  const c = (country ?? '').trim();
  if (!r && !c) return '—';
  if (!c) return r || '—';
  if (!r) return c;
  if (r.toLowerCase().includes(c.toLowerCase())) return r;
  return `${r} — ${c}`;
}

export function mapArmpTenderToOpportunity(t: ArmpTender): Opportunity {
  const publishedAt = toIsoDate(t.publishedOn);
  const deadlineRaw = (t.closingDate ?? '').trim();
  const deadline = deadlineRaw ? toIsoDate(deadlineRaw) : addDaysIso(publishedAt, 30);
  const amountNumber = extractAmountNumber(t.amount);
  const budget = (t.amount ?? '').trim() || 'Non communiqué';
  const country = resolveCountryLabel(t);
  const domainHost = inferDomainFromTender(t);
  const cleanedTitle = cleanTitle(t.title ?? '');
  const reference = (t.idPublication ?? '').trim();
  const typePublication = (t.typePublication ?? '').trim();
  const idPublication = (t.idPublication ?? '').trim();
  const id = opportunityIdFromTender(t);
  const stableId =
    typePublication && idPublication
      ? generateStableId({
          domain: domainHost || 'unknown',
          title: cleanedTitle,
          authority: (t.authority ?? '').trim(),
          publishedAtIso: publishedAt || new Date().toISOString().slice(0, 10),
          reference,
          descriptionHint: `${t.type ?? ''} ${t.region ?? ''} ${t.amount ?? ''}`,
          detailUrlHint: (t.detailUrl ?? '').trim(),
        })
      : id;
  const region = applyTldRegionHint(t, (t.region ?? '').trim());
  const location = buildLocationWithCountry(region, country);
  const domain = (t.type ?? '').trim() || 'Marchés publics';
  const score = heuristicScore(t);
  const scope = inferScope(t);

  const lines = [
    t.authority && `MO/AC / autorité : ${t.authority}`,
    t.type && `Type : ${t.type}`,
    t.region && `Région : ${t.region}`,
    (t.closingDate || t.closingTime) &&
      `Clôture : ${[t.closingDate, t.closingTime].filter(Boolean).join(' — ')}`,
    t.detailUrl && `Fiche : ${t.detailUrl}`,
    t.downloadLink && `Téléchargement : ${t.downloadLink}`,
    amountNumber !== null && `Montant (numérique) : ${amountNumber}`,
    country && `Pays : ${country}`,
    scope && `Marché : ${scope}`,
    stableId && `StableId : ${stableId}`,
  ].filter(Boolean) as string[];

  const description =
    lines.join('\n') ||
    `Avis extrait (${t.source}). Titre : ${t.title || '(sans titre)'}`;

  const sourceLabel =
    domainHost || (t.source ?? '').trim() || 'Source inconnue';

  return {
    id,
    stableId,
    title: cleanedTitle || `Avis ${((t.idPublication ?? '').trim() || id).slice(0, 40)}`,
    source: sourceLabel,
    publishedAt,
    deadline,
    budget,
    location,
    domain,
    scope,
    score,
    recommendation: heuristicRecommendation(score),
    status: 'nouveau',
    description,
    ...(t.internalFileId ? { internalFileId: t.internalFileId } : {}),
  };
}

export function mapMany(tenders: ArmpTender[]): Opportunity[] {
  const out: Opportunity[] = [];
  for (const t of tenders) {
    if (!t || typeof t !== 'object') continue;
    const opp = mapArmpTenderToOpportunity(t);
    out.push(opp);
  }
  return out;
}
