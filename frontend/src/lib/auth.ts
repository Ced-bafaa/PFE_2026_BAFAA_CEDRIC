import { getApiBaseUrl } from "./api";
import { clearLastActivity, writeLastActivity } from "./session-activity";

export type Role = "user" | "admin_exploitation" | "admin_systeme";

export type AuthUser = {
  id?: string;
  name: string;
  email: string;
  role: Role;
  /** Vrai si l'utilisateur doit changer son mot de passe (compte créé/réinitialisé). */
  mustChangePassword?: boolean;
};

const TOKEN_KEY = "auth_token";
const AUTH_USER_KEY = "auth_user";

const ROLE_LEVEL: Record<Role, number> = {
  user: 1,
  admin_exploitation: 2,
  admin_systeme: 3,
};

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getAuthUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(AUTH_USER_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<AuthUser>;
    if (typeof p.email !== "string" || typeof p.role !== "string") return null;
    return {
      id: typeof p.id === "string" ? p.id : undefined,
      name: typeof p.name === "string" ? p.name : p.email,
      email: p.email,
      role: p.role as Role,
      mustChangePassword: p.mustChangePassword === true,
    };
  } catch {
    return null;
  }
}

/** Vrai si l'utilisateur connecté doit encore changer son mot de passe. */
export function mustChangePassword(): boolean {
  return getAuthUser()?.mustChangePassword === true;
}

export function getRole(): Role | null {
  return getAuthUser()?.role ?? null;
}

export function isAuthenticated(): boolean {
  return Boolean(getToken());
}

/** Vrai si le rôle courant est au moins `min` (hiérarchie user < exploitation < système). */
export function hasRole(min: Role): boolean {
  const r = getRole();
  return Boolean(r) && ROLE_LEVEL[r as Role] >= ROLE_LEVEL[min];
}

export function setSession(token: string, user: AuthUser): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  // Toute ouverture de session repart d'un compteur d'inactivité neuf : sans
  // cela, un horodatage périmé d'une session précédente déconnecterait
  // immédiatement l'utilisateur qui vient de se connecter.
  writeLastActivity();
}

export function clearAuthUser(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
  clearLastActivity();
}

/** Connexion : POST /auth/login, stocke le jeton + l'utilisateur. */
export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await fetch(`${getApiBaseUrl()}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = "Identifiants invalides.";
    try {
      const j = JSON.parse(text);
      msg = (Array.isArray(j?.message) ? j.message.join(", ") : j?.message) || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const data = JSON.parse(text) as { access_token: string; user: AuthUser };
  setSession(data.access_token, data.user);
  return data.user;
}

/** Change le mot de passe de l'utilisateur connecté ; lève l'obligation de changement. */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const token = getToken();
  const res = await fetch(`${getApiBaseUrl()}/auth/change-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const textResp = await res.text();
  if (!res.ok) {
    let msg = "Changement de mot de passe impossible.";
    try {
      const j = JSON.parse(textResp);
      msg = (Array.isArray(j?.message) ? j.message.join(", ") : j?.message) || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  // Met à jour l'utilisateur stocké : l'obligation est levée.
  const u = getAuthUser();
  if (u) setSession(token ?? "", { ...u, mustChangePassword: false });
}
