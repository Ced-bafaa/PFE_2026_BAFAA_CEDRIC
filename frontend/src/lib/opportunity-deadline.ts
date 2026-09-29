/**
 * Gestion de l'échéance de soumission d'une opportunité.
 *
 * La date limite (`deadline`) est une chaîne de format variable selon la source.
 * Lorsqu'elle n'est pas interprétable, on la traite comme « inconnue » (jamais
 * expirée) afin de ne jamais masquer un AO par erreur.
 */

/** Nombre de jours avant l'échéance ; 99999 si la date est inconnue ou illisible. */
export function getDaysToDeadline(deadline?: string): number {
  if (!deadline) return 99999;
  const t = new Date(deadline).getTime();
  if (Number.isNaN(t)) return 99999;
  const today = new Date().setHours(0, 0, 0, 0);
  return Math.ceil((t - today) / (1000 * 60 * 60 * 24));
}

/** Vrai si l'échéance est connue et déjà passée (strictement avant aujourd'hui). */
export function isDeadlinePassed(deadline?: string): boolean {
  return getDaysToDeadline(deadline) < 0;
}
