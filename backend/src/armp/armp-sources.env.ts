import type { ArmpSource } from './armp-tender.types';

// Codes `val` du portail ARMP (vérifiés sur le menu « Type de procédure », 22/06/2026) :
// 1=AON, 4=International, 5=Demande de Cotation, 7=Demande de Proposition,
// 12=Appel à Manifestation d'Intérêt. (NB : l'ancien val=2 était erroné — il ne
// renvoyait pas les cotations.)
const DEFAULT_SOURCES: ArmpSource[] = [
  {
    name: "Appels d'offres nationaux",
    url: 'https://armp.cm/filtres?type=avis&val=1',
  },
  {
    name: "Appels d'offres internationaux",
    url: 'https://armp.cm/filtres?type=avis&val=4',
  },
  {
    name: 'Demandes de cotation',
    url: 'https://armp.cm/filtres?type=avis&val=5',
  },
  {
    name: "Appels à manifestation d'intérêt (AMI)",
    url: 'https://armp.cm/filtres?type=avis&val=12',
  },
  {
    name: 'Demandes de proposition (DP)',
    url: 'https://armp.cm/filtres?type=avis&val=7',
  },
];

export function parseArmpSourcesEnv(): ArmpSource[] {
  const raw = process.env.ARMP_SOURCES?.trim();
  if (!raw) return DEFAULT_SOURCES;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_SOURCES;
    return parsed
      .filter(
        (s): s is ArmpSource =>
          Boolean(s && typeof s === 'object' && 'name' in s && 'url' in s),
      )
      .map((s) => ({ name: String(s.name), url: String(s.url) }));
  } catch {
    return DEFAULT_SOURCES;
  }
}

