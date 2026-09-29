import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { BrainCircuit, ChevronDown, ChevronUp, MoreVertical, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { addAuditLog } from "@/lib/audit-logs";
import { apiJson } from "@/lib/api";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SOURCES_SETTINGS_KEY } from "@/lib/sources-settings-key";
import { useCollectProgress, CollectProgressCard } from "@/components/CollectProgress";

type SourceItem = {
  id: string;
  title: string;
  url: string;
  active: boolean;
  /** Mots-clés propres à cette source (filtre / ciblage scraping) */
  keywords: string[];
};

type SourcesSettings = {
  sources: SourceItem[];
  /** Mots-clés globaux appliqués à toutes les sources (filtre de domaine) */
  globalKeywords?: string[];
  /** Description libre de l'entreprise */
  companyDescription?: string;
};

function parseKeywordsFromText(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeKeywordList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return parseKeywordsFromText(value);
  }
  return [];
}

function keywordsPreview(keywords: string[], maxLen = 56): string {
  const joined = keywords.join(", ");
  if (!joined) return "—";
  if (joined.length <= maxLen) return joined;
  return `${joined.slice(0, maxLen - 1)}…`;
}

/** Liste IT complète — synchronisée avec decision_engine/data/company_profile.json (it_keywords) */
const DEFAULT_IT_KEYWORDS: string[] = [
  "informatiq", "numérique", "digital", "technologi", "cyber",
  "télécommunication", "télécom", "TIC",
  "logiciel", "software",
  "application mobile", "application web", "application informatique",
  "application de gestion", "application de suivi",
  "système d'information", "système informatique",
  "plateforme numérique", "plateforme informatique", "plateforme web",
  "plateforme digitale", "plateforme de gestion",
  "portail web", "portail numérique", "portail en ligne",
  "site web", "intranet", "extranet",
  "e-gouvern", "e-service", "e-administration",
  "ERP", "SIGFIP", "SIGIPES",
  "CENADI", "ANTIC", "CAMTEL", "SYSTAC", "GUCE", "MINPOSTEL",
  "solution informatique", "solution numérique", "solution digitale",
  "acquisition de matériel informatique",
  "fourniture de matériel informatique",
  "fourniture et installation de matériel informatique",
  "support informatique", "support technique informatique",
  "assistance informatique", "assistance technique informatique",
  "câblage informatique", "câblage réseau",
  "base de données", "database", "datacenter", "data center",
  "développement de logiciel", "développement d'application",
  "développement de système", "développement de plateforme",
  "conception de logiciel", "conception de système",
  "déploiement de logiciel", "déploiement de système",
  "intégration de système", "migration informatique",
  "informatisation", "numérisation", "digitalisation", "dématérialisati",
  "réseau informatique", "réseau local", "réseau LAN", "réseau WAN",
  "fibre optique", "haut débit", "très haut débit",
  "infrastructure informatique", "infrastructure IT", "infrastructure numérique",
  "serveur informatique", "serveur web", "serveur applicatif",
  "cloud computing", "cloud informatique", "cloud privé", "cloud public",
  "virtualisation", "hébergement web", "hébergement serveur",
  "parc informatique", "maintenance informatique",
  "matériel informatique", "équipement informatique",
  "ordinateur", "laptop", "tablette numérique",
  "switch réseau", "routeur informatique", "firewall", "pare-feu informatique",
  "sauvegarde informatique", "backup informatique",
  "intelligence artificielle", "machine learning", "big data",
  "data science", "business intelligence",
  "cybersécurité", "sécurité informatique",
  "sécurité des systèmes d'information",
  "audit informatique", "audit de sécurité informatique",
  "schéma directeur informatique", "pentest",
  "formation en informatique", "formation informatique",
  "formation numérique", "formation cybersécurité",
  "IT equipment", "IT support", "IT services", "IT infrastructure",
  "information system", "information technology",
  "computer equipment", "software development", "network equipment",
  "ICT", "connectivity internet", "accès internet",
  "imprimantes",
];

const defaultSettings: SourcesSettings = {
  sources: [
    {
      id: "SRC-001",
      title: "ARMP Cameroun",
      url: "https://www.armp.cm",
      active: true,
      keywords: [],
    },
    {
      id: "SRC-002",
      title: "MINPOSTEL",
      url: "https://www.minpostel.gov.cm",
      active: true,
      keywords: [],
    },
  ],
  globalKeywords: DEFAULT_IT_KEYWORDS,
  companyDescription:
    "Entreprise spécialisée en systèmes d'information, développement logiciel, intelligence artificielle et transformation numérique.",
};

