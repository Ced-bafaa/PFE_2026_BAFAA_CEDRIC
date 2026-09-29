/**
 * Éditeurs des rubriques : certifications, compétences par domaine,
 * projets de référence (avec rattachement des experts).
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Pencil, Trash2 } from "lucide-react";
import type { Certification, Competency, PastProject, Personnel, ProjectStatus } from "./types";
import { LEVEL_LABELS, LEVEL_COLORS, PROJECT_STATUS_META, projectStatusOf } from "./types";
import { CatalogSelect, SectionTitle, TagInput, Textarea, domainIcon } from "./fields";
import { accentConfig, avatarInitials } from "./personnel";
import { toast } from "sonner";

// ─── Sub-editors ──────────────────────────────────────────────────────────────

export function CertificationsEditor({ value, onChange }: { value: Certification[]; onChange: (v: Certification[]) => void }) {
  const empty: Certification = { name: "", issuer: "", year: "", valid_until: "", scope: "" };
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Certification>(empty);
  const [editIdx, setEditIdx] = useState<number | null>(null);

  const openAdd = () => { setDraft(empty); setEditIdx(null); setOpen(true); };
  const openEdit = (i: number) => { setDraft({ ...value[i] }); setEditIdx(i); setOpen(true); };
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const save = () => {
    if (!draft.name.trim()) return;
    if (editIdx !== null) { const next = [...value]; next[editIdx] = draft; onChange(next); }
    else onChange([...value, draft]);
    setOpen(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <SectionTitle>Certifications</SectionTitle>
        <Button type="button" size="sm" variant="outline" onClick={openAdd} className="h-7 text-xs gap-1"><Plus className="h-3.5 w-3.5" /> Ajouter</Button>
      </div>
      {value.length === 0
        ? <p className="text-xs text-muted-foreground">Aucune certification renseignée.</p>
        : <div className="rounded-md border divide-y text-sm">
            {value.map((c, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2 gap-2">
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{c.name}</span>
                  {c.issuer && <span className="text-muted-foreground ml-2 text-xs">{c.issuer}</span>}
                  {c.year && <span className="text-muted-foreground ml-2 text-xs">{c.year}{c.valid_until ? ` → ${c.valid_until}` : ""}</span>}
                  {c.scope && <span className="ml-2 text-xs text-primary/70">{c.scope}</span>}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(i)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => remove(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            ))}
          </div>
      }
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editIdx !== null ? "Modifier" : "Ajouter"} une certification</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Nom *</Label><Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="ISO 9001, PMP…" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Organisme émetteur</Label><Input value={draft.issuer ?? ""} onChange={(e) => setDraft((d) => ({ ...d, issuer: e.target.value }))} placeholder="Bureau Veritas…" /></div>
              <div className="space-y-1.5"><Label>Périmètre</Label><Input value={draft.scope ?? ""} onChange={(e) => setDraft((d) => ({ ...d, scope: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Année d'obtention</Label><Input value={draft.year ?? ""} onChange={(e) => setDraft((d) => ({ ...d, year: e.target.value }))} placeholder="2023" /></div>
              <div className="space-y-1.5"><Label>Valide jusqu'à</Label><Input value={draft.valid_until ?? ""} onChange={(e) => setDraft((d) => ({ ...d, valid_until: e.target.value }))} placeholder="2026" /></div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            <Button type="button" onClick={save}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function CompetenciesEditor({ value, onChange, techOptions }: { value: Competency[]; onChange: (v: Competency[]) => void; techOptions: string[] }) {
  const empty: Competency = { domain: "", keywords: [], level: "intermediaire" };
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Competency>(empty);
  const [editIdx, setEditIdx] = useState<number | null>(null);

  const openAdd = () => { setDraft(empty); setEditIdx(null); setOpen(true); };
  const openEdit = (i: number) => { setDraft({ ...value[i], keywords: [...(value[i].keywords ?? [])] }); setEditIdx(i); setOpen(true); };
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const save = () => {
    if (!draft.domain.trim()) return;
    if (editIdx !== null) { const next = [...value]; next[editIdx] = draft; onChange(next); }
    else onChange([...value, draft]);
    setOpen(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <SectionTitle>Compétences par domaine</SectionTitle>
        <Button type="button" size="sm" variant="outline" onClick={openAdd} className="h-7 text-xs gap-1"><Plus className="h-3.5 w-3.5" /> Ajouter</Button>
      </div>
      {value.length === 0
        ? <p className="text-xs text-muted-foreground">Aucun domaine de compétence renseigné.</p>
        : <div className="space-y-2">
            {value.map((c, i) => (
              <div key={i} className="rounded-xl border bg-muted/20 overflow-hidden">
                <div className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    <div className="h-7 w-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      {domainIcon(c.domain)}
                    </div>
                    <span className="font-semibold text-sm truncate">{c.domain}</span>
                    {c.level && (
                      <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium shrink-0 ${LEVEL_COLORS[c.level] ?? "bg-muted text-muted-foreground"}`}>
                        {LEVEL_LABELS[c.level] ?? c.level}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(i)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => remove(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
                {(c.keywords ?? []).length > 0 && (
                  <div className="px-4 py-2 border-t bg-background/40 flex flex-wrap gap-1">
                    {(c.keywords ?? []).map((kw) => (
                      <span key={kw} className="rounded-md bg-primary/10 text-primary px-2 py-0.5 text-xs font-medium">{kw}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
      }
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editIdx !== null ? "Modifier" : "Ajouter"} un domaine de compétence</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2 md:col-span-1"><Label>Domaine *</Label><Input value={draft.domain} onChange={(e) => setDraft((d) => ({ ...d, domain: e.target.value }))} placeholder="Développement logiciel…" /></div>
              <div className="space-y-1.5"><Label>Niveau</Label>
                <select value={draft.level ?? "intermediaire"} onChange={(e) => setDraft((d) => ({ ...d, level: e.target.value }))} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  {Object.entries(LEVEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-1.5"><Label>Mots-clés / technologies</Label><CatalogSelect value={draft.keywords} onChange={(kw) => setDraft((d) => ({ ...d, keywords: kw }))} options={techOptions} allowFree placeholder="Java, Spring Boot…" /></div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            <Button type="button" onClick={save}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function PastProjectsEditor({
  value,
  onChange,
  personnel,
  techOptions,
  domainOptions,
}: {
  value: PastProject[];
  onChange: (v: PastProject[]) => void;
  personnel: Personnel[];
  techOptions: string[];
  domainOptions: string[];
}) {
  const empty: PastProject = { title: "", client: "", year: "", domains: [], technologies: [], description: "", personnel_names: [], status: "acheve" };
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<PastProject>(empty);
  const [editIdx, setEditIdx] = useState<number | null>(null);

  const openAdd = () => { setDraft(empty); setEditIdx(null); setOpen(true); };
  const openEdit = (i: number) => {
    setDraft({
      ...value[i],
      domains: [...(value[i].domains ?? [])],
      technologies: [...(value[i].technologies ?? [])],
      personnel_names: [...(value[i].personnel_names ?? [])],
    });
    setEditIdx(i);
    setOpen(true);
  };
  // Avertit (sans bloquer) si une modification laisse un expert « occupé » sans
  // aucun projet EN COURS — cohérence avec la règle appliquée sur la fiche personnel.
  const warnStranded = (next: PastProject[]) => {
    const stranded = personnel
      .filter((p) => (p.availability ?? "").toLowerCase().includes("occup"))
      .filter(
        (p) =>
          !next.some(
            (pr) => projectStatusOf(pr) === "en_cours" && (pr.personnel_names ?? []).includes(p.name),
          ),
      )
      .map((p) => p.name);
    if (stranded.length > 0) {
      toast.warning(
        `${stranded.join(", ")} : marqué « occupé » sans projet en cours. Ajustez sa disponibilité ou ses rattachements.`,
      );
    }
  };

  const remove = (i: number) => {
    const next = value.filter((_, idx) => idx !== i);
    onChange(next);
    warnStranded(next);
  };
  const save = () => {
    if (!draft.title.trim()) return;
    const next = editIdx !== null ? value.map((p, i) => (i === editIdx ? draft : p)) : [...value, draft];
    onChange(next);
    warnStranded(next);
    setOpen(false);
  };

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

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <SectionTitle>Projets de référence</SectionTitle>
        <Button type="button" size="sm" variant="outline" onClick={openAdd} className="h-7 text-xs gap-1">
          <Plus className="h-3.5 w-3.5" /> Ajouter
        </Button>
      </div>

      {value.length === 0
        ? <p className="text-xs text-muted-foreground">Aucun projet renseigné.</p>
        : (
          <div className="space-y-2">
            {value.map((p, i) => {
              const linked = (p.personnel_names ?? []).filter(Boolean);
              return (
                <div key={i} className="rounded-xl border bg-muted/20 overflow-hidden">
                  <div className="flex items-start gap-3 px-4 py-2.5">
                    {p.year && (
                      <div className="rounded-lg bg-primary/10 px-2.5 py-1.5 text-center shrink-0 min-w-[3.5rem]">
                        <div className="text-xs font-bold text-primary leading-none">{p.year}</div>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm leading-snug">{p.title}</span>
                        {(() => {
                          const meta = PROJECT_STATUS_META[projectStatusOf(p)];
                          return (
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0 ${meta.badge}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                              {meta.label}
                            </span>
                          );
                        })()}
                      </div>
                      {p.client && (
                        <div className="text-xs text-muted-foreground mt-0.5">{p.client}</div>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(i)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => remove(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>

                  {/* Footer: technologies + experts */}
                  {((p.technologies ?? []).length > 0 || linked.length > 0) && (
                    <div className="px-4 py-2 border-t bg-background/40 flex flex-wrap items-center gap-1.5">
                      {(p.technologies ?? []).map((t) => (
                        <span key={t} className="rounded-md bg-primary/10 text-primary px-2 py-0.5 text-xs">{t}</span>
                      ))}
                      {linked.length > 0 && (p.technologies ?? []).length > 0 && (
                        <span className="w-px h-3 bg-border mx-0.5 shrink-0" />
                      )}
                      {linked.map((name) => {
                        const acc = accentConfig(name);
                        const ini = avatarInitials(name);
                        return (
                          <span
                            key={name}
                            title={name}
                            className={`h-5 w-5 rounded-md flex items-center justify-center text-[9px] font-bold ring-1 ${acc.ring} ${acc.bg} ${acc.text}`}
                          >
                            {ini}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      }

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editIdx !== null ? "Modifier" : "Ajouter"} un projet</DialogTitle>
            <DialogDescription>Les technologies et domaines alimentent directement le scoring de compétences.</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[65vh]">
            <div className="space-y-4 pr-3">

              <div className="space-y-1.5">
                <Label>Intitulé du projet *</Label>
                <Input value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} placeholder="Plateforme de gestion…" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Client / Maître d'ouvrage</Label>
                  <Input value={draft.client ?? ""} onChange={(e) => setDraft((d) => ({ ...d, client: e.target.value }))} placeholder="MINFI, MTN…" />
                </div>
                <div className="space-y-1.5">
                  <Label>Année</Label>
                  <Input value={draft.year ?? ""} onChange={(e) => setDraft((d) => ({ ...d, year: e.target.value }))} placeholder="2023" />
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label>Avancement</Label>
                  <select
                    value={projectStatusOf(draft)}
                    onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value as ProjectStatus }))}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="acheve">Achevé</option>
                    <option value="en_cours">En cours</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Domaines</Label>
                <CatalogSelect value={draft.domains ?? []} onChange={(v) => setDraft((d) => ({ ...d, domains: v }))} options={domainOptions} placeholder="Développement logiciel…" />
              </div>

              <div className="space-y-1.5">
                <Label>Technologies utilisées</Label>
                <CatalogSelect value={draft.technologies ?? []} onChange={(v) => setDraft((d) => ({ ...d, technologies: v }))} options={techOptions} placeholder="Java, PostgreSQL…" />
              </div>

              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea value={draft.description ?? ""} onChange={(v) => setDraft((d) => ({ ...d, description: v }))} placeholder="Contexte et réalisations principales…" rows={3} />
              </div>

              {/* Experts rattachés */}
              {personnel.length > 0 && (
                <div className="space-y-2">
                  <Label>Experts impliqués</Label>
                  <p className="text-[11px] text-muted-foreground">Sélectionne les membres du personnel clé qui ont contribué à ce projet.</p>
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
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            <Button type="button" onClick={save} disabled={!draft.title.trim()}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
