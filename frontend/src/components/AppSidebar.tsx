import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { fetchOpportunities } from "@/lib/opportunities-api";
import {
  getUnreadCount,
  upsertDeadlineNotificationsFromOpportunities,
  upsertCollectionSummaryFromOpportunities,
} from "@/lib/notifications-store";
import { clearAuthUser, getAuthUser, hasRole, type Role } from "@/lib/auth";
import { addAuditLog } from "@/lib/audit-logs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LayoutDashboard,
  Search,
  Bell,
  ClipboardList,
  Trash2,
  Settings,
  Star,
  Zap,
  LogOut,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  X,
} from "lucide-react";

type NavItem = { to: string; icon: typeof LayoutDashboard; label: string; min?: Role };
type NavGroup = { title: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    title: "Principal",
    items: [
      { to: "/", icon: LayoutDashboard, label: "Tableau de bord" },
      { to: "/opportunities", icon: Search, label: "Opportunités" },
      { to: "/favorites", icon: Star, label: "Pertinent" },
      { to: "/chat", icon: MessageSquare, label: "Assistant IA" },
    ],
  },
  {
    title: "Suivi",
    items: [
      { to: "/notifications", icon: Bell, label: "Notifications" },
      { to: "/submitted-tracking", icon: ClipboardList, label: "Suivi soumissions" },
    ],
  },
  {
    title: "Administration",
    items: [
      { to: "/trash", icon: Trash2, label: "Corbeille", min: "admin_exploitation" },
      { to: "/settings", icon: Settings, label: "Paramètres", min: "admin_exploitation" },
    ],
  },
];

const ROLE_LABEL: Record<Role, string> = {
  user: "Utilisateur",
  admin_exploitation: "Admin exploitation",
  admin_systeme: "Admin système",
};

const ROLE_TINT: Record<Role, string> = {
  user: "bg-muted text-muted-foreground",
  admin_exploitation: "bg-primary/10 text-primary",
  admin_systeme: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
};

type Props = {
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
};

