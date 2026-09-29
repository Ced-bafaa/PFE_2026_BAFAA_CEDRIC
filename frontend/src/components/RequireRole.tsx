import { Navigate, useLocation } from "react-router-dom";
import { hasRole, isAuthenticated, type Role } from "@/lib/auth";

/**
 * Garde de route par rôle minimum (hiérarchique).
 * - non authentifié → /login
 * - rôle insuffisant → retour au tableau de bord
 */
export function RequireRole({ min, children }: { min: Role; children: React.ReactNode }) {
  const location = useLocation();
  if (!isAuthenticated()) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (!hasRole(min)) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}
