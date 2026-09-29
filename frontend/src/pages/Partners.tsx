import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Partner } from "@/lib/types";
import { Building2, MapPin, MoreVertical, Pencil, Trash2, Plus, Search, X, ArrowLeft, Users } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getPartners, savePartners } from "@/lib/partners-store";
import { moveToTrash } from "@/lib/trash-store";
import { PaginationControls } from "@/components/PaginationControls";
import { addAuditLog } from "@/lib/audit-logs";
import { EMPTY_PROFILE, type CompanyProfile } from "@/pages/settings/company/types";
import { SECTION_FIELDS, type SectionKey } from "@/pages/settings/company/views";
import { ProfileSectionsEditor } from "@/pages/settings/company/ProfileSectionsEditor";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ITEMS_PER_PAGE = 6;

function buildNextPartnerId(items: Partner[]): string {
  const max = items.reduce((acc, item) => {
    const numeric = Number(item.id.replace("P-", ""));
    return Number.isFinite(numeric) ? Math.max(acc, numeric) : acc;
  }, 0);
  return `P-${String(max + 1).padStart(3, "0")}`;
}

function partnerLabel(p: Partner): string {
  return p.company_name?.trim() || `Partenaire ${p.id}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Éditeur d'un partenaire : réutilise EXACTEMENT les rubriques du profil
// entreprise (ProfileSectionsEditor), sans les téléversements CV/diplômes.
// ─────────────────────────────────────────────────────────────────────────────

function PartnerProfileEditor({
  partner, allPartners, onBack, onPersist,
}: {
  partner: Partner;
  allPartners: Partner[];
  onBack: () => void;
  onPersist: (next: Partner[]) => void;
}) {
  const [profile, setProfile] = useState<CompanyProfile>(partner);
  const [draft, setDraft] = useState<CompanyProfile>(partner);
  const [editing, setEditing] = useState<SectionKey | null>(null);
  const [saving, setSaving] = useState(false);

  const enterEdit = (section: SectionKey) => { setDraft({ ...profile }); setEditing(section); };
  const cancelEdit = () => { setDraft({ ...profile }); setEditing(null); };
  const updateDraft = <K extends keyof CompanyProfile>(key: K, value: CompanyProfile[K]) => {
    setDraft((p) => ({ ...p, [key]: value }));
  };

  /** Enregistre uniquement les champs de la rubrique en cours, sur l'objet partenaire complet. */
  const saveSection = () => {
    if (!editing) return;
    setSaving(true);
    try {
      const merged: Partner = { ...(profile as Partner), id: partner.id };
      for (const key of SECTION_FIELDS[editing]) {
        (merged as Record<string, unknown>)[key] = (draft as Record<string, unknown>)[key];
      }
      const next = allPartners.map((p) => (p.id === partner.id ? merged : p));
      onPersist(next);
      addAuditLog({ action: "updated", entityType: "partner", entityId: merged.id, details: partnerLabel(merged) });
      setProfile(merged);
      setDraft(merged);
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 shrink-0">
          <ArrowLeft className="h-4 w-4" /> Partenaires
        </Button>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold truncate">{partnerLabel(profile)}</h2>
          <p className="text-xs text-muted-foreground">
            Profil identique à l'entreprise — sert au scoring et aux recommandations de groupement.
          </p>
        </div>
      </div>

      <ProfileSectionsEditor
        profile={profile}
        draft={draft}
        editing={editing}
        saving={saving}
        allowUploads={false}
        onEditSection={enterEdit}
        onCancel={cancelEdit}
        onSaveSection={saveSection}
        updateDraft={updateDraft}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function Partners({ embedded = false }: { embedded?: boolean }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Partner | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchParams, setSearchParams] = useSearchParams();

  const partners = useMemo(() => getPartners(), [refreshKey]);

  // Deep-link depuis une reco de groupement : /partners?focus=P-00X ouvre le profil.
  useEffect(() => {
    const focus = searchParams.get("focus");
    if (focus && partners.some((p) => p.id === focus)) {
      setEditingId(focus);
      searchParams.delete("focus");
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, partners]);

  const filteredPartners = partners.filter((partner) => {
    const q = search.toLowerCase();
    const hay = [
      partner.company_name, partner.legal_form, partner.city, partner.country,
      (partner.domaines ?? []).join(" "),
      (partner.competencies ?? []).map((c) => c.domain).join(" "),
      partner.strengths,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
  const totalPages = Math.max(1, Math.ceil(filteredPartners.length / ITEMS_PER_PAGE));
  const paginatedPartners = filteredPartners.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const persistPartners = (next: Partner[]) => {
    savePartners(next);
    setRefreshKey((v) => v + 1);
  };

  const handleAdd = () => {
    const id = buildNextPartnerId(partners);
    const fresh: Partner = { ...EMPTY_PROFILE, id, company_name: "" };
    persistPartners([fresh, ...partners]);
    addAuditLog({ action: "created", entityType: "partner", entityId: id, details: "Nouveau partenaire" });
    setEditingId(id);
  };

  const handleDelete = (id: string) => {
    const partner = partners.find((item) => item.id === id);
    if (partner) {
      moveToTrash({ type: "partner", label: partnerLabel(partner), description: `Partenaire ${partner.id}`, payload: partner });
      addAuditLog({ action: "moved_to_trash", entityType: "partner", entityId: partner.id, details: partnerLabel(partner) });
    }
    persistPartners(partners.filter((item) => item.id !== id));
    if (editingId === id) setEditingId(null);
  };

  // ── Vue édition d'un partenaire ──
  const editingPartner = editingId ? partners.find((p) => p.id === editingId) ?? null : null;
  if (editingPartner) {
    return (
      <div className={embedded ? "" : "space-y-2"}>
        <PartnerProfileEditor
          partner={editingPartner}
          allPartners={partners}
          onBack={() => setEditingId(null)}
          onPersist={persistPartners}
        />
      </div>
    );
  }

  // ── Vue liste ──
  return (
    <div className={embedded ? "space-y-4" : "space-y-6"}>
      {!embedded && (
        <PageHeader
          icon={Building2}
          title="Partenaires"
          description="Chaque partenaire dispose du même profil qu'une entreprise, afin d'alimenter les recommandations de groupement."
        />
      )}

      <div className="flex items-center justify-between gap-3">
        {embedded && (
          <p className="text-xs text-muted-foreground">
            Profils partenaires (identiques à l'entreprise) utilisés pour les groupements.
          </p>
        )}
        <Button onClick={handleAdd} variant="default" size="sm" className="ml-auto">
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Ajouter un partenaire
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Rechercher (nom, domaine, ville, compétence…)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 pr-9"
        />
        {search && (
          <button type="button" onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:text-foreground" aria-label="Effacer la recherche">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="space-y-3">
        {paginatedPartners.map((partner, i) => {
          const domaines = partner.domaines ?? [];
          const competencies = partner.competencies ?? [];
          const personnelCount = (partner.personnel ?? []).length;
          return (
            <motion.div
              key={partner.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: ((currentPage - 1) * ITEMS_PER_PAGE + i) * 0.03 }}
              className="bg-card rounded-xl border p-4 hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => setEditingId(partner.id)}
            >
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                    <h3 className="font-semibold text-sm truncate">{partnerLabel(partner)}</h3>
                    {partner.legal_form && (
                      <span className="text-[10px] px-2 py-0.5 rounded-md bg-muted text-muted-foreground shrink-0">{partner.legal_form}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {[partner.city, partner.country].filter(Boolean).join(", ") || "Non renseigné"}
                    </span>
                    {personnelCount > 0 && (
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" /> {personnelCount} expert{personnelCount > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  {(domaines.length > 0 || competencies.length > 0) && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {domaines.slice(0, 4).map((d) => (
                        <span key={d} className="rounded-md bg-muted text-muted-foreground px-2 py-0.5 text-[11px] font-medium">{d}</span>
                      ))}
                      {competencies.length > 0 && (
                        <span className="rounded-md bg-primary/10 text-primary px-2 py-0.5 text-[11px] font-medium">
                          {competencies.length} compétence{competencies.length > 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" aria-label={`Actions pour ${partnerLabel(partner)}`}>
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setEditingId(partner.id)}>
                        <Pencil className="mr-2 h-4 w-4" /> Modifier le profil
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive focus:bg-destructive/10 focus:text-destructive" onClick={() => setPendingDelete(partner)}>
                        <Trash2 className="mr-2 h-4 w-4" /> Supprimer
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </motion.div>
          );
        })}
        {filteredPartners.length === 0 && (
          <EmptyState
            icon={Building2}
            title="Aucun partenaire"
            description="Ajoutez un partenaire pour enrichir les recommandations de groupement."
            action={
              <Button size="sm" onClick={handleAdd}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Ajouter un partenaire
              </Button>
            }
          />
        )}
        <PaginationControls currentPage={currentPage} totalItems={filteredPartners.length} itemsPerPage={ITEMS_PER_PAGE} onPageChange={setCurrentPage} />
      </div>

      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la suppression</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `Voulez-vous vraiment supprimer le partenaire "${partnerLabel(pendingDelete)}" ? Il sera déplacé dans la corbeille.`
                : "Cette action déplace l'élément dans la corbeille."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!pendingDelete) return;
                handleDelete(pendingDelete.id);
                setPendingDelete(null);
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
