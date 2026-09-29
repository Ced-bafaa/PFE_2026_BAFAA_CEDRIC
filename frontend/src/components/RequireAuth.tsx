import { Navigate, useLocation } from "react-router-dom";
import { isAuthenticated, mustChangePassword } from "@/lib/auth";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  if (!isAuthenticated()) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  // Tant que le changement de mot de passe est obligatoire, on y force l'accès.
  if (mustChangePassword() && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }
  return <>{children}</>;
}

