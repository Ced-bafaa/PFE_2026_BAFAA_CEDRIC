import { apiJson } from "@/lib/api";
import type { Role } from "@/lib/auth";

export type AdminUser = {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  email: string;
  role: Role;
  active: boolean;
};

/** Extrait le message d'erreur métier renvoyé par le backend Nest. */
function cleanError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  const idx = msg.indexOf("{");
  if (idx >= 0) {
    try {
      const j = JSON.parse(msg.slice(idx)) as { message?: unknown };
      const m = j?.message;
      if (m) return new Error(Array.isArray(m) ? m.join(", ") : String(m));
    } catch {
      /* ignore : on garde le message brut */
    }
  }
  return e instanceof Error ? e : new Error(msg);
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await apiJson<T>(path, init);
  } catch (e) {
    throw cleanError(e);
  }
}

export function fetchUsers(): Promise<AdminUser[]> {
  return call<AdminUser[]>("/users");
}

export function createUser(input: {
  firstName: string;
  lastName: string;
  position: string;
  email: string; // partie avant @kiama.cm (le backend impose le domaine)
  role: Role;
}): Promise<{ user: AdminUser; password: string }> {
  return call("/users", { method: "POST", body: JSON.stringify(input) });
}

export function updateUser(
  id: string,
  input: { firstName?: string; lastName?: string; position?: string; role?: Role; active?: boolean },
): Promise<AdminUser> {
  return call<AdminUser>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function resetUserPassword(id: string): Promise<{ password: string }> {
  return call(`/users/${id}/reset-password`, { method: "POST" });
}
