import { apiJson } from "@/lib/api";
import { SOURCES_SETTINGS_KEY } from "@/lib/sources-settings-key";

/**
 * Hydratation du cache local des sources depuis le backend.
 *
 * Le backend (`sources-settings.json`) fait foi. La page Sources n'étant
 * accessible qu'aux administrateurs, sans cette hydratation le cache local
 * reste vide pour un rôle User — ce qui dégrade (sans casser) trois affichages :
 *   - le compteur de sources actives du Tableau de bord,
 *   - la normalisation du filtre « source » dans Opportunités,
 *   - le classement des opportunités par mots-clés.
 *
 * En peuplant ce cache au démarrage pour tous les rôles (le GET /settings/sources
 * est ouvert à tout utilisateur authentifié), ces trois affichages redeviennent
 * cohérents quel que soit le rôle ou l'état du cache.
 */
export async function hydrateSourcesFromServer(): Promise<void> {
  const remote = await apiJson<unknown>("/settings/sources");
  if (remote && typeof remote === "object") {
    localStorage.setItem(SOURCES_SETTINGS_KEY, JSON.stringify(remote));
    // Prévient les composants abonnés (mêmes que la page Sources).
    window.dispatchEvent(new CustomEvent("sources-settings-changed"));
  }
}
