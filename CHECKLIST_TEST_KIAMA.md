# KIAMA — Liste des fonctionnalités & checklist de test

> Pour le testeur. Coche `[x]` quand c'est OK, note un commentaire sinon.
> Accès à l'application : `http://IP_DU_SERVEUR:8096` (demander l'adresse exacte).

## Avant de commencer — à savoir
- **Au tout début, le catalogue est vide** : c'est normal. Il faut d'abord lancer
  une collecte (voir module « Opportunités ») pour récupérer les appels d'offres.
- **La première collecte + le scoring prennent du temps** (5–10 min) : le système
  va chercher les avis sur le portail ARMP, télécharge des PDF et les analyse.
- Certains boutons de la page de connexion sont des **maquettes non branchées**
  (signalés plus bas) — ne pas les compter comme des bugs.

---

## 1. Connexion
- [ ] La page de connexion s'affiche au premier accès.
- [ ] Se connecter avec un email → on arrive sur le tableau de bord.
- [ ] Une fois connecté, l'accès aux autres pages est possible.
- [ ] Se déconnecter ramène à la page de connexion.
- ⚠️ **Maquettes non fonctionnelles** (normal, à ignorer) : « OAuth Google »,
  « mot de passe oublié », « création de compte ».

## 2. Tableau de bord
- [ ] Affiche des indicateurs de synthèse (nombre d'opportunités, etc.).
- [ ] Affiche les opportunités récentes.
- [ ] Les chiffres sont cohérents avec le contenu de la page Opportunités.

## 3. Opportunités (écran principal)
- [ ] La liste des appels d'offres s'affiche (après une collecte).
- [ ] **Lancer une collecte** : bouton « Vérifier les nouveautés » → un message
      indique que la vérification est en cours ; la liste se met à jour seule.
- [ ] **Recherche** par mots-clés (titre, domaine).
- [ ] **Filtres** : par score (Tous / élevé / moyen), par type, par état, par
      plage de dates.
- [ ] **Filtre « Nouveaux aujourd'hui »** : n'affiche que les AO du jour.
- [ ] **Tri** de la liste (par score, date…).
- [ ] **Pagination** : navigation entre les pages de résultats.
- [ ] **Sélection multiple** d'opportunités (cases à cocher).
- [ ] **Export CSV** (toute la liste ou la sélection).
- [ ] **Export PDF** (toute la liste ou la sélection).
- [ ] **Marquer comme lu** : un AO ouvert/marqué change d'apparence.
- [ ] **Ajouter aux favoris** (étoile) → l'AO apparaît dans Favoris.
- [ ] **Soumettre / envoyer au suivi** une ou plusieurs opportunités.
- [ ] Cliquer sur une opportunité ouvre sa **fiche détaillée**.

## 4. Fiche détaillée d'une opportunité
- [ ] **Score décisionnel (MCDA)** affiché sur 100 + verdict (GO / À ÉTUDIER /
      NO-GO) + recommandation.
- [ ] **Détail des 5 critères** avec leur barre et leur poids (adéquation
      technique, capacité financière, valeur du marché, délai, financement).
- [ ] **Conformité aux exigences du DAO** : critères éliminatoires (capacité
      financière, personnel exigé) avec leur statut.
- [ ] **Analyse qualitative (IA / Groq)** : résumé, points forts, points
      bloquants, vérifications.
- [ ] **Personnel recommandé** : liste des experts les plus adaptés au marché,
      avec leur taux d'adéquation.
- [ ] **Détails extraits** du dossier (budget, caution, dates, références…).
- [ ] **Joindre un justificatif** (PDF) à l'opportunité.
- [ ] **Convertir en référence** (pour une opportunité gagnée) : pré-remplit un
      projet de référence.
- [ ] Bouton retour : revient à la liste à la bonne page.

## 5. Favoris
- [ ] Les opportunités mises en favori apparaissent ici.
- [ ] Retirer un favori le fait disparaître de la liste.

## 6. Analytiques
- [ ] **Répartition des opportunités par domaine** (graphique).
- [ ] **Compétences par domaine** (graphique).
- [ ] Les graphiques reflètent les données réelles du catalogue.

## 7. Assistant IA (Chat)
- [ ] La page « Assistant KIAMA » (Groq · Llama 3.1) s'ouvre.
- [ ] Poser une question → l'assistant répond.
- [ ] Les réponses tiennent compte du contexte (entreprise / opportunités).

## 8. Notifications
- [ ] La page liste les notifications.
- [ ] Sélectionner puis **supprimer** des notifications.

## 9. Suivi des soumissions
- [ ] Les opportunités soumises apparaissent avec leur **statut** (cycle de vie :
      soumis → en évaluation → attribué / non retenu…).
- [ ] Changer le statut d'une soumission.
- [ ] **Joindre un justificatif** à une soumission.
- [ ] Pour une soumission **attribuée** : bouton « Ajouter aux références »
      (trophée) → crée un projet de référence pré-rempli.

## 10. Corbeille
- [ ] Les éléments supprimés y arrivent.
- [ ] **Restaurer** un élément.
- [ ] **Vider la corbeille** (suppression définitive).
- [ ] « La corbeille est vide » s'affiche quand elle est vide.

## 11. Paramètres → Sources
- [ ] Liste des **sources de collecte** (ARMP : AON, international, cotation,
      AMI, DP).
- [ ] Activer / désactiver une source.
- [ ] Modifier la cadence de collecte ; enregistrer.

## 12. Paramètres → Profil entreprise
- [ ] Éditer les **informations** (nom, forme juridique, pays/ville, CA,
      trésorerie, ligne de crédit…) ; « Profil mis à jour » à l'enregistrement.
- [ ] **Conformité & capacité** : conformité fiscale/sociale, assurances,
      qualifications réglementaires.
- [ ] **Certifications** : ajouter / supprimer.
- [ ] **Compétences par domaine** + technologies (référentiel).
- [ ] **Coopération & partenariats**.

## 13. Paramètres → Personnel
- [ ] Liste du personnel clé.
- [ ] **Ajouter / éditer** un membre (rôle, expérience, compétences,
      certifications, diplômes, disponibilité…).
- [ ] **Téléverser un CV** (PDF) et le **télécharger**.
- [ ] **Téléverser le scan d'un diplôme** (PDF/JPG/PNG) et le télécharger.
- [ ] Ouvrir la **fiche détaillée** d'un membre (projets liés, etc.).
- [ ] Rattacher un membre à des **projets de référence**.

## 14. Paramètres → Projets de référence
- [ ] Liste des projets (client, année, budget, domaines, technologies).
- [ ] Ouvrir la **fiche d'un projet** : experts contributeurs cliquables.
- [ ] Ajouter / éditer un projet.

## 15. Paramètres → Partenaires
- [ ] Liste des partenaires.
- [ ] Ajouter / éditer / supprimer un partenaire.

## 16. Paramètres → Notifications
- [ ] Configurer les **canaux** et la fréquence (quotidien / hebdomadaire).
- [ ] Enregistrer les préférences.

## 17. Paramètres → Sécurité & journal
- [ ] **Journal d'audit** (Utilisateur / Action / Cible / Horodatage) listant les
      actions effectuées.
- [ ] Régler la **rétention des logs** (jours).
- [ ] Changer le mot de passe (selon ce qui est branché).

---

## Points à signaler au testeur (comportements attendus, pas des bugs)
- Catalogue **vide au démarrage** → lancer une collecte d'abord.
- **Premier scoring lent** (téléchargement + analyse des PDF) ; certains AO
  apparaissent « score en attente » le temps d'être traités.
- L'application est en **HTTP** (pas de cadenas HTTPS) : normal en réseau interne.
- Pas de gestion fine des comptes/rôles pour cette phase de test (connexion
  simplifiée).
- Maquettes non branchées sur la page de connexion (voir §1).

## Comment remonter un problème
Pour chaque anomalie, noter : la **page**, l'**action faite**, ce qui était
**attendu**, ce qui s'est **passé**, et si possible une **capture d'écran** +
l'heure (utile pour retrouver la trace dans les logs).
