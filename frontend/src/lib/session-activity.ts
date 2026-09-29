/**
 * Horodatage de la dernière activité de l'utilisateur (déconnexion automatique).
 *
 * Isolé dans son propre module pour être partagé par `auth.ts` (qui le
 * réinitialise à la connexion et l'efface à la déconnexion) et par le hook
 * `use-inactivity-logout.ts`, sans créer d'import circulaire entre les deux.
 */

export const LAST_ACTIVITY_KEY = "auth_last_activity_ms";

export function readLastActivity(): number {
  try {
    const v = parseInt(localStorage.getItem(LAST_ACTIVITY_KEY) || "", 10);
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

export function writeLastActivity(ms: number = Date.now()): void {
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(ms));
  } catch {
    /* stockage indisponible */
  }
}

export function clearLastActivity(): void {
  try {
    localStorage.removeItem(LAST_ACTIVITY_KEY);
  } catch {
    /* stockage indisponible */
  }
}
