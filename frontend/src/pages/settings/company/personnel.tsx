/**
 * Personnel clé : carte, formulaire (réutilisé par la page de détail),
 * éditeur de liste et helpers visuels (avatars, accents).
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { getApiBaseUrl, uploadPersonnelCv, deletePersonnelCv, uploadDiplomaFile, deleteDiplomaFile } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Plus, Pencil, Trash2, X, MapPin, Star, Briefcase,
  GraduationCap, FileText, Loader2, CheckCircle2, Paperclip,
} from "lucide-react";
import type { Personnel, PersonnelCv, PersonnelDiploma, PastProject } from "./types";
import { CatalogSelect, SectionTitle, TagInput } from "./fields";

// ── Helpers carte personnel ───────────────────────────────────────────────────

export function avatarInitials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

type AccentConfig = {
  band: string;
  bg: string;
  text: string;
  ring: string;
  bar: string;
};

export function accentConfig(name: string): AccentConfig {
  const configs: AccentConfig[] = [
    { band: "bg-blue-400",    bg: "bg-blue-500/15",    text: "text-blue-700 dark:text-blue-400",    ring: "ring-blue-300/60 dark:ring-blue-700/50",    bar: "bg-blue-500"    },
    { band: "bg-emerald-400", bg: "bg-emerald-500/15", text: "text-emerald-700 dark:text-emerald-400", ring: "ring-emerald-300/60 dark:ring-emerald-700/50", bar: "bg-emerald-500" },
    { band: "bg-violet-400",  bg: "bg-violet-500/15",  text: "text-violet-700 dark:text-violet-400",  ring: "ring-violet-300/60 dark:ring-violet-700/50",  bar: "bg-violet-500"  },
    { band: "bg-amber-400",   bg: "bg-amber-500/15",   text: "text-amber-700 dark:text-amber-400",   ring: "ring-amber-300/60 dark:ring-amber-700/50",   bar: "bg-amber-500"   },
    { band: "bg-rose-400",    bg: "bg-rose-500/15",    text: "text-rose-700 dark:text-rose-400",     ring: "ring-rose-300/60 dark:ring-rose-700/50",     bar: "bg-rose-500"    },
    { band: "bg-cyan-400",    bg: "bg-cyan-500/15",    text: "text-cyan-700 dark:text-cyan-400",     ring: "ring-cyan-300/60 dark:ring-cyan-700/50",     bar: "bg-cyan-500"    },
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return configs[h % configs.length];
}

export function AvailabilityBadge({ value }: { value?: string }) {
  if (!value) return null;
  const lower = value.toLowerCase();
  const unavailable = lower.includes("indispo") || lower.includes("occup");
  const available = !unavailable && lower.includes("dispo");
  const cls = available
    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
    : unavailable
    ? "bg-rose-500/15 text-rose-700 dark:text-rose-400"
    : "bg-amber-500/15 text-amber-700 dark:text-amber-400";
  const dot = available ? "bg-emerald-500 animate-pulse" : unavailable ? "bg-rose-500" : "bg-amber-500";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {value}
    </span>
  );
}

// ── DiplomesEditor : liste structurée de diplômes ────────────────────────────

function DiplomesEditor({
  value,
  onChange,
  allowUploads = true,
}: {
  value: PersonnelDiploma[];
  onChange: (v: PersonnelDiploma[]) => void;
  allowUploads?: boolean;
}) {
  const empty: PersonnelDiploma = { degree: "", field: "", years_experience: undefined };
  const [draft, setDraft] = useState<PersonnelDiploma>(empty);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadIdx, setUploadIdx] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);

  const add = () => {
    if (!draft.degree.trim() || !draft.field.trim()) return;
    onChange([...value, draft]);
    setDraft(empty);
  };

  const startUpload = (i: number) => {
    setUploadIdx(i);
    fileInputRef.current?.click();
  };

  const handleDiplomaFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || uploadIdx === null) return;
    setUploading(true);
    try {
      const { filename, originalname } = await uploadDiplomaFile(file);
      onChange(value.map((d, j) => (j === uploadIdx ? { ...d, file: { filename, originalname } } : d)));
      toast.success("Scan du diplôme téléversé.");
    } catch {
      toast.error("Échec du téléversement (PDF, JPG ou PNG, 10 Mo max).");
    } finally {
      setUploading(false);
      setUploadIdx(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeDiplomaFile = async (i: number) => {
    const f = value[i]?.file;
    if (!f) return;
    try { await deleteDiplomaFile(f.filename); } catch { /* ignore */ }
    onChange(value.map((d, j) => (j === i ? { ...d, file: undefined } : d)));
  };

  const removeDiploma = (i: number) => {
    const f = value[i]?.file;
    if (f) void deleteDiplomaFile(f.filename).catch(() => undefined);
    onChange(value.filter((_, j) => j !== i));
  };

  return (
    <div className="space-y-2">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
        className="hidden"
        onChange={handleDiplomaFile}
      />
      {value.map((d, i) => (
        <div key={i} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
          <GraduationCap className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="flex-1">{d.degree} en {d.field}{d.years_experience ? ` · ${d.years_experience} ans` : ""}</span>
          {d.file ? (
            <span className="flex items-center gap-0.5 shrink-0">
              <a
                href={`${getApiBaseUrl()}/uploads/diplomas/${d.file.filename}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline px-1"
                title={`Voir le scan : ${d.file.originalname}`}
              >
                <FileText className="h-3 w-3" /> Scan
              </a>
              {allowUploads && (
                <Button type="button" size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground" title="Retirer le scan" disabled={uploading} onClick={() => removeDiplomaFile(i)}>
                  <X className="h-3 w-3" />
                </Button>
              )}
            </span>
          ) : allowUploads ? (
            <Button type="button" size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground shrink-0" title="Joindre le scan du diplôme (PDF, JPG, PNG)" disabled={uploading} onClick={() => startUpload(i)}>
              {uploading && uploadIdx === i ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
            </Button>
          ) : null}
          <Button type="button" size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => removeDiploma(i)}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <div className="grid grid-cols-3 gap-2">
        <Input value={draft.degree} onChange={(e) => setDraft((d) => ({ ...d, degree: e.target.value }))} placeholder="Master" className="h-8 text-xs" />
        <Input value={draft.field} onChange={(e) => setDraft((d) => ({ ...d, field: e.target.value }))} placeholder="Informatique" className="h-8 text-xs" />
        <div className="flex gap-1">
          <Input type="number" min={0} value={draft.years_experience ?? ""} onChange={(e) => setDraft((d) => ({ ...d, years_experience: e.target.value ? Number(e.target.value) : undefined }))} placeholder="Ans exp." className="h-8 text-xs" />
          <Button type="button" size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={add}><Plus className="h-3.5 w-3.5" /></Button>
        </div>
      </div>
    </div>
  );
}



// ── PersonnelCard ─────────────────────────────────────────────────────────────

export function PersonnelCard({
  p, onEdit, onRemove, onView, readOnly = false,
}: {
  p: Personnel;
  onEdit: () => void;
  onRemove: () => void;
  onView?: () => void;
  readOnly?: boolean;
}) {
  const initials = avatarInitials(p.name);
  const accent = accentConfig(p.name);
  const [showAllSkills, setShowAllSkills] = useState(false);
  const MAX_TAGS = 5;
  const skills = p.skills ?? [];
  const certs = p.certifications ?? [];
  const visibleTags = showAllSkills ? skills : skills.slice(0, MAX_TAGS);
  const extraCount = skills.length - MAX_TAGS;
  const diplomas = p.diplomas ?? [];
  const hasDiplomas = diplomas.length > 0;
  const hasEducation = !hasDiplomas && !!p.education;
  const hasStats = p.years_experience != null || p.projects_count != null || p.success_rate != null;
  const cvCount = (p.cv_files ?? []).length;

  return (
    <div
      className="group relative flex flex-col rounded-2xl border bg-card overflow-hidden transition-all duration-200 hover:border-border/60 hover:shadow-sm cursor-pointer"
      onClick={onView}
    >

      {/* Accent band */}
      <div className={`h-1 w-full shrink-0 ${accent.band}`} />

      <div className="flex flex-col flex-1 p-4 gap-3">

        {/* Header: avatar + identity + actions */}
        <div className="flex items-start gap-3">
          {/* Square avatar */}
          <div className={`h-11 w-11 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 ring-1 ${accent.ring} ${accent.bg} ${accent.text}`}>
            {initials}
          </div>

          <div className="flex-1 min-w-0 pt-0.5">
            <div className="font-semibold text-[13px] leading-snug truncate">{p.name}</div>
            <div className="text-xs text-muted-foreground leading-snug truncate mt-0.5">{p.role}</div>
            {p.location && (
              <div className="flex items-center gap-1 mt-1 text-[11px] text-muted-foreground/60">
                <MapPin className="h-2.5 w-2.5 shrink-0" /><span className="truncate">{p.location}</span>
              </div>
            )}
          </div>

          {/* Hover actions */}
          {!readOnly && (
            <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); onEdit(); }}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); onRemove(); }}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>

        {/* Availability + CV badge */}
        <div className="flex items-center gap-2 flex-wrap">
          {p.availability && <AvailabilityBadge value={p.availability} />}
          {cvCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-medium">
              <FileText className="h-2.5 w-2.5" /> {cvCount} CV{cvCount > 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Certifications */}
        {certs.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {certs.map((c) => (
              <span key={c} className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800/40 px-2 py-0.5 text-[11px] font-medium">
                <Star className="h-2.5 w-2.5 shrink-0" />
                {c}
              </span>
            ))}
          </div>
        )}

        {/* Formation */}
        {(hasDiplomas || hasEducation) && (
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              <GraduationCap className="h-3 w-3" /> Formation
            </div>
            <div className="space-y-0.5 pl-0.5">
              {hasDiplomas
                ? diplomas.map((d, i) => {
                    const obj = typeof d === "string"
                      ? { degree: d, field: "", years_experience: undefined }
                      : d as PersonnelDiploma;
                    return (
                      <div key={i} className="flex items-baseline justify-between gap-2 text-[12px]">
                        <span className="text-foreground/75 leading-snug">
                          {obj.degree}{obj.field ? <span className="text-muted-foreground"> · {obj.field}</span> : null}
                        </span>
                        {obj.years_experience != null && (
                          <span className="text-muted-foreground text-[11px] shrink-0 tabular-nums">{obj.years_experience} ans</span>
                        )}
                      </div>
                    );
                  })
                : <div className="text-[12px] text-foreground/75">{p.education}</div>
              }
            </div>
          </div>
        )}

        {/* Skills */}
        {skills.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {visibleTags.map((s) => (
              <span key={s} className="rounded-md bg-muted/70 text-foreground/65 px-2 py-0.5 text-[11px] font-medium">{s}</span>
            ))}
            {!showAllSkills && extraCount > 0 && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowAllSkills(true); }}
                className="rounded-md border border-dashed border-muted-foreground/40 text-muted-foreground/70 hover:border-primary/50 hover:text-primary hover:bg-primary/5 px-2 py-0.5 text-[11px] transition-colors cursor-pointer"
              >
                +{extraCount}
              </button>
            )}
            {showAllSkills && skills.length > MAX_TAGS && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowAllSkills(false); }}
                className="rounded-md border border-dashed border-muted-foreground/40 text-muted-foreground/70 hover:border-primary/50 hover:text-primary hover:bg-primary/5 px-2 py-0.5 text-[11px] transition-colors cursor-pointer"
              >
                −
              </button>
            )}
          </div>
        )}

        {/* Stats */}
        {hasStats && (
          <div className="mt-auto pt-3 border-t space-y-2">

            {/* Success rate progress bar */}
            {p.success_rate != null && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Star className="h-2.5 w-2.5" /> Réussite
                  </span>
                  <span className="text-[11px] font-semibold tabular-nums">{p.success_rate}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div className={`h-full rounded-full ${accent.bar} transition-all duration-500`} style={{ width: `${p.success_rate}%` }} />
                </div>
              </div>
            )}

            {/* Exp + Projects */}
            {(p.years_experience != null || p.projects_count != null) && (
              <div className="flex gap-4 text-[11px]">
                {p.years_experience != null && (
                  <div className="flex items-center gap-1.5">
                    <Briefcase className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="font-semibold tabular-nums">{p.years_experience}</span>
                    <span className="text-muted-foreground">ans</span>
                  </div>
                )}
                {p.projects_count != null && (
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="font-semibold tabular-nums">{p.projects_count}</span>
                    <span className="text-muted-foreground">projets</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

// ── PersonnelFormDialog ───────────────────────────────────────────────────────

const MAX_CV = 3;

export const EMPTY_PERSONNEL: Personnel = { name: "", role: "", certifications: [], years_experience: undefined, skills: [], diplomas: [], location: "", availability: "Disponible", daily_rate_fcfa: undefined, projects_count: undefined, success_rate: undefined, cv_files: [] };

export function clonePersonnel(p: Personnel): Personnel {
  return {
    ...p,
    certifications: [...(p.certifications ?? [])],
    skills: [...(p.skills ?? [])],
    diplomas: (p.diplomas ?? []).map((d) => ({ ...d })),
    cv_files: (p.cv_files ?? []).map((c) => ({ ...c })),
  };
}

/**
 * Formulaire d'ajout / modification d'un expert.
 * Réutilisé par Paramètres > Entreprise et par la page de détail d'un personnel clé.
 */
export function PersonnelFormDialog({
  open, onOpenChange, initial, onSave, isEdit, techOptions = [], allowUploads = true,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: Personnel;
  onSave: (p: Personnel) => void;
  isEdit: boolean;
  techOptions?: string[];
  allowUploads?: boolean;
}) {
  const [draft, setDraft] = useState<Personnel>(initial);
  const cvInputRef = useRef<HTMLInputElement>(null);
  const [cvUploading, setCvUploading] = useState(false);

  // Réinitialise le brouillon à chaque ouverture
  useEffect(() => {
    if (open) setDraft(clonePersonnel(initial));
  }, [open, initial]);

  const cvFiles = draft.cv_files ?? [];
  const canAddCv = cvFiles.length < MAX_CV;

  const handleCvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCvUploading(true);
    try {
      const { filename, originalname } = await uploadPersonnelCv(file);
      const newCv: PersonnelCv = { filename, originalname, uploaded_at: new Date().toISOString() };
      setDraft((d) => ({ ...d, cv_files: [...(d.cv_files ?? []), newCv] }));
      toast.success("CV ajouté.");
    } catch {
      toast.error("Échec de l'upload du CV.");
    } finally {
      setCvUploading(false);
      if (cvInputRef.current) cvInputRef.current.value = "";
    }
  };

  const handleDeleteCv = async (idx: number) => {
    const cv = cvFiles[idx];
    if (!cv) return;
    setCvUploading(true);
    try { await deletePersonnelCv(cv.filename); } catch { /* ignore */ }
    setDraft((d) => ({ ...d, cv_files: (d.cv_files ?? []).filter((_, i) => i !== idx) }));
    setCvUploading(false);
  };

  const save = () => {
    if (!draft.name.trim() || !draft.role.trim()) return;
    onSave(draft);
    onOpenChange(false);
  };

  return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Modifier" : "Ajouter"} un expert</DialogTitle>
            <DialogDescription>Profil individuel comparé aux exigences des DAO lors du scoring Groq.</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[65vh]">
            <div className="space-y-4 pr-3">

              {/* Identité */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5 col-span-2"><Label>Nom complet *</Label><Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Jean Dupont" /></div>
                <div className="space-y-1.5 col-span-2"><Label>Rôle / titre *</Label><Input value={draft.role} onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))} placeholder="Expert cybersécurité senior" /></div>
                <div className="space-y-1.5"><Label>Localisation</Label><Input value={draft.location ?? ""} onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))} placeholder="Yaoundé, Cameroun" /></div>
                <div className="space-y-1.5"><Label>Disponibilité</Label><Input value={draft.availability ?? ""} onChange={(e) => setDraft((d) => ({ ...d, availability: e.target.value }))} placeholder="Disponible" /></div>
              </div>

              {/* Diplômes structurés */}
              <div className="space-y-1.5">
                <Label>Formation & diplômes</Label>
                <p className="text-[11px] text-muted-foreground">Renseigne le niveau, le domaine et les années d'expérience associées.</p>
                <DiplomesEditor value={draft.diplomas ?? []} onChange={(v) => setDraft((d) => ({ ...d, diplomas: v }))} allowUploads={allowUploads} />
              </div>

              {/* Compétences et certifications */}
              <div className="space-y-1.5"><Label>Compétences techniques</Label><CatalogSelect value={draft.skills ?? []} onChange={(v) => setDraft((d) => ({ ...d, skills: v }))} options={techOptions} allowFree placeholder="Java, DevOps, gestion de projet…" /></div>
              <div className="space-y-1.5"><Label>Certifications professionnelles</Label><TagInput value={draft.certifications ?? []} onChange={(v) => setDraft((d) => ({ ...d, certifications: v }))} placeholder="PMP, ITIL v4, CISSP… (Entrée)" /></div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Années d'expérience totales</Label><Input type="number" min={0} value={draft.years_experience ?? ""} onChange={(e) => setDraft((d) => ({ ...d, years_experience: e.target.value ? Number(e.target.value) : undefined }))} placeholder="10" /></div>
                <div className="space-y-1.5"><Label>Projets réalisés</Label><Input type="number" min={0} value={draft.projects_count ?? ""} onChange={(e) => setDraft((d) => ({ ...d, projects_count: e.target.value ? Number(e.target.value) : undefined }))} placeholder="25" /></div>
                <div className="space-y-1.5"><Label>Taux de réussite (%)</Label><Input type="number" min={0} max={100} value={draft.success_rate ?? ""} onChange={(e) => setDraft((d) => ({ ...d, success_rate: e.target.value ? Number(e.target.value) : undefined }))} placeholder="95" /></div>
                <div className="space-y-1.5"><Label>TJM (FCFA)</Label><Input type="number" min={0} value={draft.daily_rate_fcfa ?? ""} onChange={(e) => setDraft((d) => ({ ...d, daily_rate_fcfa: e.target.value ? Number(e.target.value) : undefined }))} placeholder="150 000" /></div>
              </div>

              {/* CVs — jusqu'à 3 (masqué pour les partenaires) */}
              {allowUploads && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Curriculum Vitae <span className="text-muted-foreground font-normal">({cvFiles.length}/{MAX_CV})</span></Label>
                </div>
                <input
                  ref={cvInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  className="hidden"
                  onChange={handleCvUpload}
                />
                {cvFiles.length > 0 && (
                  <div className="space-y-1.5">
                    {cvFiles.map((cv, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2">
                        <FileText className="h-4 w-4 text-primary shrink-0" />
                        <span className="text-xs text-muted-foreground flex-1 truncate">{cv.originalname}</span>
                        <a
                          href={`${getApiBaseUrl()}/uploads/cv/${cv.filename}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline shrink-0"
                        >
                          Voir
                        </a>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 text-destructive shrink-0"
                          onClick={() => handleDeleteCv(i)}
                          disabled={cvUploading}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2 h-8 text-xs"
                    onClick={() => cvInputRef.current?.click()}
                    disabled={cvUploading || !canAddCv}
                  >
                    {cvUploading
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <FileText className="h-3.5 w-3.5" />}
                    Ajouter un CV
                  </Button>
                  <p className="text-[11px] text-muted-foreground">
                    {canAddCv ? "PDF · 10 Mo max" : "Limite de 3 CVs atteinte"}
                  </p>
                </div>
              </div>
              )}

            </div>
          </ScrollArea>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
            <Button type="button" onClick={save} disabled={!draft.name.trim() || !draft.role.trim()}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
}

// ── PersonnelEditor ───────────────────────────────────────────────────────────

export function PersonnelEditor({ value, onChange, pastProjects, techOptions, allowUploads = true }: { value: Personnel[]; onChange: (v: Personnel[]) => void; pastProjects: PastProject[]; techOptions: string[]; allowUploads?: boolean }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [initial, setInitial] = useState<Personnel>(EMPTY_PERSONNEL);

  const openAdd = () => { setInitial(EMPTY_PERSONNEL); setEditIdx(null); setOpen(true); };
  const openEdit = (i: number) => { setInitial(clonePersonnel(value[i])); setEditIdx(i); setOpen(true); };
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const handleSave = (p: Personnel) => {
    if (editIdx !== null) { const next = [...value]; next[editIdx] = p; onChange(next); }
    else onChange([...value, p]);
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <SectionTitle>Personnel clé</SectionTitle>
        <Button type="button" size="sm" variant="outline" onClick={openAdd} className="h-7 text-xs gap-1">
          <Plus className="h-3.5 w-3.5" /> Ajouter
        </Button>
      </div>

      {value.length === 0
        ? <p className="text-xs text-muted-foreground">Aucun membre du personnel renseigné.</p>
        : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {value.map((p, i) => (
              <PersonnelCard
                key={i}
                p={p}
                onEdit={() => openEdit(i)}
                onRemove={() => remove(i)}
                onView={() => navigate(`/settings/personnel/${encodeURIComponent(p.name)}`, { state: { person: p, past_projects: pastProjects } })}
              />
            ))}
          </div>
        )
      }

      <PersonnelFormDialog open={open} onOpenChange={setOpen} initial={initial} onSave={handleSave} isEdit={editIdx !== null} techOptions={techOptions} allowUploads={allowUploads} />
    </div>
  );
}
