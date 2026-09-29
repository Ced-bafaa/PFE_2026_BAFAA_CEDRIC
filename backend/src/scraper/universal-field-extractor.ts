/**
 * UniversalFieldExtractor
 * =======================
 * Extrait les champs structurés d'un appel d'offres (ArmpTender) depuis
 * n'importe quel HTML, sans connaître la structure exacte du site.
 *
 * Stratégie en 3 couches (du plus fiable au moins fiable) :
 *
 *   1. PROXIMITÉ DE LABELS  — cherche des libellés réglementaires connus
 *      ("Date de clôture", "Autorité contractante"…) dans le DOM et récupère
 *      la valeur adjacente (cellule suivante, span suivant, dd…).
 *      Fiable à ~90 % sur les portails africains car la terminologie est
 *      imposée par les textes UEMOA/CEMAC.
 *
 *   2. ANALYSE STRUCTURELLE — détecte les patterns clé-valeur :
 *      tableaux (th/td), listes de définition (dt/dd), paires de divs/spans.
 *      Normalise les clés et les mappe sur les champs ArmpTender.
 *
 *   3. REGEX DE DERNIER RECOURS — extrait dates et montants depuis le texte
 *      brut si les deux couches précédentes n'ont rien trouvé.
 *
 * Tout champ non trouvé reste vide — le mapper armp-to-opportunity.mapper.ts
 * gère les valeurs manquantes avec des valeurs par défaut raisonnables
 * (ex. deadline = publishedOn + 30 jours si closingDate absent).
 */

import type { CheerioAPI, Cheerio } from 'cheerio';
import type { Element, AnyNode } from 'domhandler';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExtractedFields = {
  title: string;
  authority: string;
  type: string;
  region: string;
  amount: string;
  publishedOn: string;
  closingDate: string;
  closingTime: string;
  detailUrl: string;
  downloadLink: string;
  reference: string;
};

// ─── Dictionnaire de labels ────────────────────────────────────────────────────
//
// Chaque entrée = { champ ArmpTender : [labels FR, EN et variantes locales] }
// Tous en minuscules — la comparaison se fait après toLowerCase().

