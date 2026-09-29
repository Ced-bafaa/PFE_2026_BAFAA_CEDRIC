import type { Opportunity } from '../seed/mock-data';
import type {
  ExtractedSectionDto,
  OpportunityExtractedDetailsDto,
} from './opportunity-extracted-details.types';

const SECTION_LABELS: Record<string, string> = {
  pieces_administratives: 'Pièces administratives',
  penalites_garanties: 'Pénalités et garanties',
  capacites_financieres: 'Capacités financières',
  criteres_qualification: 'Critères de qualification',
  exigences_techniques: 'Exigences techniques',
  criteres_evaluation: 'Critères d’évaluation',
  personnel_cle: 'Personnel clé',
};

const EXCERPT_MAX = 1400;
const EMPTY_MARKERS = new Set(['non trouvé', 'non trouve', 'n/a', '']);

function cleanText(value: unknown): string | undefined {
  const s = String(value ?? '').trim();
  if (!s || EMPTY_MARKERS.has(s.toLowerCase())) return undefined;
  return s;
}

function truncate(text: string, max = EXCERPT_MAX): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trim()}…`;
}

function mapSections(
  sections: unknown,
  keys?: string[],
): ExtractedSectionDto[] {
  if (!sections || typeof sections !== 'object') return [];
  const entries = keys
    ? keys.map((k) => [k, (sections as Record<string, unknown>)[k]] as const)
    : Object.entries(sections as Record<string, unknown>);

  const out: ExtractedSectionDto[] = [];
  for (const [key, block] of entries) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    const found = Boolean(b.found);
    const raw = cleanText(b.text);
    out.push({
      key,
      label: SECTION_LABELS[key] ?? key.replace(/_/g, ' '),
      found,
      ...(raw ? { excerpt: truncate(raw) } : {}),
    });
  }
  return out;
}

function formatFcfa(value: unknown): string | undefined {
  if (value == null || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/\s/g, ''));
  if (Number.isFinite(n) && n > 0) {
    return `${n.toLocaleString('fr-FR')} FCFA`;
  }
  const s = cleanText(value);
  return s;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((x) => String(x).trim()).filter(Boolean);
}

export function buildExtractedDetailsFromEnrichment(
  enrichment: Record<string, unknown> | null | undefined,
): OpportunityExtractedDetailsDto | null {
  const extractor = enrichment?.extractor;
  if (!extractor || typeof extractor !== 'object') return null;

  const ext = extractor as Record<string, unknown>;
  const adm = (ext.administratif ?? {}) as Record<string, unknown>;
  const fin = (ext.financier ?? {}) as Record<string, unknown>;
  const tech = (ext.technique ?? {}) as Record<string, unknown>;
  const meta = (ext.meta ?? {}) as Record<string, unknown>;
  const dates = (adm.dates ?? {}) as Record<string, unknown>;
  const contacts = (adm.contacts ?? {}) as Record<string, unknown>;

  const decision = enrichment?.decision as Record<string, unknown> | undefined;
  const extractedAt =
    typeof decision?.scoredAt === 'string' ? decision.scoredAt : undefined;

  const lots = Array.isArray(fin.lots)
    ? (fin.lots as Array<Record<string, unknown>>)
    : undefined;

  return {
    ...(extractedAt ? { extractedAt } : {}),
    administrative: {
      ...(cleanText(adm.reference) ? { reference: cleanText(adm.reference) } : {}),
      ...(cleanText(adm.procedure_type)
        ? { procedureType: cleanText(adm.procedure_type) }
        : {}),
      ...(cleanText(adm.maitre_ouvrage)
        ? { authority: cleanText(adm.maitre_ouvrage) }
        : {}),
      ...(cleanText(adm.objet) ? { subject: truncate(cleanText(adm.objet)!, 800) } : {}),
      ...(cleanText(adm.financement) ? { financing: cleanText(adm.financement) } : {}),
      contacts: {
        emails: stringList(contacts.emails),
        phones: stringList(contacts.phones),
      },
      dates: {
        ...(cleanText(dates.remise_offres_block)
          ? { remiseOffres: truncate(cleanText(dates.remise_offres_block)!) }
          : {}),
        ...(cleanText(dates.ouverture_plis_block)
          ? { ouverturePlis: truncate(cleanText(dates.ouverture_plis_block)!) }
          : {}),
        ...(stringList(dates.remise_offres_dates_iso).length
          ? { remiseOffresIso: stringList(dates.remise_offres_dates_iso) }
          : {}),
        ...(stringList(dates.ouverture_plis_dates_iso).length
          ? { ouverturePlisIso: stringList(dates.ouverture_plis_dates_iso) }
          : {}),
      },
      sections: mapSections(adm.sections),
    },
    financial: {
      ...(formatFcfa(fin.budget_global)
        ? { budgetGlobal: formatFcfa(fin.budget_global) }
        : {}),
      ...(formatFcfa(fin.caution_global)
        ? { cautionGlobal: formatFcfa(fin.caution_global) }
        : {}),
      ...(typeof fin.allotissement_count === 'number'
        ? { allotissementCount: fin.allotissement_count }
        : {}),
      ...(typeof fin.lots_detectes === 'number'
        ? { lotsDetected: fin.lots_detectes }
        : {}),
      ...(cleanText(fin.delai_global) ? { delaiGlobal: cleanText(fin.delai_global) } : {}),
      ...(lots?.length ? { lots } : {}),
    },
    technical: {
      keywords: stringList(tech.tech_stack_keywords),
      baremePoints: Array.isArray(tech.bareme_points)
        ? (tech.bareme_points as Array<Record<string, unknown>>)
        : [],
      sections: mapSections(tech.sections),
    },
    meta: {
      ...(typeof meta.pages === 'number' ? { pages: meta.pages } : {}),
      ...(typeof meta.ocr_used === 'boolean' ? { ocrUsed: meta.ocr_used } : {}),
      ...(meta.sections_found && typeof meta.sections_found === 'object'
        ? { sectionsFound: meta.sections_found as Record<string, boolean> }
        : {}),
    },
  };
}

export function attachExtractedDetails(o: Opportunity): Opportunity {
  const details = buildExtractedDetailsFromEnrichment(
    o.enrichment as Record<string, unknown> | undefined,
  );
  if (!details) return o;
  return { ...o, extractedDetails: details };
}
