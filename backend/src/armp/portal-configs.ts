/**
 * Registre des portails publics de marchés en Afrique francophone.
 *
 * Sources de configs (fusionnées au runtime) :
 *   1. PORTAL_CONFIGS_STATIC  — configs TypeScript hardcodées (haute priorité)
 *   2. data/portal-configs.json — configs JSON éditables à chaud (sans recompilation)
 *
 * Pour ajouter un nouveau portail sans toucher au code :
 *   → Éditer data/portal-configs.json et relancer le scrape.
 *
 * Mis à jour après simulation (03/06/2026) :
 *   - anrmp.ci remplacé par arcop.ci (ANRMP renommée ARCOP)
 *   - CMS réels confirmés : WordPress (ARCOP CI), dgmp-table (marchespublics.ci)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CmsType =
  /** ARMP Cameroun et portails sous le même moteur Pridesoft */
  | 'pridesoft'
  /** Joomla com_loffres */
  | 'joomla-loffres'
  /** WordPress + plugin WP File Download (ARCOP Côte d'Ivoire) */
  | 'wordpress'
  /** Tableau HTML positionnel — portails custom (DGMP CI, marchespublics.ci) */
  | 'dgmp-table'
  /** Fallback générique multi-sélecteurs cheerio */
  | 'generic';

/**
 * Mapping des colonnes d'un tableau positionnel (cms = 'dgmp-table').
 * Index 0-based. Un index à -1 = colonne absente.
 */
export type TableColumnMap = {
  reference: number;   // N° AO / référence
  type: number;        // Type de marché
  title: number;       // Objet
  authority: number;   // Autorité contractante
  publishedOn: number; // Date de publication
  closingDate: number; // Date limite
  detailLink: number;  // Colonne contenant un lien <a> vers la fiche détail (-1 si absent)
};

export type PortalConfig = {
  /** Identifiant court unique (préfixe opportunité). */
  id: string;
  country: string;
  countryCode: string;
  name: string;
  baseUrl: string;
  /**
   * URL d'entrée de la liste des avis (page 1).
   * Pour les portails Pridesoft qui redirigent depuis la home,
   * mettre directement l'URL /filtres?type=avis&val=1.
   */
  listUrl: string;
  hosts: string[];
  cms: CmsType;
  /** Paramètre URL pour pagination par numéro de page (ex. "page"). */
  paginationPageParam?: string;
  /** Paramètre URL pour pagination par offset (ex. "limitstart" Joomla). */
  paginationOffsetParam?: string;
  itemsPerPage?: number;
  maxPages?: number;
  /**
   * Mapping des colonnes pour cms = 'dgmp-table'.
   * Si absent, utilise le mapping par défaut de marchespublics.ci.
   */
  columnMap?: TableColumnMap;
  /**
   * Sélecteur CSS pour les items de tableau (défaut: 'table tbody tr').
   * Utile pour les sites avec plusieurs tableaux sur la page.
   */
  tableSelector?: string;
};

// ─── Mapping de colonnes par défaut (marchespublics.ci confirmé) ─────────────

export const DEFAULT_DGMP_COLUMN_MAP: TableColumnMap = {
  reference: 0,
  type: 1,
  title: 2,
  authority: 3,
  publishedOn: 4,
  closingDate: 5,
  detailLink: 2, // le titre est souvent le lien vers le détail
};

// ─── Configs hardcodées (haute priorité) ─────────────────────────────────────

