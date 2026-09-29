# SSO KIAMA — Connexion Microsoft (Entra ID)

Guide d'activation du **Single Sign-On** avec **Microsoft Entra ID (Azure AD)**.
Le domaine **@kiama.cm** est hébergé sur **Microsoft 365** (vérifié : MX
`kiama-cm.mail.protection.outlook.com`, SPF `spf.protection.outlook.com`), donc
l'IdP est Entra ID et le protocole est **OpenID Connect (OIDC)**.

> État actuel : l'application fonctionne avec **connexion par e-mail + mot de
> passe** (compte admin local = accès de secours). Le SSO se **branche par-dessus**
> sans rien casser : il remplace seulement l'étape de connexion. Le RBAC, les
> rôles et les gardes restent identiques.

---

## 1. Modèle retenu — Liste blanche (pré-provisionnement)

- L'**admin déclare à l'avance** qui a le droit d'entrer : il enregistre
  **e-mail (@kiama.cm) + rôle** (compte « coquille », sans mot de passe).
- À la 1ʳᵉ connexion Microsoft, l'app **rapproche l'e-mail** du compte
  pré-enregistré **actif** → accès accordé avec le rôle défini.
- Un @kiama.cm **non enregistré** est **refusé** (« compte non autorisé »).
- **Profil auto-rempli** depuis Entra (prénom, nom) à la 1ʳᵉ connexion ; le
  **poste** reste saisi par l'admin (Entra ne le fournit pas de façon fiable).
- Le **compte admin local** (mot de passe) reste actif comme **break-glass**.

---

## 2. À faire côté KIAMA — Inscription de l'application Entra

Dans **portal.azure.com → Microsoft Entra ID → Inscriptions d'applications →
Nouvelle inscription** :

1. **Nom** : `KIAMA — Veille stratégique`.
2. **Comptes pris en charge** : *Comptes de cet annuaire organisationnel
   uniquement* (mono-locataire).
3. **URI de redirection** :
   - Type **SPA** (recommandé, flux navigateur PKCE) → `https://<domaine-app>/auth/callback`
     (et `http://localhost:8096/auth/callback` pour les tests locaux).
4. Après création, noter :
   - **ID d'application (client)** → `client_id`
   - **ID de l'annuaire (locataire)** → `tenant_id`
5. **Autorisations d'API** → Microsoft Graph → *Autorisations déléguées* :
   `openid`, `profile`, `email`, `User.Read`. Puis **Accorder le consentement
   administrateur**.
6. (Flux serveur uniquement) **Certificats & secrets** → nouveau **secret
   client** → `client_secret`. *Non requis si l'on utilise le flux SPA/PKCE.*

---

## 3. Variables d'environnement (à renseigner à l'activation)

À ajouter dans `.env` (des valeurs vides = SSO désactivé, l'app reste en
mot de passe) :

```
# SSO Microsoft Entra ID — laisser vide tant que non configuré
SSO_ENABLED=false
ENTRA_TENANT_ID=            # ID de l'annuaire (locataire)
ENTRA_CLIENT_ID=            # ID d'application (client)
ENTRA_CLIENT_SECRET=        # uniquement pour le flux serveur (auth code)
SSO_ALLOWED_DOMAIN=kiama.cm # domaine imposé
# Émetteur/OIDC (dérivés du tenant, pour info) :
# issuer   = https://login.microsoftonline.com/<TENANT_ID>/v2.0
# jwks_uri = https://login.microsoftonline.com/<TENANT_ID>/discovery/v2.0/keys
```

---

## 4. Architecture technique (ce qui sera codé à l'activation)

**Frontend**
- Bouton **« Se connecter avec Microsoft »** via **MSAL** (`@azure/msal-browser`).
- L'utilisateur s'authentifie sur `login.microsoftonline.com` (MFA hérité).
- On récupère un **ID token** (JWT signé Microsoft) → envoyé au backend.

**Backend — `POST /auth/sso`**
1. Vérifie le jeton : **signature** (JWKS Microsoft), **émetteur** (le locataire
   KIAMA), **audience** (`client_id`), **domaine** (`SSO_ALLOWED_DOMAIN`).
2. Lit les claims : `preferred_username`/`email`, `name`, `given_name`,
   `family_name`, `oid` (identifiant stable dans le locataire).
3. **Liste blanche** : cherche un utilisateur **actif** avec cet e-mail.
   - Trouvé → complète le profil (prénom/nom) si vide, puis **émet le jeton
     applicatif KIAMA** (même RBAC qu'aujourd'hui).
   - Absent → **403 « compte non autorisé »**.
4. Journalise `login` (auth) avec l'acteur et son rôle (audit existant).

**Points de code impactés (préparés) :**
- `backend/src/auth/` : nouveau `sso.controller.ts` + `sso.service.ts`
  (vérification OIDC), réutilise `AuthService` pour émettre le JWT.
- `frontend/src/pages/Login.tsx` : bouton MSAL (affiché si `SSO_ENABLED`).
- `frontend/src/lib/auth.ts` : `loginWithMicrosoft()`.

---

## 5. Changement du format de création (à l'activation)

Quand le SSO est actif, la création de compte se **simplifie** :

| Aujourd'hui (mot de passe) | Avec SSO (liste blanche) |
|---|---|
| Prénom, Nom, Poste, e-mail, mot de passe, rôle | **E-mail (@kiama.cm) + Rôle** (+ Poste optionnel) |
| Mot de passe généré/communiqué | **Aucun mot de passe** — Microsoft gère |
| Prénom/Nom saisis | **Auto-remplis** à la 1ʳᵉ connexion depuis Entra |

Le compte **admin local** conserve un mot de passe (secours).

---

## 6. Checklist d'activation

1. [ ] Inscription de l'app dans Entra (client_id, tenant_id, redirect URI).
2. [ ] Autorisations Graph (openid, profile, email, User.Read) + consentement admin.
3. [ ] Renseigner `.env` (`SSO_ENABLED=true`, `ENTRA_*`).
4. [ ] Me redonner le feu vert : je code le bouton MSAL + `/auth/sso` + la
       simplification du formulaire.
5. [ ] Tester avec un compte @kiama.cm pré-enregistré (liste blanche).
6. [ ] Garder le compte admin local comme accès de secours.
