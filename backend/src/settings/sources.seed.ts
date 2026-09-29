import type { SourcesSettings } from './sources.types';

/** Liste IT par défaut — synchronisée avec decision_engine/data/company_profile.json */
export const DEFAULT_IT_KEYWORDS: string[] = [
  'informatiq', 'numérique', 'digital', 'technologi', 'cyber',
  'télécommunication', 'télécom', 'TIC',
  'logiciel', 'software',
  'application mobile', 'application web', 'application informatique',
  'application de gestion', 'application de suivi',
  "système d'information", 'système informatique',
  'plateforme numérique', 'plateforme informatique', 'plateforme web',
  'plateforme digitale', 'plateforme de gestion',
  'portail web', 'portail numérique', 'portail en ligne',
  'site web', 'intranet', 'extranet',
  'e-gouvern', 'e-service', 'e-administration',
  'ERP', 'SIGFIP', 'SIGIPES',
  'CENADI', 'ANTIC', 'CAMTEL', 'SYSTAC', 'GUCE', 'MINPOSTEL',
  'solution informatique', 'solution numérique', 'solution digitale',
  'acquisition de matériel informatique',
  'fourniture de matériel informatique',
  'fourniture et installation de matériel informatique',
  'support informatique', 'support technique informatique',
  'assistance informatique', 'assistance technique informatique',
  'câblage informatique', 'câblage réseau',
  'base de données', 'database', 'datacenter', 'data center',
  "développement de logiciel", "développement d'application",
  'développement de système', 'développement de plateforme',
  'conception de logiciel', 'conception de système',
  'déploiement de logiciel', 'déploiement de système',
  'intégration de système', 'migration informatique',
  'informatisation', 'numérisation', 'digitalisation', 'dématérialisati',
  'réseau informatique', 'réseau local', 'réseau LAN', 'réseau WAN',
  'fibre optique', 'haut débit', 'très haut débit',
  'infrastructure informatique', 'infrastructure IT', 'infrastructure numérique',
  'serveur informatique', 'serveur web', 'serveur applicatif',
  'cloud computing', 'cloud informatique', 'cloud privé', 'cloud public',
  'virtualisation', 'hébergement web', 'hébergement serveur',
  'parc informatique', 'maintenance informatique',
  'matériel informatique', 'équipement informatique',
  'ordinateur', 'laptop', 'tablette numérique',
  'switch réseau', 'routeur informatique', 'firewall', 'pare-feu informatique',
  'sauvegarde informatique', 'backup informatique',
  'intelligence artificielle', 'machine learning', 'big data',
  'data science', 'business intelligence',
  'cybersécurité', 'sécurité informatique',
  "sécurité des systèmes d'information",
  'audit informatique', 'audit de sécurité informatique',
  'schéma directeur informatique', 'pentest',
  'formation en informatique', 'formation informatique',
  'formation numérique', 'formation cybersécurité',
  'IT equipment', 'IT support', 'IT services', 'IT infrastructure',
  'information system', 'information technology',
  'computer equipment', 'software development', 'network equipment',
  'ICT', 'connectivity internet', 'accès internet',
  'imprimantes',
];

