import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import { apiJson } from "@/lib/api";
import { startCollectInBackground } from "@/lib/collect-runner";

export type CollectStatus = {
  running: boolean;
  phase: "idle" | "collecte" | "scoring" | "done" | "error";
  sourcesTotal: number;
  sourcesDone: number;
  collected: number;
  scoreTotal: number;
  scoreDone: number;
  message: string;
  elapsedSec: number;
};

/** Pourcentage global : collecte = 4..36 %, scoring = 38..100 %. */
function collectPercent(p: CollectStatus | null): number {
  if (!p) return 4;
  if (p.phase === "done") return 100;
  if (p.phase === "collecte")
    return 4 + (p.sourcesTotal > 0 ? (p.sourcesDone / p.sourcesTotal) * 32 : 0);
  if (p.phase === "scoring")
    return 38 + (p.scoreTotal > 0 ? (p.scoreDone / p.scoreTotal) * 62 : 0);
  return 4;
}

function collectLabel(p: CollectStatus | null): string {
  if (!p) return "Démarrage…";
  if (p.phase === "collecte")
    return `Collecte : source ${p.sourcesDone}/${p.sourcesTotal} · ${p.collected} opportunité(s) trouvée(s)`;
  if (p.phase === "scoring")
    return `Analyse et scoring : ${p.scoreDone}/${p.scoreTotal} opportunité(s)`;
  if (p.phase === "error") return "Terminé avec des erreurs";
  if (p.phase === "done") return "Terminé";
  return "Démarrage…";
}

/**
 * Hook partagé de suivi de la collecte.
 *
 * L'état de vérité est côté serveur (`GET /collect/status`) : ce hook le sonde,
 * et surtout se « reconnecte » à une collecte déjà en cours lorsqu'on (re)vient
 * sur une page qui l'utilise, de sorte que la barre ne disparaît pas si on
 * change d'onglet.
 */
export function useCollectProgress(onFinished?: (phase: "done" | "error") => void) {
  const [status, setStatus] = useState<CollectStatus | null>(null);
  const [active, setActive] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const stoppedRef = useRef(false);
  const pollingRef = useRef(false);
  const finishedCb = useRef(onFinished);
  finishedCb.current = onFinished;

  const startPolling = useCallback(() => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    stoppedRef.current = false;
    let seen = false;
    const tick = async (): Promise<void> => {
      if (stoppedRef.current) {
        pollingRef.current = false;
        return;
      }
      try {
        const st = await apiJson<CollectStatus>("/collect/status");
        setStatus(st);
        setElapsed(st.elapsedSec ?? 0);
        if (st.running || st.phase === "collecte" || st.phase === "scoring") {
          seen = true;
          setActive(true);
        }
        if (seen && !st.running && (st.phase === "done" || st.phase === "error")) {
          finishedCb.current?.(st.phase);
          pollingRef.current = false;
          window.setTimeout(() => {
            if (!stoppedRef.current) setActive(false);
          }, 3500);
          return;
        }
      } catch {
        /* erreurs transitoires ignorées */
      }
      window.setTimeout(() => void tick(), 2000);
    };
    void tick();
  }, []);

  // Récupération : si une collecte tourne déjà, on l'affiche en arrivant sur la page.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const st = await apiJson<CollectStatus>("/collect/status");
        if (cancelled) return;
        if (st.running || st.phase === "collecte" || st.phase === "scoring") {
          setStatus(st);
          setElapsed(st.elapsedSec ?? 0);
          setActive(true);
          startPolling();
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
      stoppedRef.current = true;
    };
  }, [startPolling]);

  // Minuterie locale (resynchronisée à chaque sondage), seulement pendant l'exécution.
  useEffect(() => {
    if (!active || !status?.running) return;
    const id = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => window.clearInterval(id);
  }, [active, status?.running]);

  const startCollect = useCallback(async (): Promise<boolean> => {
    setStatus(null);
    setElapsed(0);
    setActive(true);
    let started = false;
    try {
      started = await startCollectInBackground({ force: true });
    } catch (e) {
      setActive(false);
      throw e;
    }
    if (!started) {
      setActive(false);
      return false;
    }
    startPolling();
    return true;
  }, [startPolling]);

  return { status, active, elapsed, startCollect };
}

/** Carte de progression réutilisable (Opportunités, Paramètres…). */
export function CollectProgressCard({
  status,
  elapsed,
}: {
  status: CollectStatus | null;
  elapsed: number;
}) {
  const pct = Math.round(collectPercent(status));
  const done = status?.phase === "done";
  const error = status?.phase === "error";
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          {done ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          )}
          Collecte des opportunités
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">{elapsed} s</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            error ? "bg-rose-500" : done ? "bg-emerald-500" : "bg-primary"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{collectLabel(status)}</span>
        <span className="font-medium tabular-nums">{pct} %</span>
      </div>
    </div>
  );
}
