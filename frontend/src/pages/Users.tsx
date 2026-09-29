import { useEffect, useState } from "react";
import { UserPlus, KeyRound, Pencil, Power, Copy, Check, ShieldCheck, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { getAuthUser, type Role } from "@/lib/auth";
import {
  fetchUsers,
  createUser,
  updateUser,
  resetUserPassword,
  type AdminUser,
} from "@/lib/users-api";

const EMAIL_DOMAIN = "@kiama.cm";

const ROLE_LABELS: Record<Role, string> = {
  user: "Utilisateur",
  admin_exploitation: "Admin exploitation",
  admin_systeme: "Admin système",
};

const ROLE_BADGE: Record<Role, string> = {
  user: "bg-slate-500/10 text-slate-600 border-slate-500/30",
  admin_exploitation: "bg-blue-500/10 text-blue-600 border-blue-500/30",
  admin_systeme: "bg-violet-500/10 text-violet-600 border-violet-500/30",
};

const ROLE_OPTIONS: Role[] = ["user", "admin_exploitation", "admin_systeme"];

/** Slug pour l'identifiant e-mail : minuscules, sans accents ni caractères spéciaux. */
function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

type CreateForm = { firstName: string; lastName: string; position: string; role: Role };
type EditForm = { firstName: string; lastName: string; position: string; role: Role };

export default function Users({ embedded = false }: { embedded?: boolean } = {}) {
  const me = getAuthUser();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>({
    firstName: "",
    lastName: "",
    position: "",
    role: "user",
  });
  const [emailLocal, setEmailLocal] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [creating, setCreating] = useState(false);

  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ firstName: "", lastName: "", position: "", role: "user" });
  const [savingEdit, setSavingEdit] = useState(false);

  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setUsers(await fetchUsers());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Chargement des comptes impossible.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // Auto-suggestion de l'identifiant e-mail à partir de prénom.nom (tant que
  // l'admin n'a pas saisi manuellement).
  useEffect(() => {
    if (emailTouched) return;
    const f = slug(createForm.firstName);
    const l = slug(createForm.lastName);
    setEmailLocal(f && l ? `${f}.${l}` : f || l);
  }, [createForm.firstName, createForm.lastName, emailTouched]);

  const resetCreate = () => {
    setCreateForm({ firstName: "", lastName: "", position: "", role: "user" });
    setEmailLocal("");
    setEmailTouched(false);
  };

  const handleCreate = async () => {
    setCreating(true);
    try {
      const { user, password } = await createUser({
        firstName: createForm.firstName.trim(),
        lastName: createForm.lastName.trim(),
        position: createForm.position.trim(),
        email: emailLocal.trim(),
        role: createForm.role,
      });
      setCreateOpen(false);
      resetCreate();
      setCredentials({ email: user.email, password });
      toast.success("Compte créé.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Création impossible.");
    } finally {
      setCreating(false);
    }
  };

  const openEdit = (u: AdminUser) => {
    setEditTarget(u);
    setEditForm({
      firstName: u.firstName ?? "",
      lastName: u.lastName ?? "",
      position: u.position ?? "",
      role: u.role,
    });
  };

  const handleEditSave = async () => {
    if (!editTarget) return;
    setSavingEdit(true);
    try {
      await updateUser(editTarget.id, {
        firstName: editForm.firstName.trim(),
        lastName: editForm.lastName.trim(),
        position: editForm.position.trim(),
        role: editForm.role,
      });
      setEditTarget(null);
      toast.success("Compte mis à jour.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Mise à jour impossible.");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleToggleActive = async (u: AdminUser) => {
    setBusyId(u.id);
    try {
      await updateUser(u.id, { active: !u.active });
      toast.success(u.active ? "Compte désactivé." : "Compte réactivé.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action impossible.");
    } finally {
      setBusyId(null);
    }
  };

  const handleReset = async (u: AdminUser) => {
    setBusyId(u.id);
    try {
      const { password } = await resetUserPassword(u.id);
      setCredentials({ email: u.email, password });
      toast.success("Mot de passe réinitialisé.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Réinitialisation impossible.");
    } finally {
      setBusyId(null);
    }
  };

  const copyPassword = async () => {
    if (!credentials) return;
    try {
      await navigator.clipboard.writeText(credentials.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copie impossible — sélectionnez le mot de passe manuellement.");
    }
  };

  const emailError = emailLocal.includes("@")
    ? "N'incluez pas de domaine ici — seule l'extension @kiama.cm est autorisée."
    : "";

  const createHeader = (
    <Button onClick={() => setCreateOpen(true)}>
      <UserPlus className="h-4 w-4 mr-1.5" />
      Créer un utilisateur
    </Button>
  );

  return (
    <div className="space-y-6">
      {embedded ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">Créez et gérez les comptes d'accès et leurs rôles.</p>
          {createHeader}
        </div>
      ) : (
        <PageHeader
          icon={ShieldCheck}
          title="Utilisateurs"
          description="Créez et gérez les comptes d'accès et leurs rôles."
          actions={createHeader}
        />
      )}

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="grid grid-cols-[1.6fr_1.6fr_1fr_0.7fr_auto] gap-3 px-4 py-2.5 border-b bg-muted/30 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Nom / Poste</span>
          <span>E-mail</span>
          <span>Rôle</span>
          <span>Statut</span>
          <span className="text-right">Actions</span>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 mx-auto mb-2 animate-spin" />
            Chargement…
          </div>
        ) : users.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Aucun compte.</div>
        ) : (
          users.map((u) => {
            const isSelf = me?.id != null && u.id === me.id;
            const displayName = u.name || [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email;
            return (
              <div
                key={u.id}
                className="grid grid-cols-[1.6fr_1.6fr_1fr_0.7fr_auto] gap-3 px-4 py-3 border-b last:border-0 items-center text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">
                    {displayName}
                    {isSelf && <span className="ml-1.5 text-[10px] text-muted-foreground">(vous)</span>}
                  </p>
                  {u.position && <p className="text-xs text-muted-foreground truncate">{u.position}</p>}
                </div>
                <span className="text-muted-foreground truncate">{u.email}</span>
                <span>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full border ${ROLE_BADGE[u.role]}`}>
                    {ROLE_LABELS[u.role]}
                  </span>
                </span>
                <span>
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded-full border ${
                      u.active
                        ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
                        : "bg-rose-500/10 text-rose-600 border-rose-500/30"
                    }`}
                  >
                    {u.active ? "Actif" : "Inactif"}
                  </span>
                </span>
                <div className="flex items-center justify-end gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" title="Modifier" onClick={() => openEdit(u)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title="Réinitialiser le mot de passe"
                    disabled={busyId === u.id}
                    onClick={() => void handleReset(u)}
                  >
                    <KeyRound className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-8 w-8 ${u.active ? "text-rose-600" : "text-emerald-600"}`}
                    title={isSelf ? "Vous ne pouvez pas désactiver votre propre compte" : u.active ? "Désactiver" : "Réactiver"}
                    disabled={busyId === u.id || isSelf}
                    onClick={() => void handleToggleActive(u)}
                  >
                    <Power className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Dialog : création */}
      <Dialog open={createOpen} onOpenChange={(o) => !creating && setCreateOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Créer un utilisateur</DialogTitle>
            <DialogDescription>
              Un mot de passe fort sera généré et affiché une seule fois après création.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Prénom</label>
                <Input
                  value={createForm.firstName}
                  onChange={(e) => setCreateForm((f) => ({ ...f, firstName: e.target.value }))}
                  placeholder="Cédric"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Nom</label>
                <Input
                  value={createForm.lastName}
                  onChange={(e) => setCreateForm((f) => ({ ...f, lastName: e.target.value }))}
                  placeholder="Bafa'a"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Poste</label>
              <Input
                value={createForm.position}
                onChange={(e) => setCreateForm((f) => ({ ...f, position: e.target.value }))}
                placeholder="Chargé de veille"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Adresse e-mail</label>
              <div className="flex items-stretch">
                <Input
                  value={emailLocal}
                  onChange={(e) => {
                    setEmailTouched(true);
                    setEmailLocal(e.target.value);
                  }}
                  placeholder="prenom.nom"
                  className={`rounded-r-none ${emailError ? "border-destructive focus-visible:ring-destructive" : ""}`}
                />
                <span className="inline-flex items-center rounded-r-md border border-l-0 bg-muted px-3 text-sm text-muted-foreground whitespace-nowrap">
                  {EMAIL_DOMAIN}
                </span>
              </div>
              {emailError ? (
                <p className="text-[11px] text-destructive">{emailError}</p>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Seule l'extension <span className="font-medium">@kiama.cm</span> est autorisée.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Rôle</label>
              <select
                value={createForm.role}
                onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value as Role }))}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Annuler
            </Button>
            <Button
              onClick={() => void handleCreate()}
              disabled={
                creating ||
                !createForm.firstName.trim() ||
                !createForm.lastName.trim() ||
                !emailLocal.trim() ||
                Boolean(emailError)
              }
            >
              {creating && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Créer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog : édition */}
      <Dialog open={Boolean(editTarget)} onOpenChange={(o) => !savingEdit && !o && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifier le compte</DialogTitle>
            <DialogDescription>{editTarget?.email}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Prénom</label>
                <Input
                  value={editForm.firstName}
                  onChange={(e) => setEditForm((f) => ({ ...f, firstName: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Nom</label>
                <Input
                  value={editForm.lastName}
                  onChange={(e) => setEditForm((f) => ({ ...f, lastName: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Poste</label>
              <Input
                value={editForm.position}
                onChange={(e) => setEditForm((f) => ({ ...f, position: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Rôle</label>
              <select
                value={editForm.role}
                onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value as Role }))}
                disabled={me?.id != null && editTarget?.id === me.id}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm disabled:opacity-60"
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
              {me?.id != null && editTarget?.id === me.id && (
                <p className="text-[11px] text-muted-foreground">Vous ne pouvez pas modifier votre propre rôle.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)} disabled={savingEdit}>
              Annuler
            </Button>
            <Button
              onClick={() => void handleEditSave()}
              disabled={savingEdit || !editForm.firstName.trim() || !editForm.lastName.trim()}
            >
              {savingEdit && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog : identifiants générés (affichés une seule fois) */}
      <Dialog open={Boolean(credentials)} onOpenChange={(o) => !o && setCredentials(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mot de passe généré</DialogTitle>
            <DialogDescription>
              Communiquez-le à l'utilisateur : il ne sera <strong>plus affiché</strong> ensuite.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/20 p-3 text-sm">
              <p className="text-xs text-muted-foreground">Compte</p>
              <p className="font-medium">{credentials?.email}</p>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md border bg-background px-3 py-2 font-mono text-sm break-all">
                {credentials?.password}
              </code>
              <Button variant="outline" size="icon" onClick={() => void copyPassword()} title="Copier">
                {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setCredentials(null)}>J'ai noté le mot de passe</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