const PORTAL_CONFIGS_STATIC: PortalConfig[] = [
  // ── Sénégal ─────────────────────────────────────────────────────────────
  {
    id: 'sn-dcmp',
    country: 'Sénégal',
    countryCode: 'SN',
    name: 'DCMP Sénégal — Marchés Publics',
    baseUrl: 'https://www.marchespublics.sn',
    listUrl: 'https://www.marchespublics.sn/index.php?option=com_loffres&Itemid=104',
    hosts: ['marchespublics.sn'],
    cms: 'joomla-loffres',
    paginationOffsetParam: 'limitstart',
    itemsPerPage: 15,
    // Arrêt incrémental activé → maxPages élevé sans risque de surcharge
    maxPages: 50,
  },

  // ── Côte d'Ivoire ─────────────────────────────────────────────────────────
  {
    id: 'ci-arcop',
    country: "Côte d'Ivoire",
    countryCode: 'CI',
    name: "ARCOP Côte d'Ivoire (ex-ANRMP)",
    baseUrl: 'https://arcop.ci',
    listUrl: 'https://arcop.ci/docutheque/annonces/avis-dappel-doffres',
    // anrmp.ci redirige vers arcop.ci — on gère les deux
    hosts: ['arcop.ci', 'anrmp.ci', 'www.arcop.ci', 'www.anrmp.ci'],
    // Confirmé simulation : WordPress + WP File Download
    // Structure : table tbody tr — colonnes Fichier, Vues, Date, Télécharger
    cms: 'wordpress',
    tableSelector: 'table tbody tr',
    maxPages: 1, // tout sur une page (pas de pagination WP File Download)
  },
  {
    id: 'ci-marchespublics',
    country: "Côte d'Ivoire",
    countryCode: 'CI',
    name: 'DGMP — Marchés Publics CI',
    baseUrl: 'https://www.marchespublics.ci',
    listUrl: 'https://www.marchespublics.ci/appel_offre',
    hosts: ['marchespublics.ci'],
    // Confirmé simulation : PHP custom, tableau positionnel
    // Colonnes : N° AO | Type marché | Objet | Autorité | Date pub | Date limite
    cms: 'dgmp-table',
    columnMap: DEFAULT_DGMP_COLUMN_MAP,
    tableSelector: 'table tbody tr',
    paginationPageParam: 'page',
    // Arrêt incrémental activé → maxPages élevé sans risque de surcharge
    maxPages: 50,
  },

  // ── Bénin ─────────────────────────────────────────────────────────────────
  {
    id: 'bj-armp',
    country: 'Bénin',
    countryCode: 'BJ',
    name: 'ARMP Bénin',
    baseUrl: 'https://www.armp.bj',
    listUrl: 'https://www.armp.bj/index.php/appels-a-concurrence',
    hosts: ['armp.bj', 'simp.gouv.bj', 'dgmp.bj'],
    cms: 'generic',
    paginationPageParam: 'start',
    // Arrêt incrémental activé → maxPages élevé sans risque de surcharge
    maxPages: 50,
  },

  // ── Burkina Faso ─────────────────────────────────────────────────────────
  {
    id: 'bf-arcop',
    country: 'Burkina Faso',
    countryCode: 'BF',
    name: 'ARCOP Burkina Faso',
    baseUrl: 'https://www.arcop.bf',
    listUrl: 'https://www.arcop.bf/index.php/marches-publics/avis-dappels-doffres',
    hosts: ['arcop.bf'],
    cms: 'generic',
    paginationPageParam: 'start',
    // Arrêt incrémental activé → maxPages élevé sans risque de surcharge
    maxPages: 50,
  },
  {
    id: 'bf-marchespublics',
    country: 'Burkina Faso',
    countryCode: 'BF',
    name: 'Marchés Publics Burkina Faso',
    baseUrl: 'https://www.marchespublics.gov.bf',
    listUrl: 'https://www.marchespublics.gov.bf/index.php/appel-offres',
    hosts: ['marchespublics.gov.bf'],
    cms: 'generic',
    paginationPageParam: 'page',
    // Arrêt incrémental activé → maxPages élevé sans risque de surcharge
    maxPages: 50,
  },

  // ── Mali ─────────────────────────────────────────────────────────────────
  {
    id: 'ml-dgmp',
    country: 'Mali',
    countryCode: 'ML',
    name: 'DGMP Mali',
    baseUrl: 'https://www.dgmp.gouv.ml',
    listUrl: 'https://www.dgmp.gouv.ml/index.php/marches-publics/avis-dappels-doffres',
    hosts: ['dgmp.gouv.ml', 'marchespublics.ml'],
    cms: 'generic',
    paginationPageParam: 'page',
    // Arrêt incrémental activé → maxPages élevé sans risque de surcharge
    maxPages: 50,
  },

  // ── Niger ─────────────────────────────────────────────────────────────────
  {
    id: 'ne-armp',
    country: 'Niger',
    countryCode: 'NE',
    name: 'ARMP Niger',
    baseUrl: 'https://www.armp-niger.ne',
    listUrl: 'https://www.armp-niger.ne/index.php/appels-offres',
    hosts: ['armp-niger.ne', 'marchespublics.ne'],
    cms: 'generic',
    paginationPageParam: 'page',
    // Arrêt incrémental activé → maxPages élevé sans risque de surcharge
    maxPages: 50,
  },

  // ── Togo ─────────────────────────────────────────────────────────────────
  {
    id: 'tg-dncmp',
    country: 'Togo',
    countryCode: 'TG',
    name: 'DNCMP Togo',
    baseUrl: 'https://www.marchespublics.gouv.tg',
    listUrl: 'https://www.marchespublics.gouv.tg/index.php/appels-offres',
    hosts: ['marchespublics.gouv.tg', 'dncmp.tg'],
    cms: 'generic',
    paginationPageParam: 'page',
    // Arrêt incrémental activé → maxPages élevé sans risque de surcharge
    maxPages: 50,
  },

  // ── Guinée ───────────────────────────────────────────────────────────────
  {
    id: 'gn-armp',
    country: 'Guinée',
    countryCode: 'GN',
    name: 'ARMP Guinée',
    baseUrl: 'https://www.armp-guinee.com',
    listUrl: 'https://www.armp-guinee.com/index.php/appels-offres',
    hosts: ['armp-guinee.com', 'marchespublics.gov.gn'],
    cms: 'generic',
    paginationPageParam: 'page',
    // Arrêt incrémental activé → maxPages élevé sans risque de surcharge
    maxPages: 50,
  },

  // ── Gabon ────────────────────────────────────────────────────────────────
  {
    id: 'ga-dgmp',
    country: 'Gabon',
    countryCode: 'GA',
    name: 'DGMP Gabon',
    baseUrl: 'https://www.dgmp.gouv.ga',
    listUrl: 'https://www.dgmp.gouv.ga/index.php/appels-offres',
    hosts: ['dgmp.gouv.ga', 'marchespublics.ga'],
    cms: 'generic',
    paginationPageParam: 'page',
    // Arrêt incrémental activé → maxPages élevé sans risque de surcharge
    maxPages: 50,
  },

  // ── RDC ─────────────────────────────────────────────────────────────────
  {
    id: 'cd-armp',
    country: 'RDC',
    countryCode: 'CD',
    name: 'ARMP RDC',
    baseUrl: 'https://www.armp.cd',
    listUrl: 'https://www.armp.cd/index.php/appels-offres',
    hosts: ['armp.cd'],
    cms: 'generic',
    paginationPageParam: 'page',
    // Arrêt incrémental activé → maxPages élevé sans risque de surcharge
    maxPages: 50,
  },
];