export default function SourcesSettingsPage() {
  const [saved, setSaved] = useState(false);
  const [settings, setSettings] = useState<SourcesSettings>(defaultSettings);
  const {
    status: collectProgress,
    active: collecting,
    elapsed: collectElapsed,
    startCollect,
  } = useCollectProgress();
  const [syncLoading, setSyncLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", url: "", keywords: [] as string[] });
  const [search, setSearch] = useState("");
  const [globalKwInput, setGlobalKwInput] = useState("");
  const [kwExpanded, setKwExpanded] = useState(false);
  const [sourceKwInput, setSourceKwInput] = useState("");
  const hasLoaded = useRef(false);
  const autosaveTimer = useRef<number | null>(null);
  const editFormRef = useRef<HTMLDivElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const normalizeSettings = (parsed: Partial<SourcesSettings> & { sources?: unknown }): SourcesSettings => {
      let normalizedSources = defaultSettings.sources;

      if (Array.isArray(parsed.sources)) {
        normalizedSources = parsed.sources
          .map((item, index) => {
            if (!item || typeof item !== "object") return null;
            const source = item as Partial<SourceItem>;
            if (typeof source.title !== "string" || typeof source.url !== "string") return null;
            return {
              id: typeof source.id === "string" ? source.id : `SRC-${String(index + 1).padStart(3, "0")}`,
              title: source.title,
              url: source.url,
              active: source.active !== false,
              keywords: normalizeKeywordList((source as Partial<SourceItem>).keywords),
            };
          })
          .filter((item): item is SourceItem => Boolean(item));
      }

      return {
        sources: normalizedSources,
        globalKeywords: Array.isArray((parsed as SourcesSettings).globalKeywords)
          ? normalizeKeywordList((parsed as SourcesSettings).globalKeywords)
          : defaultSettings.globalKeywords ?? [],
        companyDescription:
          typeof (parsed as SourcesSettings).companyDescription === "string"
            ? (parsed as SourcesSettings).companyDescription
            : defaultSettings.companyDescription,
      };
    };

    const load = async () => {
      // Priorité au backend (source de vérité pour le filtrage côté API).
      setSyncLoading(true);
      try {
        const remote = await apiJson<unknown>("/settings/sources");
        if (remote && typeof remote === "object") {
          const normalized = normalizeSettings(remote as Partial<SourcesSettings>);
          setSettings(normalized);
          localStorage.setItem(SOURCES_SETTINGS_KEY, JSON.stringify(normalized));
          window.dispatchEvent(new CustomEvent("sources-settings-changed"));
          return;
        }
      } catch {
        // Fallback localStorage
      } finally {
        setSyncLoading(false);
      }

      try {
        const raw = localStorage.getItem(SOURCES_SETTINGS_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as Partial<SourcesSettings>;
        setSettings(normalizeSettings(parsed));
      } catch {
        setSettings(defaultSettings);
      }
    };

    void load();
  }, []);

  useEffect(() => {
    // Évite un autosave immédiatement après l'hydratation initiale.
    if (!hasLoaded.current) {
      hasLoaded.current = true;
      return;
    }
    if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);

    autosaveTimer.current = window.setTimeout(() => {
      const normalized: SourcesSettings = {
        ...settings,
        sources: settings.sources.map((s) => ({ ...s, keywords: normalizeKeywordList(s.keywords) })),
        globalKeywords: normalizeKeywordList(settings.globalKeywords ?? []),
        companyDescription: settings.companyDescription ?? "",
      };

      localStorage.setItem(SOURCES_SETTINGS_KEY, JSON.stringify(normalized));
      window.dispatchEvent(new CustomEvent("sources-settings-changed"));

      void apiJson("/settings/sources", {
        method: "PUT",
        body: JSON.stringify(normalized),
      }).catch((e) => {
        // On garde le localStorage même si le backend est KO.
        toast.error(e instanceof Error ? e.message : "Impossible d'enregistrer les sources côté backend");
      });

      setSaved(true);
      addAuditLog({
        action: "saved_settings",
        entityType: "sources_settings",
        details: `${normalized.sources.length} source(s) configurée(s)`,
      });
    }, 700);

    return () => {
      if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    };
  }, [settings]);

  const resetForm = () => {
    setForm({ title: "", url: "", keywords: [] });
    setEditingId(null);
  };

  const upsertSource = () => {
    if (!form.title.trim() || !form.url.trim()) return;

    const payload: SourceItem = {
      id: editingId ?? `SRC-${Date.now()}`,
      title: form.title.trim(),
      url: form.url.trim(),
      active: editingId ? settings.sources.find((item) => item.id === editingId)?.active !== false : true,
      keywords: [...form.keywords],
    };

    setSaved(false);
    setSettings((prev) => ({
      ...prev,
      sources: editingId
        ? prev.sources.map((item) => (item.id === editingId ? payload : item))
        : [payload, ...prev.sources],
    }));
    addAuditLog({
      action: editingId ? "updated" : "created",
      entityType: "source",
      entityId: payload.id,
      details: `${payload.title} (${payload.url})`,
    });
    resetForm();
  };

  const startEdit = (source: SourceItem) => {
    setEditingId(source.id);
    setForm({
      title: source.title,
      url: source.url,
      keywords: [...source.keywords],
    });
    // Laisser le temps au menu Radix de se fermer + au layout de se stabiliser avant mesure.
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const behavior: ScrollBehavior = reduceMotion ? "auto" : "smooth";

    const runScrollAndFocus = () => {
      const el = editFormRef.current;
      if (!el) return;
      // scroll-margin sur le bloc (scroll-mt-*) : évite que le titre colle au bord du viewport.
      el.scrollIntoView({ behavior, block: "start", inline: "nearest" });
      const focusDelay = reduceMotion ? 0 : 320;
      window.setTimeout(() => {
        titleInputRef.current?.focus({ preventScroll: true });
      }, focusDelay);
    };

    window.requestAnimationFrame(() => {
      window.setTimeout(runScrollAndFocus, 48);
    });
  };

  const deleteSource = (id: string) => {
    const target = settings.sources.find((item) => item.id === id);
    setSaved(false);
    setSettings((prev) => ({ ...prev, sources: prev.sources.filter((item) => item.id !== id) }));
    if (target) {
      addAuditLog({
        action: "deleted",
        entityType: "source",
        entityId: target.id,
        details: target.title,
      });
    }
    if (editingId === id) setEditingId(null);
  };

  const filteredSources = settings.sources.filter((source) => {
    const query = search.toLowerCase();
    const inKeywords = source.keywords.some((kw) => kw.toLowerCase().includes(query));
    return (
      source.title.toLowerCase().includes(query) ||
      source.url.toLowerCase().includes(query) ||
      inKeywords
    );
  });

  const runScrapeNow = async () => {
    if (collecting) return;
    localStorage.setItem(SOURCES_SETTINGS_KEY, JSON.stringify(settings));
    try {
      const started = await startCollect();
      if (!started) toast.message("Aucune source active configurée.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Collecte impossible");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold">Sources de veille</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Configurez les sites cibles pour le scraping.
          </p>
        </div>
        <Button type="button" size="sm" onClick={runScrapeNow} disabled={collecting}>
          {collecting ? "Collecte en cours…" : "Lancer une collecte"}
        </Button>
      </div>

      {collecting && (
        <CollectProgressCard status={collectProgress} elapsed={collectElapsed} />
      )}

      <div className="rounded-xl border p-3">
        <p className="text-sm font-medium">Collecte automatique</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Planifiée automatiquement les jours ouvrables (lundi à vendredi) à 08:00.
          Vous pouvez aussi lancer une collecte manuelle à tout moment avec le bouton ci-dessus.
        </p>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Filtrage sémantique par embeddings                                */}
      {/* ------------------------------------------------------------------ */}
      <div className="rounded-xl border p-4 space-y-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 h-8 w-8 shrink-0 rounded-lg bg-primary/10 flex items-center justify-center">
            <BrainCircuit className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Filtrage par mots-clés</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Mots-clés globaux appliqués à toutes les sources. Un appel d'offres est retenu
              uniquement si son titre contient au moins un de ces termes.
            </p>
          </div>
        </div>

        {/* Mots-clés globaux — tags avec croix */}
        <div className="space-y-2">
          {/* En-tête cliquable */}
          <button
            type="button"
            onClick={() => setKwExpanded((v) => !v)}
            className="w-full flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2 hover:bg-muted/40 transition-colors"
          >
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium cursor-pointer">Mots-clés globaux</label>
              <span className="text-[10px] rounded-full bg-primary/10 text-primary px-2 py-0.5 font-semibold">
                {(settings.globalKeywords ?? []).length}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSaved(false);
                  setSettings((prev) => ({ ...prev, globalKeywords: [...DEFAULT_IT_KEYWORDS] }));
                }}
                className="text-[10px] text-muted-foreground hover:text-primary underline underline-offset-2 transition-colors"
              >
                Restaurer les {DEFAULT_IT_KEYWORDS.length} par défaut
              </button>
              {kwExpanded
                ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              }
            </div>
          </button>

          {/* Tags — visibles uniquement si déplié */}
          {kwExpanded && (
            <div className="rounded-lg border bg-muted/5 p-3 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {(settings.globalKeywords ?? []).map((kw) => (
                  <span
                    key={kw}
                    className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2.5 py-0.5 text-xs font-medium"
                  >
                    {kw}
                    <button
                      type="button"
                      aria-label={`Supprimer « ${kw} »`}
                      onClick={() => {
                        setSaved(false);
                        setSettings((prev) => ({
                          ...prev,
                          globalKeywords: (prev.globalKeywords ?? []).filter((k) => k !== kw),
                        }));
                      }}
                      className="ml-0.5 rounded-full text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {(settings.globalKeywords ?? []).length === 0 && (
                  <span className="text-xs text-muted-foreground italic">Aucun mot-clé — toutes les offres passeront.</span>
                )}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <input
              value={globalKwInput}
              onChange={(e) => setGlobalKwInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  const kw = globalKwInput.trim();
                  if (kw && !(settings.globalKeywords ?? []).includes(kw)) {
                    setSaved(false);
                    setSettings((prev) => ({
                      ...prev,
                      globalKeywords: [...(prev.globalKeywords ?? []), kw],
                    }));
                  }
                  setGlobalKwInput("");
                }
              }}
              placeholder="Ajouter un mot-clé…"
              className="h-8 flex-1 rounded-md border bg-background px-3 text-xs"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 px-3 text-xs"
              onClick={() => {
                const kw = globalKwInput.trim();
                if (kw && !(settings.globalKeywords ?? []).includes(kw)) {
                  setSaved(false);
                  setSettings((prev) => ({
                    ...prev,
                    globalKeywords: [...(prev.globalKeywords ?? []), kw],
                  }));
                }
                setGlobalKwInput("");
              }}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Ajouter
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {(settings.globalKeywords ?? []).length} terme(s). Appuyez sur Entrée ou virgule pour ajouter.
          </p>
        </div>

        {/* Description entreprise */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium">Description de l'entreprise</label>
          <textarea
            value={settings.companyDescription ?? ""}
            onChange={(e) => {
              setSaved(false);
              setSettings((prev) => ({ ...prev, companyDescription: e.target.value }));
            }}
            placeholder="Ex : Entreprise spécialisée en systèmes d'information, développement logiciel, intelligence artificielle et transformation numérique…"
            rows={3}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-y"
          />
        </div>

      </div>

      <div
        ref={editFormRef}
        className="rounded-xl border p-4 space-y-3 scroll-mt-20 md:scroll-mt-24"
        id="source-edit-form"
      >
        <h3 className="text-sm font-semibold" id="source-edit-form-title">
          {editingId ? "Modifier une source" : "Ajouter une source"}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr_auto] gap-2">
          <input
            ref={titleInputRef}
            value={form.title}
            onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
            placeholder="Intitulé de la source"
            className="h-9 rounded-md border bg-background px-3 text-sm"
            aria-labelledby="source-edit-form-title"
          />
          <input
            value={form.url}
            onChange={(e) => setForm((prev) => ({ ...prev, url: e.target.value }))}
            placeholder="https://…"
            className="h-9 rounded-md border bg-background px-3 text-sm"
          />
          <div className="flex items-center gap-2">
            <Button type="button" onClick={upsertSource}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              {editingId ? "Mettre à jour" : "Ajouter"}
            </Button>
            {editingId && (
              <Button type="button" variant="outline" onClick={resetForm}>
                Annuler
              </Button>
            )}
          </div>
        </div>

        {/* Mots-clés propres à cette source */}
        <div className="space-y-2 pt-1">
          <label className="text-xs font-medium text-muted-foreground">Mots-clés spécifiques à cette source</label>
          <div className="flex flex-wrap gap-1.5 min-h-[28px]">
            {form.keywords.map((kw) => (
              <span
                key={kw}
                className="inline-flex items-center gap-1 rounded-full border bg-primary/10 text-primary px-2.5 py-0.5 text-xs font-medium"
              >
                {kw}
                <button
                  type="button"
                  aria-label={`Supprimer « ${kw} »`}
                  onClick={() => setForm((prev) => ({ ...prev, keywords: prev.keywords.filter((k) => k !== kw) }))}
                  className="ml-0.5 rounded-full hover:text-foreground transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={sourceKwInput}
              onChange={(e) => setSourceKwInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  const kw = sourceKwInput.trim();
                  if (kw && !form.keywords.includes(kw)) {
                    setForm((prev) => ({ ...prev, keywords: [...prev.keywords, kw] }));
                  }
                  setSourceKwInput("");
                }
              }}
              placeholder="Mot-clé spécifique…"
              className="h-8 flex-1 rounded-md border bg-background px-3 text-xs"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 px-3 text-xs"
              onClick={() => {
                const kw = sourceKwInput.trim();
                if (kw && !form.keywords.includes(kw)) {
                  setForm((prev) => ({ ...prev, keywords: [...prev.keywords, kw] }));
                }
                setSourceKwInput("");
              }}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Ajouter
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border overflow-hidden">
        <div className="p-3 border-b bg-muted/20">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher une source (intitule, lien...)"
              className="h-9 w-full rounded-md border bg-background pl-9 pr-9 text-sm"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:text-foreground"
                aria-label="Effacer la recherche"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.5fr)_minmax(0,1fr)_auto_auto] gap-2 bg-muted/40 px-3 py-2 text-xs font-semibold">
          <div>Intitulé</div>
          <div>URL</div>
          <div>Mots-clés (source)</div>
          <div>Statut</div>
          <div className="text-right">Actions</div>
        </div>
        <div className="divide-y">
          {filteredSources.map((source) => (
            <div
              key={source.id}
              className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.5fr)_minmax(0,1fr)_auto_auto] gap-2 items-center px-3 py-2 text-sm"
            >
              <div className="font-medium min-w-0">{source.title}</div>
              <div className="text-muted-foreground truncate min-w-0" title={source.url}>
                {source.url}
              </div>
              <div
                className="text-xs text-muted-foreground truncate min-w-0"
                title={source.keywords.length ? source.keywords.join(", ") : undefined}
              >
                {keywordsPreview(source.keywords)}
              </div>
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSaved(false);
                    setSettings((prev) => ({
                      ...prev,
                      sources: prev.sources.map((item) =>
                        item.id === source.id ? { ...item, active: !item.active } : item,
                      ),
                    }));
                    addAuditLog({
                      action: "toggled_status",
                      entityType: "source",
                      entityId: source.id,
                      details: `${source.title} -> ${source.active ? "Inactif" : "Actif"}`,
                    });
                  }}
                  className={source.active ? "text-emerald-600" : "text-muted-foreground"}
                >
                  {source.active ? "Actif" : "Inactif"}
                </Button>
              </div>
              <div className="flex items-center justify-end">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      aria-label="Actions sur la source"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => startEdit(source)}>
                      <Pencil className="mr-2 h-4 w-4" />
                      Modifier
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                      onClick={() => setPendingDeleteId(source.id)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Supprimer
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
          {filteredSources.length === 0 && (
            <div className="px-3 py-5 text-sm text-muted-foreground text-center">
              Aucune source trouvée.
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground">
          {saved ? "Paramètres sauvegardés." : "Sauvegarde…"}
        </span>
      </div>

      <AlertDialog open={Boolean(pendingDeleteId)} onOpenChange={(open) => !open && setPendingDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la suppression</AlertDialogTitle>
            <AlertDialogDescription>
              Cette source sera retiree du tableau. Vous pourrez enregistrer ensuite pour persister le changement.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!pendingDeleteId) return;
                deleteSource(pendingDeleteId);
                setPendingDeleteId(null);
              }}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

