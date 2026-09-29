/**
 * CompanySettingsPage — Paramètres > Entreprise
 *
 * UX : rubriques repliables, chacune éditable et sauvegardable indépendamment
 * (PUT partiel — le backend fusionne avec le profil existant).
 *
 * Le contenu est découpé en modules sous ./company/ :
 *   types.ts      — types du profil + constantes
 *   fields.tsx    — champs réutilisables (tags, référentiel, niveaux)
 *   personnel.tsx — carte/formulaire/éditeur du personnel clé
 *   editors.tsx   — éditeurs certifications / compétences / projets
 *   views.tsx     — vues en lecture + SectionCard + SECTION_FIELDS
 */

import { useEffect, useRef, useState } from "react";
import { apiJson } from "@/lib/api";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { EMPTY_PROFILE, type CompanyProfile } from "./company/types";
import { SECTION_FIELDS, type SectionKey } from "./company/views";
import { ProfileSectionsEditor } from "./company/ProfileSectionsEditor";

// ── Ré-exports de compatibilité (PersonnelDetailPage et autres consommateurs) ──
export type {
  Certification, Competency, PersonnelDiploma, Personnel,
  PersonnelCv, PastProject, CompanyProfile,
} from "./company/types";
export { PersonnelFormDialog, clonePersonnel, EMPTY_PERSONNEL } from "./company/personnel";

// ─── Main component ────────────────────────────────────────────────────────────

export default function CompanySettingsPage() {
  const [profile, setProfile] = useState<CompanyProfile>(EMPTY_PROFILE);
  const [draft, setDraft] = useState<CompanyProfile>(EMPTY_PROFILE);
  const [editing, setEditing] = useState<SectionKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const hasLoaded = useRef(false);

  useEffect(() => {
    if (hasLoaded.current) return;
    hasLoaded.current = true;
    apiJson<CompanyProfile>("settings/company")
      .then((data) => {
        const merged = { ...EMPTY_PROFILE, ...data };
        setProfile(merged);
        setDraft(merged);
      })
      .catch(() => toast.error("Impossible de charger le profil entreprise."))
      .finally(() => setLoading(false));
  }, []);

  const enterEdit = (section: SectionKey) => {
    setDraft({ ...profile });
    setEditing(section);
  };
  const cancelEdit = () => {
    setDraft({ ...profile });
    setEditing(null);
  };

  const updateDraft = <K extends keyof CompanyProfile>(key: K, value: CompanyProfile[K]) => {
    setDraft((p) => ({ ...p, [key]: value }));
  };

  /** Sauvegarde uniquement les champs de la rubrique en cours d'édition. */
  const saveSection = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const key of SECTION_FIELDS[editing]) {
        payload[key] = draft[key];
      }

      const saved = await apiJson<CompanyProfile>("settings/company", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      const merged = { ...EMPTY_PROFILE, ...saved };
      setProfile(merged);
      setDraft(merged);
      setEditing(null);
      toast.success("Rubrique enregistrée.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const validationMatch = msg.match(/\{.*\}/s);
      if (validationMatch) {
        try {
          const parsed = JSON.parse(validationMatch[0]);
          const details = (parsed.message as string[] | string | undefined);
          const list = Array.isArray(details) ? details.slice(0, 3).join(", ") : details;
          toast.error(`Données invalides : ${list}`);
          return;
        } catch { /* ignore */ }
      }
      toast.error("Erreur lors de la sauvegarde. Vérifiez votre connexion au backend.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Profil entreprise</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Données comparées aux exigences des DAO pour le scoring. Chaque rubrique se modifie et s'enregistre indépendamment.
        </p>
      </div>

      <ProfileSectionsEditor
        profile={profile}
        draft={draft}
        editing={editing}
        saving={saving}
        allowUploads
        onEditSection={enterEdit}
        onCancel={cancelEdit}
        onSaveSection={saveSection}
        updateDraft={updateDraft}
      />
    </div>
  );
}
