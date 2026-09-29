/**
 * Filtrage par mots-clés, robuste aux faux positifs de sous-chaîne ET de préfixe.
 *
 * Deux régimes de correspondance, choisis automatiquement :
 *   - SIGLE (mot-clé tout en MAJUSCULES : TIC, ICT, ERP, ANTIC, CAMTEL, GUCE…)
 *       → mot ENTIER exigé. « ANTIC » ne matche donc PAS « anticancéreux »,
 *         « TIC » ne matche pas « diagnostic ».
 *   - RADICAL (mot-clé en minuscules : « informatiq », « télécom »…)
 *       → début de mot, suffixe libre (« informatiq » → « informatique(s) »).
 *
 * Dans les deux cas : frontière de mot AVANT, insensible aux accents et à la casse.
 */

function stripAccentsLower(s: string): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Un sigle = uniquement majuscules / chiffres / tiret (ex. « ANTIC », « E-GOV »). */
function isAcronym(rawKeyword: string): boolean {
  return /^[A-Z0-9][A-Z0-9-]*$/.test(rawKeyword) && /[A-Z]/.test(rawKeyword);
}

function keywordRegex(normKeyword: string, wholeWord: boolean): RegExp {
  const body = escapeRegExp(normKeyword);
  const before = '(?:^|[^a-z0-9])'; // frontière de mot avant
  const after = wholeWord ? '(?![a-z0-9])' : ''; // mot entier si sigle
  return new RegExp(`${before}${body}${after}`);
}

/**
 * Vrai si `text` contient au moins un des `keywords` selon les règles ci-dessus.
 */
export function textMatchesAnyKeyword(
  text: string,
  keywords: string[] | undefined,
): boolean {
  const hay = stripAccentsLower(text);
  if (!hay) return false;
  for (const raw of keywords ?? []) {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) continue;
    const k = stripAccentsLower(trimmed);
    if (!k) continue;
    // Sigle (majuscules) OU radical très court → mot entier ; sinon préfixe.
    const wholeWord = isAcronym(trimmed) || k.length <= 3;
    if (keywordRegex(k, wholeWord).test(hay)) return true;
  }
  return false;
}
