import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { login } from "@/lib/auth";
import {
  Zap, Mail, Lock, Eye, EyeOff, Loader2, ArrowRight,
  ShieldCheck, AlertCircle, Search, ClipboardCheck, Sparkles,
} from "lucide-react";

const REMEMBER_KEY = "kiama_remembered_email";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function safeNextPath(next: string | null): string {
  if (!next) return "/";
  try {
    const decoded = decodeURIComponent(next);
    if (decoded.startsWith("/") && !decoded.startsWith("//")) return decoded;
  } catch {
    /* ignore malformed next */
  }
  return "/";
}

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const emailRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [touched, setTouched] = useState<{ email: boolean; password: boolean }>({ email: false, password: false });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Pré-remplit l'email mémorisé et place le focus au bon endroit.
  useEffect(() => {
    let remembered = "";
    try {
      remembered = localStorage.getItem(REMEMBER_KEY) ?? "";
    } catch {
      /* ignore */
    }
    if (remembered) {
      setEmail(remembered);
      setRemember(true);
      // Focus sur le mot de passe si l'email est déjà connu.
      requestAnimationFrame(() => document.getElementById("password")?.focus());
    } else {
      requestAnimationFrame(() => emailRef.current?.focus());
    }
  }, []);

  const emailValid = EMAIL_RE.test(email.trim());
  const canSubmit = emailValid && password.length > 0 && !isSubmitting;

  const emailError = touched.email && email.trim().length > 0 && !emailValid
    ? "Adresse email invalide."
    : null;

  const year = useMemo(() => new Date().getFullYear(), []);

  const onSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setTouched({ email: true, password: true });
    setError(null);
    if (!emailValid) {
      emailRef.current?.focus();
      return;
    }
    if (password.length === 0) {
      document.getElementById("password")?.focus();
      return;
    }
    setIsSubmitting(true);
    try {
      const user = await login(email.trim(), password);
      try {
        if (remember) localStorage.setItem(REMEMBER_KEY, email.trim());
        else localStorage.removeItem(REMEMBER_KEY);
      } catch {
        /* ignore */
      }
      // Première connexion (ou après réinitialisation) : changement imposé.
      if (user.mustChangePassword) {
        navigate("/change-password", { replace: true });
        return;
      }
      toast.success("Connexion réussie");
      const next = new URLSearchParams(location.search).get("next");
      navigate(safeNextPath(next), { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Identifiants incorrects ou service indisponible.";
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const onPasswordKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsLock(e.getModifierState?.("CapsLock") ?? false);
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* ── Panneau branding (gauche) ── */}
      <div className="relative hidden overflow-hidden bg-[hsl(222_47%_11%)] lg:flex lg:flex-col lg:justify-between lg:p-12">
        {/* Décor */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(1000px_circle_at_20%_15%,hsl(var(--primary)/0.35),transparent_55%),radial-gradient(800px_circle_at_85%_80%,hsl(214_92%_50%/0.20),transparent_50%)]" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.15] [background-image:radial-gradient(rgba(255,255,255,0.14)_1px,transparent_1px)] [background-size:24px_24px]" />

        <div className="relative flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary shadow-lg shadow-primary/30">
            <Zap className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <p className="text-base font-bold tracking-tight text-white">KIAMA SA</p>
            <p className="text-[11px] uppercase tracking-[0.2em] text-white/50">Veille Stratégique</p>
          </div>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-white">
            La bonne opportunité,<br />au bon moment.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-white/60">
            Détection, qualification et suivi des appels d'offres publics — un moteur de décision
            multicritère au service de vos soumissions.
          </p>

          <ul className="mt-8 space-y-3">
            {[
              { icon: Search, text: "Veille automatisée des marchés publics (ARMP)" },
              { icon: Sparkles, text: "Scoring multicritère et recommandations de groupement" },
              { icon: ClipboardCheck, text: "Suivi des soumissions de bout en bout" },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-white/80">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/10 ring-1 ring-white/15">
                  <Icon className="h-4 w-4 text-white" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative flex items-center gap-2 text-xs text-white/45">
          <ShieldCheck className="h-4 w-4" />
          Accès réservé — comptes fournis par votre administrateur.
        </div>
      </div>

      {/* ── Panneau formulaire (droite) ── */}
      <div className="flex items-center justify-center bg-background px-5 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          {/* Logo compact (mobile) */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary">
              <Zap className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-base font-bold tracking-tight">KIAMA SA</span>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight">Connexion</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Accédez à votre espace de veille et de suivi.
          </p>

          {/* Message d'erreur (accessible) */}
          {error && (
            <div
              role="alert"
              aria-live="assertive"
              className="mt-5 flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
            {/* Email */}
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-medium">Email</label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  ref={emailRef}
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); if (error) setError(null); }}
                  onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                  placeholder="prenom.nom@kiama.cm"
                  aria-invalid={Boolean(emailError)}
                  aria-describedby={emailError ? "email-error" : undefined}
                  className="pl-9"
                />
              </div>
              {emailError && (
                <p id="email-error" className="text-xs text-destructive">{emailError}</p>
              )}
            </div>

            {/* Mot de passe */}
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium">Mot de passe</label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); if (error) setError(null); }}
                  onKeyUp={onPasswordKey}
                  onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                  placeholder="••••••••"
                  className="pl-9 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {capsLock && (
                <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-500">
                  <AlertCircle className="h-3.5 w-3.5" /> Verrouillage majuscules activé.
                </p>
              )}
            </div>

            {/* Se souvenir de moi */}
            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground select-none">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              Se souvenir de mon adresse
            </label>

            {/* Soumettre */}
            <Button type="submit" className="w-full gap-2" disabled={!canSubmit}>
              {isSubmitting ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Connexion…</>
              ) : (
                <>Se connecter <ArrowRight className="h-4 w-4" /></>
              )}
            </Button>
          </form>

          <p className="mt-6 text-xs text-muted-foreground">
            Mot de passe oublié ? Contactez votre administrateur pour une réinitialisation.
          </p>

          <p className="mt-8 text-[11px] text-muted-foreground/60">© {year} KIAMA SA — Tous droits réservés.</p>
        </div>
      </div>
    </div>
  );
}
