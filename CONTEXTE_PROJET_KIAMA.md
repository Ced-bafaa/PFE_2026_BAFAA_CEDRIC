# KIAMA — Document de contexte du projet

> **But de ce document.** Permettre à toute personne — ou à tout assistant IA, quel
> que soit le compte — de reprendre le travail sur KIAMA sans tout ré-expliquer.
> Il synthétise l'état du projet, les décisions d'architecture, et **les points
> importants pour la rédaction du mémoire de fin d'études**. Dernière mise à jour :
> 24 juin 2026.

---

## 1. Qu'est-ce que KIAMA

KIAMA est le **projet de fin d'études d'ingénieur de Ced**, à défendre devant un
jury (mémoire). C'est une **plateforme de veille et d'aide à la décision sur les
appels d'offres (AO) publics camerounais**, dont la source est le portail de
l'**ARMP** (Agence de Régulation des Marchés Publics, `armp.cm`). L'entreprise
cible est une **ESN/SSII** spécialisée en systèmes d'information, développement
logiciel, IA et transformation numérique.

La plateforme : **collecte** les avis de marché, **filtre** ceux qui concernent
l'IT, **score** leur intérêt pour l'entreprise (GO / À ÉTUDIER / NO-GO), et
**recommande** le personnel le mieux adapté à chaque marché.

Tout le projet vit dans le dossier `C:\KIAMA\Divers`.

---

## 2. Architecture technique

Cinq briques, orchestrées par **Docker Compose** (`docker-compose.yml`) :

