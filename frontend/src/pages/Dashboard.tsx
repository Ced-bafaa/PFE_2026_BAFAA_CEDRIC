import { useCallback, useEffect, useMemo, useState } from "react";
import { StatCard } from "@/components/StatCard";
import { OpportunityCard } from "@/components/OpportunityCard";
import type { Opportunity } from "@/lib/types";
import { fetchFavoriteOpportunityIds, fetchOpportunities, fetchReadOpportunityIds } from "@/lib/opportunities-api";
import { Search, Target, Send, Trophy, Database, Users, LayoutDashboard } from "lucide-react";
import { motion } from "framer-motion";
import { PageHeader } from "@/components/PageHeader";
import { SOURCES_SETTINGS_KEY } from "@/lib/sources-settings-key";
import { getPartners } from "@/lib/partners-store";
import { hasRole } from "@/lib/auth";

type SourceSettingsItem = { active?: boolean };
type SourcesSettings = { sources?: SourceSettingsItem[] };

function getActiveSourcesCount(): number {
  try {
    const raw = localStorage.getItem(SOURCES_SETTINGS_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as SourcesSettings;
    const list = Array.isArray(parsed.sources) ? parsed.sources : [];
    return list.filter((s) => (s?.active ?? true) !== false).length;
  } catch {
    return 0;
  }
}

function currentMonthLabel(): string {
  const label = new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export default function Dashboard() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [usingCache, setUsingCache] = useState(false);
  const [sourcesSettingsVersion, setSourcesSettingsVersion] = useState(0);
  const [partnersCount, setPartnersCount] = useState(() => getPartners().length);

  // Chargement initial (avec indicateur de chargement)
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [opps, reads, favs] = await Promise.all([
        fetchOpportunities(),
        fetchReadOpportunityIds(),
        fetchFavoriteOpportunityIds(),
      ]);
      setOpportunities(opps);
      setReadIds(new Set(reads));
      setFavoriteIds(new Set(favs));
      setUsingCache(false);
    } catch {
      // En cas de backend indisponible, `fetchOpportunities()` peut fallback sur le cache local.
      const opps = await fetchOpportunities();
      setOpportunities(opps);
      setReadIds(new Set());
      setFavoriteIds(new Set());
      setUsingCache(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Rafraîchissement silencieux en arrière-plan (sans indicateur de chargement)
  const backgroundRefresh = useCallback(async () => {
    try {
      const [opps, reads, favs] = await Promise.all([
        fetchOpportunities(),
        fetchReadOpportunityIds(),
        fetchFavoriteOpportunityIds(),
      ]);
      setOpportunities(opps);
      setReadIds(new Set(reads));
      setFavoriteIds(new Set(favs));
      setUsingCache(false);
    } catch {
      // Échec silencieux : on conserve les données actuelles
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // Polling toutes les 30 secondes pour les mises à jour en temps réel
  useEffect(() => {
    const id = window.setInterval(() => void backgroundRefresh(), 30_000);
    return () => window.clearInterval(id);
  }, [backgroundRefresh]);

  // Réactivité aux changements de configuration des sources
  useEffect(() => {
    const bump = () => setSourcesSettingsVersion((v) => v + 1);
    const onStorage = (e: StorageEvent) => {
      if (e.key === SOURCES_SETTINGS_KEY) bump();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("sources-settings-changed", bump);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("sources-settings-changed", bump);
    };
  }, []);

  // Réactivité aux changements du nombre de partenaires (même onglet ou autre onglet)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "partners_data") setPartnersCount(getPartners().length);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

  const publishedInMonth = (opp: Opportunity) => {
    const d = new Date(opp.publishedAt);
    return d >= monthStart && d <= monthEnd;
  };

  const publishedLastMonth = (opp: Opportunity) => {
    const d = new Date(opp.publishedAt);
    return d >= lastMonthStart && d <= lastMonthEnd;
  };

  const qualifiedThisMonth = opportunities.filter(
    (o) => o.status === "qualifie" && publishedInMonth(o),
  ).length;
  const submittedThisMonth = opportunities.filter(
    (o) => o.status === "soumis" && publishedInMonth(o),
  ).length;
  const won = opportunities.filter((o) => o.status === "gagne").length;
  const decided = won + opportunities.filter((o) => o.status === "perdu").length;
  const winRate = decided > 0 ? Math.round((won / decided) * 100) : 0;

  // Tendance Opportunités : ce mois vs mois précédent
  const countThisMonth = opportunities.filter(publishedInMonth).length;
  const countLastMonth = opportunities.filter(publishedLastMonth).length;
  const opportunitiesTrend = useMemo(() => {
    if (countLastMonth === 0) return null;
    const delta = Math.round(((countThisMonth - countLastMonth) / countLastMonth) * 100);
    return { value: Math.abs(delta), positive: delta >= 0 };
  }, [countThisMonth, countLastMonth]);

  const countToday = useMemo(() => {
    const today = new Date();
    return opportunities.filter((o) => {
      const s = o.scrapedAt;
      if (!s) return false;
      const t = Date.parse(s);
      if (!Number.isFinite(t)) return false;
      const d = new Date(t);
      return (
        d.getFullYear() === today.getFullYear() &&
        d.getMonth() === today.getMonth() &&
        d.getDate() === today.getDate()
      );
    }).length;
  }, [opportunities]);

  const recentOpportunities = [...opportunities]
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, 6);

  const totalSources = useMemo(() => {
    // Sources configurées côté front (actives) + 1 pour ARMP (géré côté backend).
    return getActiveSourcesCount() + 1;
  }, [sourcesSettingsVersion]);

  // Les liens Sources/Partenaires ne sont proposés qu'aux rôles qui y ont accès.
  const isManager = hasRole("admin_exploitation");

  return (
    <div className="space-y-6">
      <PageHeader
        icon={LayoutDashboard}
        title="Tableau de bord"
        description={
          <>
            Vue d'ensemble de la veille stratégique — {currentMonthLabel()}
            {usingCache && !loading && (
              <span className="mt-1 block text-xs">
                Mode hors ligne : statistiques basées sur les données en cache (dernier chargement réussi).
              </span>
            )}
          </>
        }
      />

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard
          title="Opportunités"
          value={loading ? "…" : opportunities.length}
          subtitle={
            loading
              ? "Chargement…"
              : countToday > 0
                ? `Aujourd'hui : ${countToday} · Ce mois : ${countThisMonth}`
                : `Ce mois : ${countThisMonth}`
          }
          icon={Search}
          trend={loading ? undefined : opportunitiesTrend ?? undefined}
          to="/opportunities"
        />
        <StatCard
          title="Qualifiées"
          value={loading ? "…" : qualifiedThisMonth}
          subtitle="Ce mois"
          icon={Target}
          to="/opportunities?status=qualifie"
        />
        <StatCard
          title="Soumises"
          value={loading ? "…" : submittedThisMonth}
          subtitle="Ce mois"
          icon={Send}
          to="/submitted-tracking"
        />
        <StatCard
          title="Taux succès"
          value={loading ? "…" : `${winRate}%`}
          subtitle={`${won} gagné(s) / ${decided} décidé(s)`}
          icon={Trophy}
          to="/submitted-tracking?phase=attribue"
        />
        <StatCard
          title="Total sources"
          value={loading ? "…" : totalSources}
          subtitle="Sources de scraping"
          icon={Database}
          to={isManager ? "/settings" : undefined}
        />
        <StatCard
          title="Partenaires"
          value={partnersCount}
          subtitle="Enregistrés"
          icon={Users}
          to={isManager ? "/partners" : undefined}
        />
      </div>

      {/* Recent Opportunities */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">Opportunités récentes</h2>
          </div>
          <a href="/opportunities" className="text-xs text-primary font-medium hover:underline">
            Voir tout →
          </a>
        </div>
        <div className="space-y-3">
          {loading && (
            <div className="text-sm text-muted-foreground py-6 text-center border rounded-xl bg-card">
              Chargement…
            </div>
          )}
          {!loading &&
            recentOpportunities.map((opp, i) => (
              <OpportunityCard
                key={`${opp.id}-${refreshKey}`}
                opportunity={opp}
                index={i}
                isRead={readIds.has(opp.id)}
                isFavorite={favoriteIds.has(opp.id)}
                onMarkedRead={(id) => setReadIds((prev) => new Set(prev).add(id))}
                onFavoriteChange={() => setRefreshKey((value) => value + 1)}
              />
            ))}
          {!loading && recentOpportunities.length === 0 && (
            <div className="text-sm text-muted-foreground py-6 text-center border rounded-xl bg-card">
              Aucune opportunité sur cette période.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