export function AppSidebar({ collapsed, onToggleCollapse, mobileOpen, onCloseMobile }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);
  const me = getAuthUser();
  const initials =
    (me?.name || me?.email || "?")
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? "")
      .join("") || "?";

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        // Notifications DÉRIVÉES des opportunités réelles (alertes d'échéance).
        const opps = await fetchOpportunities();
        if (cancelled) return;
        upsertDeadlineNotificationsFromOpportunities(
          opps.map((o) => ({ id: o.id, title: o.title, deadline: o.deadline, status: o.status, score: o.score })),
        );
        upsertCollectionSummaryFromOpportunities(opps.map((o) => ({ id: o.id, score: o.score })));
        setUnreadNotificationsCount(getUnreadCount());
      } catch {
        // ignore (offline / backend down)
      }
    };

    // Réagir à « notifications-updated » en RE-LISANT seulement le compteur
    // (lecture seule) pour éviter la boucle génération → événement → génération.
    const recountOnly = () => {
      try {
        setUnreadNotificationsCount(getUnreadCount());
      } catch {
        /* ignore */
      }
    };
    void refresh();
    window.addEventListener("notifications-updated", recountOnly);
    const interval = window.setInterval(refresh, 60_000);
    return () => {
      cancelled = true;
      window.removeEventListener("notifications-updated", recountOnly);
      window.clearInterval(interval);
    };
  }, []);

  const renderItem = ({ to, icon: Icon, label }: NavItem) => {
    const isActive = location.pathname === to;
    const isNotif = to === "/notifications";
    const showBadge = isNotif && unreadNotificationsCount > 0;
    return (
      <NavLink
        key={to}
        to={to}
        onClick={onCloseMobile}
        title={collapsed ? label : undefined}
        aria-label={label}
        className={cn(
          "group/nav relative flex items-center gap-3 rounded-md px-3 py-2 text-[13px] transition-colors duration-150",
          collapsed && "lg:justify-center lg:px-0",
          isActive
            ? "bg-sidebar-accent/70 text-sidebar-accent-foreground font-medium"
            : "text-sidebar-foreground/75 hover:bg-sidebar-accent/40 hover:text-sidebar-accent-foreground",
        )}
      >
        {/* Indicateur actif : fin liseré à gauche */}
        {isActive && (
          <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-sidebar-primary" />
        )}
        <span className="relative shrink-0">
          <Icon
            className={cn(
              "h-[18px] w-[18px] transition-colors",
              isActive ? "text-sidebar-accent-foreground" : "text-sidebar-foreground/60 group-hover/nav:text-sidebar-accent-foreground",
            )}
            strokeWidth={isActive ? 2 : 1.75}
          />
          {/* Pastille de non-lues : uniquement en mode réduit (desktop) */}
          {showBadge && (
            <span className={cn("absolute -right-1 -top-1 hidden h-2 w-2 rounded-full bg-sidebar-primary ring-2 ring-sidebar", collapsed && "lg:block")} />
          )}
        </span>
        <span className={cn("flex-1 truncate", collapsed && "lg:hidden")}>{label}</span>
        {showBadge && (
          <span
            className={cn(
              "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-sidebar-primary/90 px-1 text-[10px] font-medium text-sidebar-primary-foreground",
              collapsed && "lg:hidden",
            )}
          >
            {unreadNotificationsCount > 99 ? "99+" : unreadNotificationsCount}
          </span>
        )}
      </NavLink>
    );
  };

  return (
    <>
      {/* Voile mobile */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "group fixed left-0 top-0 bottom-0 z-50 flex w-[248px] flex-col border-r border-sidebar-border/70 bg-sidebar transition-[transform,width] duration-200 ease-out",
          collapsed ? "lg:w-[72px]" : "lg:w-[248px]",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          "lg:translate-x-0",
        )}
        aria-label="Navigation principale"
      >
        {/* Bouton plier/déplier — discret, sur le bord (desktop) */}
        <button
          type="button"
          onClick={onToggleCollapse}
          className="absolute -right-3 top-[26px] z-10 hidden h-6 w-6 items-center justify-center rounded-full border border-sidebar-border bg-sidebar text-sidebar-foreground/50 opacity-0 transition-all duration-150 hover:text-sidebar-accent-foreground focus-visible:opacity-100 group-hover:opacity-100 lg:flex"
          title={collapsed ? "Déplier le menu" : "Réduire le menu"}
          aria-label={collapsed ? "Déplier le menu" : "Réduire le menu"}
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </button>

        {/* En-tête / logo */}
        <div className={cn("flex h-16 items-center gap-3 px-4", collapsed && "lg:justify-center lg:px-0")}>
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-sidebar-primary">
            <Zap className="h-[18px] w-[18px] text-sidebar-primary-foreground" />
          </div>
          <div className={cn("min-w-0", collapsed && "lg:hidden")}>
            <h1 className="truncate text-sm font-semibold tracking-tight text-sidebar-accent-foreground">KIAMA SA</h1>
            <p className="text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/45">Veille Stratégique</p>
          </div>
          {/* Fermer (mobile) */}
          <button
            type="button"
            onClick={onCloseMobile}
            className="ml-auto rounded-md p-1.5 text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground lg:hidden"
            aria-label="Fermer le menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation groupée */}
        <nav className="scrollbar-slim flex-1 space-y-5 overflow-y-auto px-3 py-2">
          {navGroups.map((group) => {
            const items = group.items.filter((it) => !it.min || hasRole(it.min));
            if (items.length === 0) return null;
            return (
              <div key={group.title}>
                {/* Titre de section (déplié) — fin séparateur (réduit) */}
                <p className={cn("px-3 pb-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-sidebar-foreground/35", collapsed && "lg:hidden")}>
                  {group.title}
                </p>
                {collapsed && <div className="mx-auto mb-1.5 hidden h-px w-6 bg-sidebar-border/70 lg:block" />}
                <div className="space-y-0.5">{items.map(renderItem)}</div>
              </div>
            );
          })}
        </nav>

        {/* Pied : menu utilisateur (identité + déconnexion) */}
        <div className="border-t border-sidebar-border/70 p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-sidebar-accent/40 data-[state=open]:bg-sidebar-accent/60",
                  collapsed && "lg:justify-center lg:px-0",
                )}
                title={collapsed ? `${me?.name ?? "—"} · ${me ? ROLE_LABEL[me.role] : ""}` : undefined}
                aria-label="Menu du compte"
              >
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sidebar-primary/90 text-[10px] font-semibold text-sidebar-primary-foreground ring-1 ring-sidebar-border">
                  {initials}
                </div>
                <div className={cn("min-w-0 flex-1", collapsed && "lg:hidden")}>
                  <p className="truncate text-xs font-medium text-sidebar-accent-foreground">{me?.name ?? "—"}</p>
                  <p className="truncate text-[10px] text-sidebar-foreground/45">{me ? ROLE_LABEL[me.role] : ""}</p>
                </div>
                <ChevronsUpDown className={cn("h-3.5 w-3.5 shrink-0 text-sidebar-foreground/40", collapsed && "lg:hidden")} />
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-60">
              <DropdownMenuLabel className="font-normal">
                <div className="flex items-center gap-2.5">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {initials}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{me?.name ?? "—"}</p>
                    {me?.email && <p className="truncate text-xs text-muted-foreground">{me.email}</p>}
                  </div>
                </div>
                {me && (
                  <span className={cn("mt-2.5 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium", ROLE_TINT[me.role])}>
                    {ROLE_LABEL[me.role]}
                  </span>
                )}
              </DropdownMenuLabel>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                onClick={() => {
                  addAuditLog({ action: "logout", entityType: "auth" });
                  clearAuthUser();
                  navigate("/login", { replace: true });
                }}
                className="text-destructive focus:bg-destructive/10 focus:text-destructive"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Se déconnecter
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </>
  );
}
