/**
 * ConvertToReferenceDialog — capitalisation des marchés gagnés.
 *
 * Quand une soumission atteint la phase « attribué », ce dialogue convertit
 * le marché en PROJET DE RÉFÉRENCE du profil entreprise : pré-rempli depuis
 * l'opportunité (titre, année, budget), complété par l'utilisateur (client,
 * domaines/technologies du référentiel, experts impliqués).
 *
 * La boucle d'apprentissage : chaque marché gagné enrichit les références,
 * qui prouvent les domaines pratiqués des experts, qui renforcent la
 * qualification — donc le scoring — des prochains appels d'offres.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { apiJson } from "@/lib/api";
import { addAuditLog } from "@/lib/audit-logs";
import type { Opportunity } from "@/lib/types";
import type { CompanyProfile, PastProject, Personnel } from "@/pages/settings/CompanySettingsPage";
import { CatalogSelect, Textarea } from "@/pages/settings/company/fields";
import { accentConfig, avatarInitials } from "@/pages/settings/company/personnel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Trophy } from "lucide-react";

function parseBudgetFcfa(budget?: string): number | undefined {
  const digits = String(budget ?? "").replace(/[^\d]/g, "");
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function ConvertToReferenceDialog({
  opportunity,
  open,
  onOpenChange,
  onConverted,
}: {
  opportunity: Opportunity;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onConverted?: () => void;
}) {
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<PastProject>({ title: "" });

  // Charge le profil (personnel, référentiel, projets existants) à l'ouverture
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    apiJson<CompanyProfile>("settings/company")
      .then((data) => {
        setProfile(data);
        setDraft({
          title: opportunity.title,
          client: "",
          year: String(new Date(opportunity.deadline).getFullYear() || ""),
          budget_fcfa: parseBudgetFcfa(opportunity.budget),
          domains: [],
          technologies: [],
          description: "",
          personnel_names: [],
        });
      })
      .catch(() => toast.error("Impossible de charger le profil entreprise."))
      .finally(() => setLoading(false));
  }, [open, opportunity]);

  const personnel: Personnel[] = profile?.personnel ?? [];
  const alreadyConverted = useMemo(
    () =>
      (profile?.past_projects ?? []).some(
        (p) => p.title.trim().toLowerCase() === opportunity.title.trim().toLowerCase(),
      ),
    [profile, opportunity.title],
  );

  const togglePerson = (name: string) => {
    setDraft((d) => {
      const current = d.personnel_names ?? [];
      return {
        ...d,
        personnel_names: current.includes(name)
          ? current.filter((n) => n !== name)
          : [...current, name],
      };
    });
  };

  const save = async () => {
    if (!profile || !draft.title.trim()) return;
    setSaving(true);
    try {
      const nextProjects: PastProject[] = [...(profile.past_projects ?? []), draft];
      await apiJson("settings/company", {
        method: "PUT",
        body: JSON.stringify({ past_projects: nextProjects }),
      });
      addAuditLog({
        action: "convert_won_to_reference",
        entityType: "opportunity",
        entityId: opportunity.id,
        details: `Marché gagné converti en projet de référence : ${draft.title}`,
      });
      toast.success("Marché ajouté aux projets de référence.");
      onOpenChange(false);
      onConverted?.();
    } catch {
      toast.error("Erreur lors de l'ajout aux références.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-500" />
            Convertir en projet de référence
          </DialogTitle>
          <DialogDescription>
            Ce marché gagné rejoindra les références du profil entreprise : il prouvera
            les domaines pratiqués des experts rattachés et renforcera la qualification
            des prochains appels d'offres.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : alreadyConverted ? (
          <p className="rounded-lg border border-emerald-300/60 bg-emerald-500/5 px-3 py-2.5 text-sm text-emerald-700 dark:text-emerald-400">
            Un projet de référence porte déjà ce titre — ce marché semble déjà converti.
            Vous pouvez le retrouver dans Paramètres &gt; Entreprise &gt; Projets de référence.
          </p>
        ) : (
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-4 pr-3">
              <div className="space-y-1.5">
                <Label>Intitulé du projet *</Label>
                <Input
                  value={draft.title}
                  onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Client / Maître d'ouvrage</Label>
                  <Input
                    value={draft.client ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, client: e.target.value }))}
                    placeholder="MINFI, CAMTEL…"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Année</Label>
                  <Input
                    value={draft.year ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, year: e.target.value }))}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Budget (FCFA)</Label>
                <Input
                  type="number"
                  min={0}
                  value={draft.budget_fcfa ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      budget_fcfa: e.target.value ? Number(e.target.value) : undefined,
                    }))
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label>Domaines</Label>
                <CatalogSelect
                  value={draft.domains ?? []}
                  onChange={(v) => setDraft((d) => ({ ...d, domains: v }))}
                  options={profile?.domains_catalog ?? []}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Technologies utilisées</Label>
                <CatalogSelect
                  value={draft.technologies ?? []}
                  onChange={(v) => setDraft((d) => ({ ...d, technologies: v }))}
                  options={profile?.technologies_catalog ?? []}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea
                  value={draft.description ?? ""}
                  onChange={(v) => setDraft((d) => ({ ...d, description: v }))}
                  placeholder="Contexte et réalisations principales…"
                  rows={3}
                />
              </div>

              {personnel.length > 0 && (
                <div className="space-y-2">
                  <Label>Experts impliqués</Label>
                  <p className="text-[11px] text-muted-foreground">
                    Ils pourront faire valoir ce projet comme preuve de domaine pratiqué.
                  </p>
                  <div className="grid grid-cols-1 gap-1.5">
                    {personnel.map((p) => {
                      const selected = (draft.personnel_names ?? []).includes(p.name);
                      const acc = accentConfig(p.name);
                      const ini = avatarInitials(p.name);
                      return (
                        <button
                          key={p.name}
                          type="button"
                          onClick={() => togglePerson(p.name)}
                          className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                            selected
                              ? "border-primary/40 bg-primary/5"
                              : "border-border bg-muted/10 hover:bg-muted/30"
                          }`}
                        >
                          <div className={`h-7 w-7 rounded-lg shrink-0 flex items-center justify-center text-[10px] font-bold ring-1 ${acc.ring} ${acc.bg} ${acc.text}`}>
                            {ini}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium leading-none">{p.name}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{p.role}</p>
                          </div>
                          <div className={`h-4 w-4 rounded border shrink-0 flex items-center justify-center transition-colors ${selected ? "bg-primary border-primary" : "border-muted-foreground/40"}`}>
                            {selected && (
                              <svg className="h-2.5 w-2.5 text-primary-foreground" fill="none" viewBox="0 0 10 10">
                                <path d="M1.5 5L4 7.5 8.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {alreadyConverted ? "Fermer" : "Annuler"}
          </Button>
          {!alreadyConverted && !loading && (
            <Button type="button" onClick={save} disabled={saving || !draft.title.trim()} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Ajouter aux références
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