export const sourcesSettingsSeed: SourcesSettings = {
  globalKeywords: DEFAULT_IT_KEYWORDS,
  sources: [
    // ── Cameroun ────────────────────────────────────────────────────────────
    {
      id: 'SRC-001',
      title: 'ARMP Cameroun — Appels d\'offres nationaux',
      url: 'https://www.armp.cm/filtres?type=avis&val=1',
      active: true,
      keywords: [],
    },
    {
      id: 'SRC-002',
      title: 'ARMP Cameroun — Appels d\'offres internationaux',
      url: 'https://www.armp.cm/filtres?type=avis&val=4',
      active: true,
      keywords: [],
    },
    {
      id: 'SRC-003',
      title: 'ARMP Cameroun — Demandes de cotation',
      // val=5 (et non 2, qui était erroné et ne renvoyait pas les cotations)
      url: 'https://www.armp.cm/filtres?type=avis&val=5',
      active: true,
      keywords: [],
    },
    {
      id: 'SRC-004',
      title: "ARMP Cameroun — Appels à manifestation d'intérêt (AMI)",
      // val=12 : flux des prestations intellectuelles (consultants, études, AMOA…)
      url: 'https://www.armp.cm/filtres?type=avis&val=12',
      active: true,
      keywords: [],
    },
    {
      id: 'SRC-005',
      title: 'ARMP Cameroun — Demandes de proposition (DP)',
      url: 'https://www.armp.cm/filtres?type=avis&val=7',
      active: true,
      keywords: [],
    },
    // ── Sénégal ─────────────────────────────────────────────────────────────
    {
      id: 'SRC-010',
      title: 'DCMP Sénégal — Marchés Publics',
      url: 'https://www.marchespublics.sn/index.php?option=com_loffres&Itemid=104',
      active: false,
      keywords: [],
    },
    // ── Côte d'Ivoire ────────────────────────────────────────────────────────
    {
      id: 'SRC-020',
      title: 'ARCOP Côte d\'Ivoire (ex-ANRMP)',
      url: 'https://arcop.ci/docutheque/annonces/avis-dappel-doffres',
      active: false,
      keywords: [],
    },
    {
      id: 'SRC-021',
      title: 'Marchés Publics CI',
      url: 'https://www.marchespublics.ci/appel_offre',
      active: false,
      keywords: [],
    },
    // ── Bénin ────────────────────────────────────────────────────────────────
    {
      id: 'SRC-030',
      title: 'ARMP Bénin',
      url: 'https://www.armp.bj/index.php/appels-a-concurrence',
      active: false,
      keywords: [],
    },
    // ── Burkina Faso ─────────────────────────────────────────────────────────
    {
      id: 'SRC-040',
      title: 'ARCOP Burkina Faso',
      url: 'https://www.arcop.bf/index.php/marches-publics/avis-dappels-doffres',
      active: false,
      keywords: [],
    },
    {
      id: 'SRC-041',
      title: 'Marchés Publics Burkina Faso',
      url: 'https://www.marchespublics.gov.bf/index.php/appel-offres',
      active: false,
      keywords: [],
    },
    // ── Mali ─────────────────────────────────────────────────────────────────
    {
      id: 'SRC-050',
      title: 'DGMP Mali',
      url: 'https://www.dgmp.gouv.ml/index.php/marches-publics/avis-dappels-doffres',
      active: false,
      keywords: [],
    },
    // ── Niger ─────────────────────────────────────────────────────────────────
    {
      id: 'SRC-060',
      title: 'ARMP Niger',
      url: 'https://www.armp-niger.ne/index.php/appels-offres',
      active: false,
      keywords: [],
    },
    // ── Togo ─────────────────────────────────────────────────────────────────
    {
      id: 'SRC-070',
      title: 'DNCMP Togo',
      url: 'https://www.marchespublics.gouv.tg/index.php/appels-offres',
      active: false,
      keywords: [],
    },
    // ── Guinée ───────────────────────────────────────────────────────────────
    {
      id: 'SRC-080',
      title: 'ARMP Guinée',
      url: 'https://www.armp-guinee.com/index.php/appels-offres',
      active: false,
      keywords: [],
    },
    // ── Gabon ────────────────────────────────────────────────────────────────
    {
      id: 'SRC-090',
      title: 'DGMP Gabon',
      url: 'https://www.dgmp.gouv.ga/index.php/appels-offres',
      active: false,
      keywords: [],
    },
    // ── RDC ─────────────────────────────────────────────────────────────────
    {
      id: 'SRC-100',
      title: 'ARMP RDC',
      url: 'https://www.armp.cd/index.php/appels-offres',
      active: false,
      keywords: [],
    },
  ],
  companyDescription:
    "Entreprise spécialisée en systèmes d'information, développement logiciel, intelligence artificielle et transformation numérique. Expertise en conception et déploiement de solutions informatiques pour les secteurs public et privé.",
  companyDomains: [
    "Systèmes d'information",
    'Développement logiciel',
    'Intelligence artificielle',
    'Transformation numérique',
    'Infrastructure informatique',
    'Applications web et mobiles',
    'Big Data et Analytics',
    'Cybersécurité',
  ],
};