| Service | Techno | Port | Rôle |
|---|---|---|---|
| **frontend** | React 18 + Vite + TS + shadcn/ui | 8096 (→80 nginx) | Interface ; nginx relaie `/api` vers le backend |
| **backend** | NestJS (Node) | 3004 | Orchestrateur : scraping, collecte, stockage, API du front |
| **decision-engine** | Python / FastAPI | 8765 | Cerveau décisionnel : filtre sémantique + scoring MCDA + Groq |
| **ao-extractor** | Python / FastAPI | 8770 | Extraction du contenu des PDF (DAO) |
| **mysql** | MySQL 8 | interne | Base `v_tech` (non exposée sur l'hôte) |

Séparation des responsabilités : le **backend = bras logistique** (collecter,
orchestrer, stocker) ; le **decision-engine = intelligence** (modèle d'embeddings
+ jugement de pertinence + scoring). Le frontend n'appelle jamais une IP figée :
il appelle `/api/…` (même origine), et le nginx du conteneur frontend relaie vers
le backend via le réseau interne Docker (pas de CORS, marche quelle que soit l'IP).

**Modèle d'embeddings** : `paraphrase-multilingual-mpnet-base-v2`
(sentence-transformers), chargé une fois au démarrage du decision-engine,
téléchargé au 1ᵉʳ boot (~1 Go, mis en cache).

**Couche LLM** : Groq (`openai/gpt-oss-120b`) pour la couche qualitative et le chat.

---

## 3. Le pipeline de bout en bout (l'« entonnoir »)

```
Portail ARMP → Scraper → Orchestrateur → /relevance (filtre) → MySQL
            → Extraction PDF → Éligibilité → Scoring MCDA → Reco personnel → Front
```

1. **Scraping** (`backend/src/armp/armp-specific.scraper.ts`) : pour chaque source,
   parcourt les pages (`&page=N`), extrait titre/type/date de clôture/budget/
   financement. Exclut d'emblée les **communiqués/attributions** (COMM/DEC) et les
   **AO déjà clôturés**.
2. **Agrégation** (`scraper-orchestrator`, `collect.service`) : rassemble les 5
   sources sans purge par host (sinon elles s'effacent entre elles).
3. **Filtre de pertinence** : appel à `/relevance` du decision-engine, par paquets
   de 40 objets (sinon timeout). Voir §4.
4. **Extraction PDF** (ao-extractor) : seulement pour les vrais DAO (AO/AOI) ; les
   AMI/DP/cotation sont scorés sur métadonnées (skipPdf) pour éviter les timeouts.
5. **Éligibilité** (`core_logic.evaluate_eligibility`) : critères éliminatoires
   (CA min, crédit, caution, personnel) — règles déterministes.
6. **Scoring MCDA** (`mcda_scorer.score_mcda`) : voir §5.
7. **Reco personnel** : voir §6.
8. Le backend stocke et le front affiche.

---

## 4. Le filtre de pertinence IT — **hybride** (POINT MÉMOIRE)

**Problème.** Distinguer les AO informatiques des autres (routes, santé, agricole…).

**Décision d'architecture, justifiée par l'expérience chiffrée** (excellent
matériau de mémoire — une décision défendue par les données réelles) :

- Le **sémantique seul échoue** sur les titres ARMP bruts : sur 196 AO réels, tous
  les scores s'écrasent près de 0, car le **pavé administratif** (« AVIS D'APPEL
  D'OFFRES NATIONAL OUVERT N°… POUR … FINANCEMENT… ») domine l'embedding et noie le
  sujet. (Sur texte propre — golden set de 19 AO — le sémantique seul atteignait
  pourtant F1=0,95.)
- Les **mots-clés seuls** ratent les paraphrases.
- → **Solution = pipeline HYBRIDE à trois passes**, sur l'**objet nettoyé** (pas le
  titre brut) :
  - **P1 — whitelist IT** (mots-clés explicites, ex. « système d'information »,
    « développement logiciel », « plateforme numérique ») → retenu, gratuit, sûr.
  - **P2 — blacklist domaines** (noms non-IT explicites : route, bâtiment,
    semences…) → rejeté. **Aucun verbe ambigu** (« travaux », « construction ») dans
    les listes : s'ils survivent, c'est la passe 3 qui tranche.
  - **P3 — sémantique** (embeddings mpnet, cosinus objet ↔ pôle IT, seuil eps=0,05)
    pour les cas ambigus / paraphrases.

**Prétraitement clé** (`clean_title`) : extrait l'**objet réel** derrière les
marqueurs (« POUR », « OBJET : », « Désignation de la Mission »…), dé-colle les
mots soudés par l'OCR (« 2026POUR »), coupe le boilerplate. Et **`_na` normalise
les apostrophes** (’ → ') — sans ça, « système d'information » n'était jamais
reconnu (bug réel coûteux, corrigé).

**Résultat sur 196 AO réels : 10 gardés / 186 écartés** (8 par mot-clé, 151 par
blacklist, 35 ambigus → sémantique qui en garde 2), **aucun vrai AO IT raté**.

**Exemples concrets à citer (defendre les choix) :**
- « acquisition du matériel **informatique** … ministère de l'**Habitat** » →
  sémantique seul = −0,13 (FAUX non-IT à cause de « bureautique/habitat ») ; le
  mot-clé « informatique » le rattrape. *(Le mot-clé sauve le sémantique sur texte verbeux.)*
- « **digitalisation** de la radio Nkul Ongola » → aucun mot-clé exact, mais le
  sémantique le rattrape (+0,066 IT). *(Le rôle du sémantique : les paraphrases.)*
- Additif « TRAVAUX … EN PAVÉ DE LA ROUTE » d'abord retenu À TORT (le mot-clé
  « plateforme COLEPS » du boilerplate se déclenchait) → corrigé en classant
  l'objet propre → blacklist « route » → rejeté. *(Justifie clean_title sur toutes les passes.)*
- « énergie **solaire** numérique » : « numérique » seul retiré de la whitelist →
  plus de faux positif. *(Justifie une whitelist curée, pas exhaustive.)*

Fichier : `decision_engine/src/semantic_filter.py`. Banc d'essai (notebook) :
`decision_engine/notebooks/phase_a_semantic_filter.ipynb`. Document mathématique
déjà rédigé : `KIAMA_Fondements_filtre_semantique.docx` (+ .pdf).

---

## 5. Le scoring MCDA / AHP — **cœur du mémoire** (POINT MÉMOIRE)

**Pourquoi abandonner le XGBoost (argument de jury).** L'ancien modèle XGBoost
était **circulaire** : son label d'entraînement était la règle déterministe
`compute_label` calculée sur les **mêmes** 4 features. Il ré-apprenait un `if/else`
connu → n'apportait rien, et **sortait 96 / GO pour tous les AO** (saturé). De plus
il n'existe **aucune vérité terrain** (les résultats d'attribution ARMP ne sont pas
collectés). Un modèle supervisé était donc invalide. → Remplacé par un **système
transparent et défendable**.

**Architecture du scoring (hybride, sans ML appris) :**
1. **Barrière d'éligibilité** déterministe (go/no-go) — règles, jamais apprises.
2. **MCDA** (analyse multicritère) avec poids **AHP** (méthode de Saaty).
3. **Adéquation technique par embeddings** (pas du comptage de mots-clés).
4. **LLM (Groq) recadré** comme couche qualitative, pas comme 40 % du score.

**Les 5 critères**, chacun ramené sur [0,1] par une fonction de valeur explicite :

| Critère | Poids AHP | Comment |
|---|---|---|
| C1 Adéquation technique | **0,462** | cosinus(objet ↔ profil entreprise) via embeddings mpnet |
| C2 Capacité financière | 0,292 | ratio CA / budget (confortable si ≥ 3) |
| C3 Valeur du marché | 0,070 | bonus de taille — **ne pénalise jamais** (voir garde-fou) |
| C4 Faisabilité délai | 0,107 | jours avant clôture (≥ 30 = idéal) |
| C5 Fiabilité financement | 0,069 | BIP / bailleur identifié |

**Agrégation** : `S = 100 · Σ wᵢ·vᵢ`. **Seuils** : GO ≥ 70 ; À ÉTUDIER ≥ 50 ;
sinon NO-GO. La barrière d'éligibilité prime : non éligible → NO-GO quel que soit S.

**AHP chiffré et vérifié** (à mettre dans le mémoire) : matrice de Saaty,
λmax = 5,068, **ratio de cohérence CR = 0,015** (< 0,10 → cohérent). Poids
d'origine : 41,7 / 26,3 / 16,0 / 9,7 / 6,2 %.

**Garde-fou « valeur du marché »** (décision de Ced) : un petit marché ne doit
**jamais** être handicapé. → poids baissé (16 %→7 %) ET fonction à plancher haut :
`v3 = 0,85 + 0,15·min(budget, 300M)/300M`. Résultat : entre 1 M et 500 M FCFA,
~1 point d'écart seulement. La capacité à financer un gros marché reste gérée par C2.

**Discrimination validée en live** (vs « 96 plat ») : dev/SI 89,7 ; infra 80,4 ;
alimentaire 61 ; route 48.

Fichiers : `decision_engine/src/mcda_scorer.py`. Document de conception :
`KIAMA_Conception_refonte_scoring.docx` (+ .pdf).

**Note (24/06/2026) — vestige XGBoost retiré du service.** `api_service.py` ne
charge plus le `.pkl` ni SHAP : le DAO est parsé par `DAOProcessor` (règles, sans
modèle), le MCDA décide. Le schéma de réponse est **inchangé** (champs hérités
remplis par le MCDA) → aucune modif backend/front. Le CLI d'entraînement
(`inference_pipeline.py`) garde XGBoost pour l'historique hors-ligne ;
`decision_model.pkl` n'est plus lu (supprimable).

---

## 6. Éligibilité, couche Groq, recommandation de personnel

- **Éligibilité** (`core_logic.evaluate_eligibility`) : critères éliminatoires du
  DAO (CA min, crédit, caution, personnel exigé). Affichée au front (carte
  « Conformité aux exigences du DAO »).
- **Groq** : analyse qualitative (points forts / risques / blocages). Bornée
  (timeout 10 s, non bloquante) pour ne pas figer `/predict`.
- **Recommandation de personnel** (`SemanticRelevanceFilter.recommend_experts`) :
  cosinus(objet de l'AO ↔ profil de chaque expert), repli sur recouvrement de
  compétences si le modèle est absent. **Roster de 7 experts** reconstruit (était
  perdu) : Serge KIAMA (dir. tech), Christelle MBARGA (AMOA), Alvine NDJOMO
  (Cloud/DevOps), Diane FOUDA (full-stack/mobile), Boris ESSAMA (Data/BI),
  Rodrigue ATANGANA (cyber/infra), Patrick NDONGO (déploiement matériel). Affiché
  sur la fiche AO (composant `McdaSection`).

---

## 7. Couverture des sources ARMP

**5 sources** configurées (`backend/data/sources-settings.json`), filtrées par le
paramètre `val` (catégorie de procédure, statique) ≠ `page` (pagination) :
AON (`val=1`), International (`val=4`), Cotation (`val=5`), **AMI (`val=12`)**,
**DP (`val=7`)**. Les AMI et DP ont été ajoutés tardivement car c'est là que vivent
les **prestations intellectuelles** (dév logiciel, audit SI, AMOA) — le cœur de
cible. Les mots-clés globaux ont été **vidés** : le filtre hybride est seul juge.

Décision produit : prendre **tous** les AO IT quelle que soit la famille, **un seul
scoring unifié**, le reste à l'appréciation humaine (pas de classificateur de
familles).

---

## 8. État actuel (24 juin 2026)

- **Déployé en Docker** sur un VPS (Ubuntu, 8 Go RAM) et lançable en local
  (`docker compose build && up -d`, frontend sur `localhost:8096`).
- **Filtre hybride + scoring MCDA + reco personnel** : implémentés et branchés
  bout en bout (decision-engine → backend → front).
- **Tests** : `decision_engine/tests/` — 66 tests (filtre + MCDA) verts, plus
  d'anciens tests `core_logic` (27) et `ao_extractor` (19/11).
- **Catalogue vide au démarrage** : la base Docker démarre vierge → lancer une
  collecte pour la peupler.
- **Déploiement VPS** : bloqué par un **pare-feu en amont** (hébergeur/admin) qui
  filtre le port du frontend → un administrateur doit ouvrir le port. Le nginx du
  frontend résout le backend « à la volée » (resolver Docker 127.0.0.11) pour ne
  pas crasher au démarrage. Détails : `DEPLOIEMENT_VPS.md`.

---

## 9. Limites assumées & perspectives (POINT MÉMOIRE — honnêteté défendable)

Ced valorise les explications **honnêtes** : assumer ce qui est règle vs appris,
montrer les métriques, exposer les limites. À présenter comme limites/perspectives :

- **Authentification cosmétique** : le login pose juste un objet en `localStorage` ;
  le backend n'a qu'une clé API partagée. **La sécurité et le multi-utilisateur avec
  rôles SONT un objectif** → vraie implémentation (comptes, mot de passe haché,
  JWT/session, RBAC) à faire **dès que Ced fournit la matrice des rôles** (qui
  accède à quoi). Ne pas commencer avant d'avoir ces spécifications.
- **État applicatif en `localStorage`** (favoris, notifications, corbeille, suivi de
  soumission, journal d'audit) = source de vérité côté client → à migrer côté
  serveur (un journal d'audit doit être inviolable).
- **Anomalies front** (ménage reporté) : fichiers morts (`LoginPage.tsx`,
  `Index.tsx`), deux systèmes de toasts montés en double, `react-query` branché à
  vide, ~26 composants UI shadcn jamais utilisés, badges de score fragmentés,
  `mock-data.ts` mal nommé (c'est le module de types central).
- **Pas de vérité terrain** → pas de ML supervisé pour l'instant ; un modèle de
  probabilité de gain est repoussé à quand de vraies issues gagné/perdu existeront.
- **Seuils** (filtre eps=0,05 ; MCDA 70/50) posés à dire d'expert → un petit jeu
  étiqueté permettrait de les calibrer chiffres à l'appui.

---

## 10. Points clés à défendre au jury (synthèse)

1. **Le filtre hybride** : une décision d'archi (mots-clés ∪ sémantique) **justifiée
   par des données réelles** (196 AO), pas par principe — montrer les faux positifs
   corrigés.
2. **Le scoring MCDA/AHP** : transparent, traçable, **avec cohérence vérifiée
   (CR=0,015)** ; contraste avec le XGBoost circulaire/saturé qu'il remplace.
3. **L'adéquation technique par embeddings** : comprend le *sens* (résout les pièges
   « réseau d'eau » vs « réseau informatique »).
4. **Les tests** comme preuve de non-régression (les cas réels deviennent des tests).
5. **L'honnêteté** sur les limites (auth, vérité terrain) = maturité d'ingénieur.

---

## 11. Préférences de Ced (rédaction & travail)

- Français **académique**, soutenance jury, projet « le mieux structuré possible ».
- Valorise les explications **honnêtes et défendables** + les **schémas**.
- Pose des **questions de compréhension fine** (maths, fonctionnement) : bien définir
  chaque symbole, rester simple et concret.
- Préfère des réponses **concises et directes**.
- Fournira une **charte de rédaction** pour le mémoire → adapter le style à la charte
  quand elle arrivera.

---

## 12. Pièges techniques à connaître (pour reprendre le code)

- **Corruption du montage Windows en bac à sable** : lire/éditer les fichiers du
  projet **via les outils Read/Write/Edit** (accès Windows direct), **jamais via
  bash sur le montage** pour les fichiers que le backend écrit aussi (ex.
  `company_profile.json`) — le montage montre une vue fantôme avec octets nuls, et
  les écritures bash n'atteignent pas le vrai fichier. Pour tester du code Python,
  recopier dans `/tmp` et exécuter là.
- **Builds** : backend `npx tsc -p tsconfig.json --noEmit` (PAS `tsconfig.app.json`,
  ça c'est le front). Tests Python : `python -m pytest -q`.
- **Ne jamais** `docker compose down -v` (le `-v` efface la base et le cache modèle).

---

## 13. Documents déjà produits (réutilisables pour le mémoire)

- `KIAMA_Fondements_filtre_semantique.docx` / `.pdf` — fondements mathématiques du
  filtre (embeddings, cosinus, centroïdes, métriques).
- `KIAMA_Conception_refonte_scoring.docx` / `.pdf` — conception du scoring MCDA/AHP.
- `KIAMA_Pipeline_Scraping_Filtre_Semantique.docx` — la chaîne collecte → filtre.
- `DEPLOIEMENT_VPS.md` — guide de déploiement Docker.
- `DIAGNOSTIC_2026-06-15.md`, `PLAN_CORRECTIONS_2026-06-15.md`,
  `MEMOIRE_architecture_decision_C2.md` — diagnostics et décisions d'architecture.