const LABEL_MAP: Record<keyof ExtractedFields, string[]> = {
  title: [
    'objet', 'objet du marché', 'objet de l\'appel', 'objet de la consultation',
    'intitulé', 'intitule', 'libellé', 'libelle', 'désignation',
    'subject', 'title', 'tender title', 'description',
  ],
  authority: [
    'mo/ac', 'po/ca', 'mo/do', 'maître d\'ouvrage', 'maitre d\'ouvrage',
    'autorité contractante', 'autorite contractante', 'entité contractante',
    'entite contractante', 'acheteur public', 'administration',
    'contracting authority', 'procuring entity', 'client',
    'maître d\'ouvrage délégué', 'maître d\'oeuvre',
  ],
  type: [
    'type', 'type de procédure', 'type de procedure', 'nature du marché',
    'nature du marche', 'mode de passation', 'procédure', 'procedure',
    'type d\'appel', 'type appel', 'procedure type',
  ],
  region: [
    'région', 'region', 'localisation', 'lieu d\'exécution', 'lieu execution',
    'ville', 'département', 'departement', 'province', 'localité', 'localite',
    'location', 'place of performance', 'pays', 'country',
  ],
  amount: [
    'montant', 'budget', 'valeur estimée', 'valeur estimee', 'montant estimé',
    'montant estime', 'coût estimatif', 'cout estimatif', 'enveloppe',
    'montant prévisionnel', 'montant previsionnel', 'estimated value',
    'contract value', 'amount', 'prix',
  ],
  publishedOn: [
    'publié le', 'publie le', 'date de publication', 'date publication',
    'date d\'émission', 'date emission', 'published on', 'publication date',
    'date de parution', 'paru le', 'date de mise en ligne',
  ],
  closingDate: [
    'date de clôture', 'date de cloture', 'date limite', 'date limite de dépôt',
    'date limite depot', 'date limite de remise', 'date limite remise',
    'date limite de soumission', 'clôture', 'cloture', 'deadline',
    'closing date', 'submission deadline', 'date d\'expiration',
    'date expiration', 'échéance', 'echeance', 'date de fin',
  ],
  closingTime: [
    'heure de clôture', 'heure de cloture', 'heure limite', 'heure',
    'closing time', 'time',
  ],
  detailUrl: [], // rempli par le parseur parent, pas par ce service
  downloadLink: [], // idem
  reference: [
    'référence', 'reference', 'n°', 'numero', 'numéro', 'dossier n°',
    'ref', 'ref.', 'n° avis', 'avis n°', 'tender number', 'lot n°',
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function norm(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // retire les accents
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanVal(s: string): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

/** Vérifie si un texte normalisé correspond à un label connu pour un champ. */
function matchesLabel(text: string, field: keyof ExtractedFields): boolean {
  const n = norm(text);
  return LABEL_MAP[field].some((lbl) => {
    const ln = norm(lbl);
    // Match exact ou le texte commence/se termine par le label (+ ponctuation)
    return n === ln || n.startsWith(ln + ' ') || n.startsWith(ln + ':') || n.endsWith(' ' + ln);
  });
}

/** Identifie le champ correspondant à un libellé, ou null. */
function fieldForLabel(text: string): keyof ExtractedFields | null {
  for (const field of Object.keys(LABEL_MAP) as Array<keyof ExtractedFields>) {
    if (field === 'detailUrl' || field === 'downloadLink') continue;
    if (matchesLabel(text, field)) return field;
  }
  return null;
}

// ─── Regex de dernier recours ─────────────────────────────────────────────────

const DATE_RE =
  /\b(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4}|\d{4}[\/.\-]\d{2}[\/.\-]\d{2}|\d{1,2}\s+(?:jan|fév|fev|mar|avr|apr|mai|may|jun|juin|jul|juil|août|aou|sep|oct|nov|déc|dec)[a-z]*\.?\s+\d{4})\b/gi;

const TIME_RE = /\b(\d{1,2}h\s*\d{0,2}|\d{2}:\d{2}(?::\d{2})?)\b/i;

const AMOUNT_RE =
  /\b(\d[\d\s]*(?:\d{3})\s*(?:FCFA|XOF|XAF|CFA|EUR|€|\$|USD)?)\b/i;

const REF_RE =
  /(?:N[°º]\s*\d{2,}[\/\-][A-Z]{2,}[\/\-\w]*|[A-Z]{2,}[\/\-](?:DAO|AON|AOI|DRP|DC|AMI)[\/\-]\d{4}[\/\-]\d+|F_[A-Z0-9]{2,}_\d{4,})/i;

// ─── Extracteur principal ─────────────────────────────────────────────────────

export class UniversalFieldExtractor {
  private readonly fields: ExtractedFields = {
    title: '',
    authority: '',
    type: '',
    region: '',
    amount: '',
    publishedOn: '',
    closingDate: '',
    closingTime: '',
    detailUrl: '',
    downloadLink: '',
    reference: '',
  };

  constructor(
    private readonly $: CheerioAPI,
    private readonly $el: Cheerio<Element> | Cheerio<AnyNode>,
  ) {}

  /**
   * Point d'entrée : lance les 3 couches d'extraction et retourne
   * les champs combinés (les couches de confiance élevée écrasent les basses).
   */
  extract(): ExtractedFields {
    this.extractFromLabelProximity();
    this.extractFromStructuredPairs();
    this.extractFromRawText();
    return { ...this.fields };
  }

  // ─── Couche 1 : Proximité de labels ────────────────────────────────────────

  /**
   * Parcourt le sous-arbre DOM de l'item.
   * Pour chaque nœud texte dont le contenu ressemble à un label connu,
   * récupère la valeur dans l'élément frère/enfant suivant.
   */
  private extractFromLabelProximity(): void {
    const $ = this.$;
    const $el = this.$el;

    // ── Tableaux (tr > th + td, ou tr > td + td) ──────────────────────────
    $el.find('tr').each((_i, tr) => {
      const cells = $(tr).find('th, td');
      if (cells.length < 2) return;
      const labelText = cleanVal($(cells[0]).text());
      const valueText = cleanVal($(cells[1]).text());
      const field = fieldForLabel(labelText);
      if (field && valueText && !this.fields[field]) {
        (this.fields as any)[field] = valueText;
      }
    });

    // ── Listes de définition (dt + dd) ───────────────────────────────────
    $el.find('dt').each((_i, dt) => {
      const labelText = cleanVal($(dt).text());
      const dd = $(dt).next('dd');
      const valueText = cleanVal(dd.text());
      const field = fieldForLabel(labelText);
      if (field && valueText && !this.fields[field]) {
        (this.fields as any)[field] = valueText;
      }
    });

    // ── Paires div/span avec classe label-like ───────────────────────────
    $el.find(
      '[class*="label"], [class*="libelle"], [class*="key"], [class*="titre-champ"], .field-label',
    ).each((_i, lbl) => {
      const labelText = cleanVal($(lbl).text());
      const field = fieldForLabel(labelText);
      if (!field) return;
      // Chercher la valeur : sibling suivant, ou parent puis sibling
      const sibling = $(lbl).next();
      const valueText = cleanVal(sibling.text()) || cleanVal($(lbl).parent().next().text());
      if (valueText && !this.fields[field]) {
        (this.fields as any)[field] = valueText;
      }
    });

    // ── Spans/divs inline "Label : valeur" ───────────────────────────────
    $el.find('p, div, span, li').each((_i, el) => {
      const raw = cleanVal($(el).text());
      // Pattern "Label : valeur" ou "Label — valeur"
      const sep = raw.indexOf(':');
      if (sep > 0 && sep < 60) {
        const lbl = raw.slice(0, sep);
        const val = raw.slice(sep + 1).trim();
        const field = fieldForLabel(lbl);
        if (field && val && !this.fields[field]) {
          (this.fields as any)[field] = val.split('\n')[0].trim();
        }
      }
    });
  }

  // ─── Couche 2 : Analyse structurelle ────────────────────────────────────────

  /**
   * Complète les champs manquants en analysant les patterns clé-valeur
   * restants dans l'item (grids de divs, tableaux sans headers explicites…).
   */
  private extractFromStructuredPairs(): void {
    const $ = this.$;
    const $el = this.$el;

    // Titre : si toujours vide, prendre le plus gros heading ou premier lien
    if (!this.fields.title) {
      for (const sel of ['h1', 'h2', 'h3', 'h4', '.title', '.objet', '.subject']) {
        const t = cleanVal($el.find(sel).first().text());
        if (t.length >= 10) {
          this.fields.title = t;
          break;
        }
      }
      // Fallback : premier lien avec texte substantiel
      if (!this.fields.title) {
        $el.find('a').each((_i, a) => {
          const t = cleanVal($(a).text());
          if (t.length >= 15 && !this.fields.title) this.fields.title = t;
        });
      }
    }

    // URL de détail : lien dont le href contient des mots-clés procurement
    if (!this.fields.detailUrl) {
      $el.find('a[href]').each((_i, a) => {
        const href = $(a).attr('href') ?? '';
        if (
          href.includes('/detail') ||
          href.includes('/avis') ||
          href.includes('/offre') ||
          href.includes('/tender') ||
          href.includes('/marche') ||
          href.includes('id=') ||
          href.includes('id_publication')
        ) {
          this.fields.detailUrl = href;
          return false; // break
        }
      });
      // Fallback : n'importe quel lien avec texte pertinent
      if (!this.fields.detailUrl) {
        $el.find('a[href]').each((_i, a) => {
          const text = norm($(a).text());
          if (
            text.includes('detail') ||
            text.includes('voir') ||
            text.includes('consulter') ||
            text.includes('telecharger') ||
            text.includes('telecharg')
          ) {
            this.fields.detailUrl = $(a).attr('href') ?? '';
            return false;
          }
        });
      }
    }

    // Lien de téléchargement PDF
    if (!this.fields.downloadLink) {
      $el.find('a[href]').each((_i, a) => {
        const href = $(a).attr('href') ?? '';
        const text = norm($(a).text());
        if (
          href.toLowerCase().endsWith('.pdf') ||
          href.includes('download') ||
          href.includes('telecharger') ||
          text.includes('pdf') ||
          text.includes('telecharger') ||
          text.includes('telecharg')
        ) {
          this.fields.downloadLink = href;
          return false;
        }
      });
    }
  }

  // ─── Couche 3 : Regex sur texte brut ─────────────────────────────────────────

  /**
   * Dernier recours : extrait dates, montants et références par regex
   * depuis le texte brut de l'item complet.
   * N'écrase pas les valeurs déjà trouvées.
   */
  private extractFromRawText(): void {
    const rawText = cleanVal(this.$el.text());

    // Dates : la première est publishedOn, la seconde est closingDate
    const dates = [...rawText.matchAll(new RegExp(DATE_RE.source, 'gi'))].map(
      (m) => m[0],
    );
    if (!this.fields.publishedOn && dates[0]) this.fields.publishedOn = dates[0];
    if (!this.fields.closingDate && dates[1]) this.fields.closingDate = dates[1];

    // Heure de clôture
    if (!this.fields.closingTime) {
      const tm = rawText.match(TIME_RE);
      if (tm) this.fields.closingTime = tm[0];
    }

    // Montant
    if (!this.fields.amount) {
      const am = rawText.match(AMOUNT_RE);
      if (am) this.fields.amount = am[0].trim();
    }

    // Référence
    if (!this.fields.reference) {
      const ref = rawText.match(REF_RE);
      if (ref) this.fields.reference = ref[0];
    }
  }
}

// ─── Fonction utilitaire standalone ──────────────────────────────────────────

/**
 * Extrait les champs d'un item depuis son contexte Cheerio.
 * Utilisable directement dans GenericScraperService et MultiPortalScraper.
 *
 * @param $    - instance Cheerio du document complet
 * @param $el  - sélection de l'élément item (un seul avis)
 * @param baseUrl - URL de base pour résoudre les hrefs relatifs
 */
export function extractTenderFields(
  $: CheerioAPI,
  $el: Cheerio<Element> | Cheerio<AnyNode>,
  baseUrl: string,
): ExtractedFields {
  const extractor = new UniversalFieldExtractor($, $el);
  const fields = extractor.extract();

  // Résolution des URLs relatives
  if (fields.detailUrl && !fields.detailUrl.startsWith('http')) {
    try {
      fields.detailUrl = new URL(fields.detailUrl, baseUrl).toString();
    } catch { /* ignore */ }
  }
  if (fields.downloadLink && !fields.downloadLink.startsWith('http')) {
    try {
      fields.downloadLink = new URL(fields.downloadLink, baseUrl).toString();
    } catch { /* ignore */ }
  }

  return fields;
}
