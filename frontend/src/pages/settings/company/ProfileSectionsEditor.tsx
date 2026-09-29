/**
 * ProfileSectionsEditor — rendu partagé des rubriques d'un profil d'organisation.
 *
 * Réutilisé À L'IDENTIQUE par le profil Entreprise (Paramètres > Entreprise) et
 * par le profil d'un Partenaire (Partenaires). C'est ce composant qui garantit
 * que « Partenaire est à l'image de Entreprise » : même structure, mêmes champs,
 * mêmes éditeurs. Seule différence pilotée par `allowUploads` : les partenaires
 * n'exposent pas le téléversement des scans CV/diplômes.
 */
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

import type { CompanyProfile } from "./types";
import { Field, TagInput, Textarea } from "./fields";
import { PersonnelEditor } from "./personnel";
import { CertificationsEditor, CompetenciesEditor, PastProjectsEditor } from "./editors";
import {
  CatalogView, CertificationsView, ComplianceView, CompetenciesView,
  IdentityView, PersonnelView, ProjectsView,
  SectionCard, type SectionKey,
} from "./views";

export type ProfileSectionsEditorProps = {
  profile: CompanyProfile;
  draft: CompanyProfile;
  editing: SectionKey | null;
  saving: boolean;
  /** Autorise le téléversement des CV/diplômes (true pour l'entreprise, false pour un partenaire). */
  allowUploads?: boolean;
  onEditSection: (key: SectionKey) => void;
  onCancel: () => void;
  onSaveSection: () => void;
  updateDraft: <K extends keyof CompanyProfile>(key: K, value: CompanyProfile[K]) => void;
};

