import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

// ─────────────────────────────────────────────────────────────────────────────
// Réglages de notification — volontairement ÉPURÉS.
//
// Les notifications KIAMA sont 100 % in-app : elles sont dérivées des
// opportunités (rappels d'échéance hebdomadaires, changements de phase de
// soumission, résumés de collecte) et affichées dans l'application. Il n'existe
// pas de couche d'envoi e-mail / SMS / digest ; exposer de tels réglages
// afficherait des options sans effet. On ne garde donc QUE le filtrage de ce qui
// est affiché (catégories / urgences). La cadence des rappels est fixe (une fois
// par semaine, le lundi) ; la mise en silence se fait par appel d'offres depuis
// ses notifications.
// ─────────────────────────────────────────────────────────────────────────────

type NotificationCategory = "urgent" | "success" | "warning" | "info";

type NotificationsSettings = {
  filters: {
    urgencyOnly: boolean;
    categories: Record<NotificationCategory, boolean>;
  };
};

const NOTIFICATIONS_SETTINGS_KEY = "notifications_settings";

const defaultSettings: NotificationsSettings = {
  filters: {
    urgencyOnly: false,
    categories: { urgent: true, success: true, warning: true, info: true },
  },
};

function normalizeSettings(input: unknown): NotificationsSettings {
  const fb = defaultSettings;
  if (!input || typeof input !== "object") return fb;
  const raw = input as any;

  // Ancien format (channels/delivery/quietHours/reminders) : on ne récupère que
  // le filtrage, le reste (e-mail, SMS, digest, intensité) est abandonné.
  const filters = raw.filters ?? {};
  const cats = filters.categories ?? {};

  return {
    filters: {
      urgencyOnly: typeof filters.urgencyOnly === "boolean" ? filters.urgencyOnly : fb.filters.urgencyOnly,
      categories: {
        urgent: cats.urgent !== false,
        success: cats.success !== false,
        warning: cats.warning !== false,
        info: cats.info !== false,
      },
    },
  };
}

export default function NotificationsSettingsPage() {
  const [saved, setSaved] = useState(false);
  const [settings, setSettings] = useState<NotificationsSettings>(defaultSettings);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(NOTIFICATIONS_SETTINGS_KEY);
      if (!raw) return;
      setSettings(normalizeSettings(JSON.parse(raw) as unknown));
    } catch {
      setSettings(defaultSettings);
    }
  }, []);

  const save = () => {
    localStorage.setItem(NOTIFICATIONS_SETTINGS_KEY, JSON.stringify(settings));
    setSaved(true);
    // Rafraîchit immédiatement le badge et les listes qui écoutent l'événement.
    window.dispatchEvent(new CustomEvent("notifications-updated"));
  };

  const setCategory = (key: NotificationCategory, checked: boolean) => {
    setSaved(false);
    setSettings((prev) => ({
      ...prev,
      filters: { ...prev.filters, categories: { ...prev.filters.categories, [key]: checked } },
    }));
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Notifications</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Les notifications sont affichées dans l'application, dérivées de vos opportunités
          (échéances, changements de phase de soumission et collectes). Réglez ici ce qui s'affiche.
        </p>
      </div>

      {/* ── Filtrage ── */}
      <div className="rounded-xl border p-4 space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Affichage</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Choisissez les catégories à afficher. Le compteur de non-lues suit ce filtrage.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.filters.urgencyOnly}
            onChange={(e) => {
              setSaved(false);
              setSettings((prev) => ({
                ...prev,
                filters: { ...prev.filters, urgencyOnly: e.target.checked },
              }));
            }}
          />
          Afficher uniquement les notifications urgentes
        </label>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(
            [
              ["urgent", "Urgent"],
              ["warning", "Avertissement"],
              ["success", "Succès"],
              ["info", "Info"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.filters.categories[key]}
                onChange={(e) => setCategory(key, e.target.checked)}
                disabled={settings.filters.urgencyOnly && key !== "urgent"}
              />
              {label}
            </label>
          ))}
        </div>
        {settings.filters.urgencyOnly && (
          <p className="text-xs text-muted-foreground">
            Le mode « urgences uniquement » ignore les autres catégories.
          </p>
        )}
      </div>

      {/* ── Rappels d'échéance (politique fixe) ── */}
      <div className="rounded-xl border p-4 space-y-1.5">
        <h3 className="text-sm font-semibold">Rappels d'échéance</h3>
        <p className="text-xs text-muted-foreground">
          Un rappel par semaine (le lundi) pour chaque appel d'offres GO ou à étudier
          (score ≥ 50), non soumis et non expiré. Les appels d'offres faibles ou non encore
          scorés ne génèrent pas de rappel.
        </p>
        <p className="text-xs text-muted-foreground">
          Pour ne plus recevoir les notifications d'un appel d'offres précis, mettez-le en
          silence depuis ses notifications (bouton « Mettre en silence »). C'est réversible.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save}>Enregistrer</Button>
        {saved && <span className="text-xs text-muted-foreground">Paramètres enregistrés.</span>}
      </div>
    </div>
  );
}
