export type SubmissionPhase =
  | "depose"
  | "en_evaluation"
  | "clarification"
  | "negociation"
  | "attribue"
  | "rejete";

/** Une ligne de suivi : un statut et une ou plusieurs notes courtes */
export type TrackingLine = {
  phase: SubmissionPhase;
  notes: string[];
};

export type SubmissionTrackingItem = {
  lines: TrackingLine[];
  updatedAt: string;
};

type TrackingMap = Record<string, SubmissionTrackingItem>;

import { apiJson, pushToServer } from "@/lib/api";
import { notifyPhaseChange } from "@/lib/notifications-store";

const TRACKING_KEY = "kiama_submission_tracking";

/** Libellés lisibles des phases (pour les notifications et l'affichage). */
export const PHASE_LABEL: Record<SubmissionPhase, string> = {
  depose: "Déposé",
  en_evaluation: "En évaluation",
  clarification: "Clarification",
  negociation: "Négociation",
  attribue: "Attribué",
  rejete: "Rejeté",
};

const defaultLine = (): TrackingLine => ({
  phase: "depose",
  notes: [""],
});

const defaultTracking: SubmissionTrackingItem = {
  lines: [defaultLine()],
  updatedAt: "",
};

function isValidPhase(p: unknown): p is SubmissionPhase {
  return (
    p === "depose" ||
    p === "en_evaluation" ||
    p === "clarification" ||
    p === "negociation" ||
    p === "attribue" ||
    p === "rejete"
  );
}

function normalizeNotes(raw: unknown): string[] {
  if (Array.isArray(raw) && raw.every((n) => typeof n === "string")) {
    return raw.length > 0 ? raw : [""];
  }
  return [""];
}

function normalizeLinesFromUnknown(input: unknown): TrackingLine[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const out: TrackingLine[] = [];
  for (const row of input) {
    if (!row || typeof row !== "object") continue;
    const r = row as { phase?: unknown; notes?: unknown };
    if (!isValidPhase(r.phase)) continue;
    out.push({ phase: r.phase, notes: normalizeNotes(r.notes) });
  }
  return out.length > 0 ? out : null;
}

function normalizeTrackingItem(input: unknown): SubmissionTrackingItem {
  const fallback = defaultTracking;
  if (!input || typeof input !== "object") return fallback;

  const item = input as Partial<SubmissionTrackingItem> & {
    phase?: unknown;
    notes?: unknown;
    note?: unknown;
    lines?: unknown;
  };

  const fromLines = normalizeLinesFromUnknown(item.lines);
  if (fromLines) {
    return {
      lines: fromLines,
      updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
    };
  }

  const phase = isValidPhase(item.phase) ? item.phase : fallback.lines[0].phase;
  const rawNotes = item.notes;
  if (Array.isArray(rawNotes) && rawNotes.every((n) => typeof n === "string")) {
    return {
      lines: [{ phase, notes: rawNotes.length > 0 ? rawNotes : [""] }],
      updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
    };
  }

  const legacyNote = item.note;
  if (typeof legacyNote === "string") {
    return {
      lines: [{ phase, notes: [legacyNote] }],
      updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
    };
  }

  return {
    lines: [{ phase, notes: [""] }],
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
  };
}

function readTrackingMap(): TrackingMap {
  try {
    const raw = localStorage.getItem(TRACKING_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as TrackingMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeTrackingMap(map: TrackingMap) {
  localStorage.setItem(TRACKING_KEY, JSON.stringify(map));
}

/** Phase affichée (carte, stats) : dernière ligne enregistrée */
export function getEffectivePhase(item: SubmissionTrackingItem): SubmissionPhase {
  const lines = item.lines;
  if (!lines.length) return "depose";
  return lines[lines.length - 1].phase;
}

export function getSubmissionTracking(id: string): SubmissionTrackingItem {
  const map = readTrackingMap();
  if (!map[id]) {
    return {
      lines: [defaultLine()],
      updatedAt: "",
    };
  }
  const normalized = normalizeTrackingItem(map[id]);
  if (JSON.stringify(map[id]) !== JSON.stringify(normalized)) {
    map[id] = normalized;
    writeTrackingMap(map);
  }
  return normalized;
}

export function updateSubmissionTracking(
  id: string,
  patch: Partial<SubmissionTrackingItem>,
  meta?: { title?: string },
) {
  const map = readTrackingMap();
  const hadTracking = Boolean(map[id]);
  const normalizedCurrent = normalizeTrackingItem(map[id] ?? defaultTracking);
  const prevPhase = getEffectivePhase(normalizedCurrent);
  const nextLines =
    patch.lines !== undefined
      ? patch.lines.length > 0
        ? patch.lines
        : [defaultLine()]
      : normalizedCurrent.lines;
  map[id] = {
    lines: nextLines,
    updatedAt: new Date().toISOString(),
  };
  writeTrackingMap(map);
  pushToServer(`/submission-tracking/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ lines: nextLines }),
  });

  // Notification si la phase effective change (et seulement pour un suivi déjà
  // existant : la création initiale « Déposé » ne notifie pas).
  const nextPhase = nextLines[nextLines.length - 1]?.phase ?? prevPhase;
  if (hadTracking && nextPhase !== prevPhase) {
    notifyPhaseChange(id, nextPhase, PHASE_LABEL[nextPhase] ?? nextPhase, meta?.title);
  }
}

/** Hydratation au démarrage : le serveur fait foi. */
export async function hydrateTrackingFromServer(): Promise<void> {
  const data = await apiJson<Record<string, SubmissionTrackingItem>>("/submission-tracking");
  if (data && typeof data === "object") {
    localStorage.setItem(TRACKING_KEY, JSON.stringify(data));
  }
}
