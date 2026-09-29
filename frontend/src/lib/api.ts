import { getToken, clearAuthUser } from "./auth";

/** En-tetes d'authentification : JWT Bearer (+ x-api-key si VITE_API_KEY est definie). */
export function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const key = (import.meta.env.VITE_API_KEY as string | undefined)?.trim();
  if (key) headers["x-api-key"] = key;
  return headers;
}

/** Session expiree/invalide -> on purge et on renvoie vers la connexion. */
function handleUnauthorized(): void {
  clearAuthUser();
  if (typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.assign("/login");
  }
}

export async function uploadPersonnelCv(file: File): Promise<{ filename: string; originalname: string }> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${getApiBaseUrl()}/settings/company/upload-cv`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Upload echoue (${res.status}) : ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

export async function uploadDiplomaFile(file: File): Promise<{ filename: string; originalname: string }> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${getApiBaseUrl()}/settings/company/upload-diploma`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Upload echoue (${res.status}) : ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

export async function deleteDiplomaFile(filename: string): Promise<void> {
  await fetch(`${getApiBaseUrl()}/settings/company/diploma/${encodeURIComponent(filename)}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
}

export async function deletePersonnelCv(filename: string): Promise<void> {
  await fetch(`${getApiBaseUrl()}/settings/company/cv/${encodeURIComponent(filename)}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
}

/** Base URL du backend Nest (sans slash final). */
export function getApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_URL as string | undefined;
  const trimmed = raw?.replace(/\/$/, "");
  return trimmed || "http://localhost:3004";
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${getApiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
      ...init?.headers,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized();
    throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 400)}`);
  }
  if (res.status === 204 || text.trim() === "") {
    return undefined as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Reponse non-JSON (${res.status}): ${text.slice(0, 240)}`);
  }
}

/** Replication write-through vers le backend (fire-and-forget). */
export function pushToServer(path: string, init?: RequestInit): void {
  void apiJson(path, init).catch((err) => {
    console.warn(`[sync] ${path} non replique :`, err instanceof Error ? err.message : err);
  });
}
