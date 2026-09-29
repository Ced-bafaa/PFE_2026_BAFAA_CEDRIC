import { useEffect, useRef } from "react";
import { clearAuthUser } from "@/lib/auth";
import { LAST_ACTIVITY_KEY, readLastActivity, writeLastActivity } from "@/lib/session-activity";

/**
 * Déconnexion automatique après une période d'inactivité, SANS avertissement.
 *
 * - L'inactivité est mesurée sur les interactions clavier/souris/tactile.
 * - Le dernier moment d'activité est partagé entre onglets via localStorage :
 *   bouger dans un onglet garde tous les onglets connectés.
 * - Au retour sur un onglet (ou à sa réouverture) déjà inactif au-delà du seuil,
 *   la déconnexion est immédiate.
 */

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
  "click",
] as const;

function nowMs(): number {
  return Date.now();
}

function doLogout(): void {
  clearAuthUser();
  if (typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.assign("/login");
  }
}

export function useInactivityLogout(timeoutMs: number): void {
  const timerRef = useRef<number | null>(null);
  const lastMarkRef = useRef(0);
  const lastWriteRef = useRef(0);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const schedule = (fromMs: number) => {
      clearTimer();
      const remaining = Math.max(0, timeoutMs - (nowMs() - fromMs));
      timerRef.current = window.setTimeout(() => {
        // Un autre onglet a pu enregistrer de l'activité : on revalide.
        const last = readLastActivity();
        if (nowMs() - last >= timeoutMs) doLogout();
        else schedule(last);
      }, remaining);
    };

    const markActivity = () => {
      const t = nowMs();
      if (t - lastMarkRef.current < 1000) return; // throttle (1 s)
      lastMarkRef.current = t;
      if (t - lastWriteRef.current > 5000) {
        lastWriteRef.current = t;
        writeLastActivity(t);
      }
      schedule(t);
    };

    // Initialisation : un onglet rouvert après une longue inactivité est fermé.
    // `setSession()` réécrit cet horodatage à chaque connexion, de sorte qu'une
    // valeur périmée d'une session précédente ne puisse jamais déconnecter un
    // utilisateur qui vient de s'authentifier.
    const last = readLastActivity();
    if (last > 0 && nowMs() - last >= timeoutMs) {
      doLogout();
      return;
    }
    const start = nowMs();
    writeLastActivity(start);
    lastWriteRef.current = start;
    lastMarkRef.current = start;
    schedule(start);

    const onStorage = (e: StorageEvent) => {
      if (e.key === LAST_ACTIVITY_KEY) {
        const v = readLastActivity();
        if (v > 0) schedule(v);
      }
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const l = readLastActivity();
      if (l > 0 && nowMs() - l >= timeoutMs) doLogout();
      else markActivity();
    };

    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, markActivity, { passive: true });
    }
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearTimer();
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, markActivity);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [timeoutMs]);
}
