import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { changePassword, getAuthUser, mustChangePassword } from "@/lib/auth";
import { Lock, Eye, EyeOff, Loader2, ArrowRight, ShieldCheck, Check, X } from "lucide-react";

function Rule({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className={`flex items-center gap-1.5 ${ok ? "text-emerald-600 dark:text-emerald-500" : "text-muted-foreground"}`}>
      {ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
      {label}
    </li>
  );
}

export default function ChangePassword() {
  const navigate = useNavigate();
  const me = getAuthUser();
  const forced = mustChangePassword();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const rules = useMemo(
    () => ({
      len: next.length >= 10,
      lower: /[a-z]/.test(next),
      upper: /[A-Z]/.test(next),
      digit: /[0-9]/.test(next),
      diff: next.length > 0 && next !== current,
      match: confirm.length > 0 && next === confirm,
    }),
    [next, confirm, current],
  );
  const canSubmit =
    current.length > 0 && rules.len && rules.lower && rules.upper && rules.digit && rules.diff && rules.match && !submitting;

  const onSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await changePassword(current, next);
      toast.success("Mot de passe mis à jour.");
      navigate("/", { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Échec du changement de mot de passe.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <span className="text-base font-bold tracking-tight">Sécurité du compte</span>
        </div>

        <h1 className="text-2xl font-semibold tracking-tight">
          {forced ? "Définissez votre mot de passe" : "Changer de mot de passe"}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {forced
            ? "Pour votre première connexion, remplacez le mot de passe temporaire par un mot de passe personnel."
            : "Choisissez un nouveau mot de passe pour votre compte."}
          {me?.email && <span className="mt-1 block text-xs">Compte : {me.email}</span>}
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
          <div className="space-y-1.5">
            <label htmlFor="cur" className="text-sm font-medium">
              {forced ? "Mot de passe temporaire" : "Mot de passe actuel"}
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="cur" type={show ? "text" : "password"} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" className="pl-9" />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="new" className="text-sm font-medium">Nouveau mot de passe</label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="new" type={show ? "text" : "password"} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" className="pl-9 pr-10" />
              <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:text-foreground" aria-label={show ? "Masquer" : "Afficher"} tabIndex={-1}>
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="conf" className="text-sm font-medium">Confirmer le nouveau mot de passe</label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="conf" type={show ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" className="pl-9" />
            </div>
          </div>

          <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <Rule ok={rules.len} label="10 caractères min." />
            <Rule ok={rules.upper} label="Une majuscule" />
            <Rule ok={rules.lower} label="Une minuscule" />
            <Rule ok={rules.digit} label="Un chiffre" />
            <Rule ok={rules.diff} label="Différent de l'ancien" />
            <Rule ok={rules.match} label="Confirmation identique" />
          </ul>

          <Button type="submit" className="w-full gap-2" disabled={!canSubmit}>
            {submitting ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Enregistrement…</>
            ) : (
              <>Valider le nouveau mot de passe <ArrowRight className="h-4 w-4" /></>
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