export function ProfileSectionsEditor({
  profile, draft, editing, saving, allowUploads = true,
  onEditSection, onCancel, onSaveSection, updateDraft,
}: ProfileSectionsEditorProps) {
  const sectionProps = (key: SectionKey) => ({
    isEditing: editing === key,
    canEdit: editing === null,
    saving,
    onEdit: () => onEditSection(key),
    onCancel,
    onSave: onSaveSection,
  });

  return (
    <div className="space-y-4">
      {/* ── Identité et informations générales ── */}
      <SectionCard
        title="Identité et informations générales"
        description="Raison sociale, immatriculation, capacité financière."
        {...sectionProps("identity")}
      >
        {editing === "identity" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Raison sociale"><Input value={draft.company_name ?? ""} onChange={(e) => updateDraft("company_name", e.target.value)} placeholder="KIAMA Technologies SARL" /></Field>
            <Field label="Forme juridique"><Input value={draft.legal_form ?? ""} onChange={(e) => updateDraft("legal_form", e.target.value)} placeholder="SARL, SA, GIE…" /></Field>
            <Field label="Pays"><Input value={draft.country ?? ""} onChange={(e) => updateDraft("country", e.target.value)} placeholder="Cameroun" /></Field>
            <Field label="Ville / siège"><Input value={draft.city ?? ""} onChange={(e) => updateDraft("city", e.target.value)} placeholder="Douala" /></Field>
            <Field label="RCCM, NIU et numéros d'immatriculation" col2><Input value={draft.registration_ids ?? ""} onChange={(e) => updateDraft("registration_ids", e.target.value)} placeholder="RCCM CM-DLA-… ; NIU M…" /></Field>
            <Field label="Chiffre d'affaires annuel (FCFA)"><Input type="number" min={0} value={draft.annual_revenue ?? ""} onChange={(e) => updateDraft("annual_revenue", Number(e.target.value))} placeholder="100000000" /></Field>
            <Field label="Trésorerie disponible (FCFA)"><Input type="number" min={0} value={draft.available_cash ?? ""} onChange={(e) => updateDraft("available_cash", Number(e.target.value))} placeholder="15000000" /></Field>
            <Field label="Ligne de crédit (FCFA)"><Input type="number" min={0} value={draft.credit_line ?? ""} onChange={(e) => updateDraft("credit_line", Number(e.target.value))} placeholder="25000000" /></Field>
            <Field label="Description générale" col2><Textarea value={draft.description ?? ""} onChange={(v) => updateDraft("description", v)} placeholder="Présentation synthétique de l'organisation et de ses activités principales." rows={4} /></Field>
            <Field label="Années d'expérience (domaines visés)"><Input value={draft.years_experience ?? ""} onChange={(e) => updateDraft("years_experience", e.target.value)} placeholder="Ex. 10 ans en systèmes d'information" /></Field>
            <Field label="Effectifs"><Input value={draft.staff_headcount ?? ""} onChange={(e) => updateDraft("staff_headcount", e.target.value)} placeholder="Ex. 25 dont 8 ingénieurs" /></Field>
          </div>
        ) : (
          <IdentityView profile={profile} />
        )}
      </SectionCard>

      {/* ── Certifications et agréments ── */}
      <SectionCard
        title="Certifications et agréments"
        description="ISO, labels, agréments techniques et qualifications réglementaires."
        {...sectionProps("certifications")}
      >
        {editing === "certifications" ? (
          <div className="space-y-4">
            <CertificationsEditor value={draft.certifications ?? []} onChange={(v) => updateDraft("certifications", v)} />
            <Separator />
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Qualifications réglementaires supplémentaires</Label>
              <Textarea value={draft.technical_qualifications ?? ""} onChange={(v) => updateDraft("technical_qualifications", v)} placeholder="Agréments catégorie X, habilitation secteur public…" />
            </div>
          </div>
        ) : (
          <CertificationsView profile={profile} />
        )}
      </SectionCard>

      {/* ── Référentiel technologies & domaines ── */}
      <SectionCard
        title="Référentiel technologies & domaines"
        description="Liste centrale : seuls ces termes sont sélectionnables dans les projets, compétences et profils (casse unifiée)."
        {...sectionProps("catalog")}
      >
        {editing === "catalog" ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Technologies</Label>
              <TagInput value={draft.technologies_catalog ?? []} onChange={(v) => updateDraft("technologies_catalog", v)} placeholder="java, react, docker… (Entrée pour valider)" />
            </div>
            <Separator />
            <div className="space-y-1.5">
              <Label>Domaines</Label>
              <TagInput value={draft.domains_catalog ?? []} onChange={(v) => updateDraft("domains_catalog", v)} placeholder="Cybersécurité, E-administration… (Entrée)" />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Supprimer un terme du référentiel ne le retire pas des projets/profils où il est déjà utilisé.
            </p>
          </div>
        ) : (
          <CatalogView profile={profile} />
        )}
      </SectionCard>

      {/* ── Compétences par domaine ── */}
      <SectionCard
        title="Compétences par domaine"
        description="Domaines d'expertise avec mots-clés et niveau. Utilisés pour le score_tech des DAO."
        {...sectionProps("competencies")}
      >
        {editing === "competencies" ? (
          <CompetenciesEditor value={draft.competencies ?? []} onChange={(v) => updateDraft("competencies", v)} techOptions={draft.technologies_catalog ?? []} />
        ) : (
          <CompetenciesView profile={profile} />
        )}
      </SectionCard>

      {/* ── Personnel clé ── */}
      <SectionCard
        title="Personnel clé"
        description="Profils individuels : rôle, certifications, expérience. Comparés aux exigences des DAO."
        {...sectionProps("personnel")}
      >
        {editing === "personnel" ? (
          <PersonnelEditor value={draft.personnel ?? []} onChange={(v) => updateDraft("personnel", v)} pastProjects={draft.past_projects ?? []} techOptions={draft.technologies_catalog ?? []} allowUploads={allowUploads} />
        ) : (
          <PersonnelView profile={profile} />
        )}
      </SectionCard>

      {/* ── Projets de référence ── */}
      <SectionCard
        title="Projets de référence"
        description="Marchés similaires et réalisations. Les technologies/domaines enrichissent le corpus de scoring."
        {...sectionProps("projects")}
      >
        {editing === "projects" ? (
          <PastProjectsEditor value={draft.past_projects ?? []} onChange={(v) => updateDraft("past_projects", v)} personnel={draft.personnel ?? []} techOptions={draft.technologies_catalog ?? []} domainOptions={draft.domains_catalog ?? []} />
        ) : (
          <ProjectsView profile={profile} />
        )}
      </SectionCard>

      {/* ── Zones, coopération et conformité ── */}
      <SectionCard
        title="Zones, coopération et conformité"
        description="Zones d'intervention, groupements, conformité fiscale/sociale."
        {...sectionProps("compliance")}
      >
        {editing === "compliance" ? (
          <div className="space-y-4">
            <div className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Présence &amp; langues</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Zones d'intervention" col2><Textarea value={draft.intervention_zones ?? ""} onChange={(v) => updateDraft("intervention_zones", v)} placeholder="Cameroun, Afrique Centrale (CEMAC)…" rows={2} /></Field>
                <Field label="Langues de travail"><Input value={draft.languages ?? ""} onChange={(e) => updateDraft("languages", e.target.value)} placeholder="Français, Anglais" /></Field>
                <Field label="Assurances"><Input value={draft.insurance_coverage ?? ""} onChange={(e) => updateDraft("insurance_coverage", e.target.value)} placeholder="RC professionnelle…" /></Field>
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Coopération &amp; partenariats</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Expérience en groupement" col2><Textarea value={draft.consortium_experience ?? ""} onChange={(v) => updateDraft("consortium_experience", v)} placeholder="Chef de file ou membre sur quels types de marchés…" rows={2} /></Field>
                <Field label="Sous-traitance / co-traitants" col2><Textarea value={draft.partnership_capacity ?? ""} onChange={(v) => updateDraft("partnership_capacity", v)} placeholder="Capacité à mobiliser des partenaires…" rows={2} /></Field>
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Conformité &amp; capacité</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Conformité fiscale et sociale" col2><Textarea value={draft.fiscal_social_compliance ?? ""} onChange={(v) => updateDraft("fiscal_social_compliance", v)} placeholder="À jour des impôts, CNPS…" rows={2} /></Field>
                <Field label="Capacité financière (cautions, bilan)" col2><Textarea value={draft.financial_capacity_notes ?? ""} onChange={(v) => updateDraft("financial_capacity_notes", v)} placeholder="Décrit la capacité à couvrir cautions, avances…" rows={2} /></Field>
                <Field label="Moyens matériels et équipements majeurs" col2><Textarea value={draft.equipment_major_assets ?? ""} onChange={(v) => updateDraft("equipment_major_assets", v)} placeholder="Labs, licences logicielles critiques, serveurs…" rows={2} /></Field>
                <Field label="Atouts distinctifs (synthèse)" col2><Textarea value={draft.strengths ?? ""} onChange={(v) => updateDraft("strengths", v)} placeholder="Points forts pour le scoring et la décision interne…" rows={3} /></Field>
              </div>
            </div>
          </div>
        ) : (
          <ComplianceView profile={profile} />
        )}
      </SectionCard>
    </div>
  );
}
