import { AppSidebar } from "@/components/AppSidebar";
import { Outlet, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Menu, Zap } from "lucide-react";
import { useInactivityLogout } from "@/lib/use-inactivity-logout";

const COLLAPSE_KEY = "kiama_sidebar_collapsed";

/** Déconnexion automatique après 30 min d'inactivité (retour à /login). */
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

export function AppLayout() {
  const location = useLocation();

  // Sécurité : ferme la session après une inactivité prolongée, sans avertissement.
  useInactivityLogout(INACTIVITY_TIMEOUT_MS);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  // Persiste la préférence de repli entre sessions.
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      /* stockage indisponible */
    }
  }, [collapsed]);

  // Ferme le drawer à chaque navigation (mobile).
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((v) => !v)}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      {/* Barre supérieure mobile */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="rounded-md p-2 text-foreground/80 hover:bg-muted"
          aria-label="Ouvrir le menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-primary">
            <Zap className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="text-sm font-bold tracking-tight">KIAMA SA</span>
        </div>
      </header>

      <main
        className={cn(
          "max-w-[1240px] p-6 pt-20 transition-[margin] duration-200 ease-out lg:p-8 lg:pt-8",
          collapsed ? "lg:ml-[72px]" : "lg:ml-[248px]",
        )}
      >
        <Outlet />
      </main>
    </div>
  );
}