// ─── Loader JSON dynamique ────────────────────────────────────────────────────

type JsonCache = {
  configs: PortalConfig[];
  mtime: number; // ms — date de modification du fichier
};

let jsonCache: JsonCache | null = null;

/** Chemin vers le fichier JSON éditables à chaud. */
function jsonConfigPath(): string {
  // Cherche data/portal-configs.json à partir de la racine du projet (process.cwd())
  // puis remonte d'un niveau si nécessaire (monorepo).
  const candidates = [
    path.join(process.cwd(), 'data', 'portal-configs.json'),
    path.join(process.cwd(), '..', 'data', 'portal-configs.json'),
    path.join(__dirname, '..', '..', 'data', 'portal-configs.json'),
  ];
  return candidates.find((p) => {
    try { fs.accessSync(p); return true; } catch { return false; }
  }) ?? candidates[0];
}

/**
 * Charge les configs depuis le JSON avec cache invalidé par mtime.
 * Ne plante jamais — retourne [] en cas d'erreur.
 */
function loadJsonConfigs(): PortalConfig[] {
  const filePath = jsonConfigPath();
  try {
    const stat = fs.statSync(filePath);
    const mtime = stat.mtimeMs;
    if (jsonCache && jsonCache.mtime === mtime) {
      return jsonCache.configs;
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as PortalConfig[];
    if (!Array.isArray(parsed)) return [];
    jsonCache = { configs: parsed, mtime };
    return parsed;
  } catch {
    return [];
  }
}

/**
 * Retourne la liste fusionnée : configs TypeScript + configs JSON.
 * Les configs TypeScript ont priorité (même `id` → TypeScript écrase JSON).
 */
export function getAllPortalConfigs(): PortalConfig[] {
  const jsonConfigs = loadJsonConfigs();
  const staticIds = new Set(PORTAL_CONFIGS_STATIC.map((c) => c.id));
  // N'ajouter que les configs JSON dont l'id n'existe pas déjà en TypeScript
  const uniqueJsonConfigs = jsonConfigs.filter((c) => !staticIds.has(c.id));
  return [...PORTAL_CONFIGS_STATIC, ...uniqueJsonConfigs];
}

// ─── Lookup ───────────────────────────────────────────────────────────────────

/**
 * Trouve la config d'un portail à partir d'une URL.
 * Cherche dans les configs TypeScript ET JSON (JSON rechargé si le fichier a changé).
 */
export function findPortalConfig(url: string): PortalConfig | null {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    host = String(url).toLowerCase();
  }

  const all = getAllPortalConfigs();
  return (
    all.find((cfg) =>
      cfg.hosts.some((h) => {
        const hn = h.replace(/^www\./i, '').toLowerCase();
        return host === hn || host.endsWith(`.${hn}`);
      }),
    ) ?? null
  );
}
