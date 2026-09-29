/**
 * Champs de saisie réutilisables (tags, sélection sur référentiel, textarea)
 * et métadonnées d'affichage des niveaux de compétence.
 */
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Plus, X,
  Code2, Cloud, Brain, ShieldCheck, Network, ClipboardList, Layers,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function TagInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState("");
  const add = () => {
    const v = input.trim();
    if (v && !value.some((t) => t.toLowerCase() === v.toLowerCase())) onChange([...value, v]);
    setInput("");
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
          }}
          placeholder={placeholder ?? "Ajouter…"}
          className="flex-1"
        />
        <Button type="button" variant="outline" size="sm" onClick={add}><Plus className="h-4 w-4" /></Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {value.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-xs font-medium">
            {tag}
            <button type="button" onClick={() => onChange(value.filter((t) => t !== tag))} className="hover:text-destructive">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Sélecteur basé sur le référentiel : les valeurs sont choisies dans `options`
 * (casse canonique du référentiel imposée), ce qui élimine les déphasages de
 * casse entre projets, compétences et profils. `allowFree` autorise en plus
 * une saisie libre (ex. compétences non techniques d'un manager).
 */
export function CatalogSelect({
  value, onChange, options, placeholder, allowFree = false,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  options: string[];
  placeholder?: string;
  allowFree?: boolean;
}) {
  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);
  const selectedLower = new Set(value.map((v) => v.toLowerCase()));
  const q = input.trim().toLowerCase();
  const suggestions = options.filter(
    (o) => !selectedLower.has(o.toLowerCase()) && (!q || o.toLowerCase().includes(q)),
  );

  const addTerm = (term: string) => {
    const t = term.trim();
    if (!t) return;
    // Si le terme existe dans le référentiel, on impose SA casse
    const canonical = options.find((o) => o.toLowerCase() === t.toLowerCase());
    const final = canonical ?? (allowFree ? t : null);
    if (!final) return;
    if (!selectedLower.has(final.toLowerCase())) onChange([...value, final]);
    setInput("");
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTerm(input); }
          }}
          placeholder={placeholder ?? "Rechercher dans le référentiel…"}
        />
        {focused && suggestions.length > 0 && (
          <div className="absolute z-30 mt-1 w-full rounded-md border bg-popover shadow-md max-h-44 overflow-y-auto">
            {suggestions.slice(0, 12).map((o) => (
              <button
                key={o}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); addTerm(o); }}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted/60"
              >
                {o}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {value.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-xs font-medium">
            {tag}
            <button type="button" onClick={() => onChange(value.filter((t) => t !== tag))} className="hover:text-destructive">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {allowFree
          ? "Sélectionnez dans le référentiel (saisie libre possible pour les termes hors référentiel)."
          : "Sélection limitée au référentiel — gérez la liste dans la rubrique « Référentiel technologies & domaines »."}
      </p>
    </div>
  );
}

export function Textarea({
  value, onChange, placeholder, rows = 3,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm resize-y placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    />
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">{children}</h3>
  );
}

export function ViewRow({ label, value }: { label: string; value?: string | number | null }) {
  if (!value && value !== 0) return null;
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{String(value)}</dd>
    </div>
  );
}

export function Tags({ items, color = "bg-primary/10 text-primary" }: { items: string[]; color?: string }) {
  if (!items?.length) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((t) => (
        <span key={t} className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}>{t}</span>
      ))}
    </div>
  );
}

export function Field({ label, children, col2 = false }: { label: string; children: React.ReactNode; col2?: boolean }) {
  return (
    <div className={`space-y-1.5${col2 ? " md:col-span-2" : ""}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export const LEVEL_META: Record<string, { label: string; weight: number; bar: string; chip: string }> = {
  expert:        { label: "Expert",        weight: 100, bar: "bg-emerald-500",          chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  senior:        { label: "Senior",        weight: 75,  bar: "bg-blue-500",             chip: "bg-blue-500/15 text-blue-700 dark:text-blue-400" },
  intermediaire: { label: "Intermédiaire", weight: 50,  bar: "bg-amber-500",            chip: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  debutant:      { label: "Débutant",      weight: 25,  bar: "bg-muted-foreground/50",  chip: "bg-muted text-muted-foreground" },
};

// Icône déduite de l'intitulé du domaine
export function domainIcon(domain: string): React.ReactNode {
  const d = domain.toLowerCase();
  const cls = "h-4 w-4";
  if (/(dév|dev|logiciel|software|application)/.test(d)) return <Code2 className={cls} />;
  if (/(cloud|devops|infrastructure)/.test(d)) return <Cloud className={cls} />;
  if (/(data|intelligence|analytics|big)/.test(d)) return <Brain className={cls} />;
  if (/(cyber|sécu|securit)/.test(d)) return <ShieldCheck className={cls} />;
  if (/(réseau|reseau|télécom|telecom)/.test(d)) return <Network className={cls} />;
  if (/(projet|amoa|gestion|management)/.test(d)) return <ClipboardList className={cls} />;
  return <Layers className={cls} />;
}

export const LEVEL_ORDER = ["expert", "senior", "intermediaire", "debutant"];
