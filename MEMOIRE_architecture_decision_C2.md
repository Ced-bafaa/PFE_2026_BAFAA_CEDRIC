# Architecture de décision — cadrage « système expert assumé » (C2)

*Section destinée au mémoire. Elle justifie honnêtement la nature du moteur de
décision de KIAMA et anticipe la question que le jury posera sur le rôle du
machine learning.*

---

## 1. Le constat qui impose ce cadrage

Le moteur de scoring repose sur quatre variables financières dérivées du DAO
(`ratio_ca`, `ratio_credit`, `poids_caution`, `score_tech`). Le modèle XGBoost
est, dans l'implémentation actuelle, **entraîné à reproduire une règle métier
déterministe** : son étiquette d'apprentissage est produite par `compute_label`,
un simple seuil sur ces mêmes variables (CA suffisant ET crédit suffisant ET
caution soutenable). Il n'existe pas de vérité-terrain indépendante — pas de
corpus de verdicts GO/NO-GO rendus par des experts humains.

Présenter ce dispositif comme un **apprentissage supervisé** serait
scientifiquement incorrect : un modèle entraîné à imiter un `if` codé à la main,
sur les variables d'entrée de ce même `if`, n'apprend aucune connaissance que la
règle ne contenait déjà. Plutôt que de masquer cette réalité, KIAMA l'**assume**
et adopte un cadrage de **système expert**, où la décision est portée par des
règles explicites et traçables, et où le machine learning joue un rôle
**auxiliaire** clairement délimité.

## 2. La décision appartient aux règles, pas au modèle

La décision d'éligibilité — la seule qui soit éliminatoire — est rendue par
`evaluate_eligibility` (module `core_logic`), qui reproduit le raisonnement d'une
commission d'évaluation de marché public :

- les critères financiers explicitement exigés par le DAO (chiffre d'affaires
  minimum, ligne de crédit minimum, caution) sont comparés aux capacités de
  l'entreprise ;
- les exigences de personnel sont évaluées en **ET strict** par rôle, les
  alternatives de certification (« PMP ou Prince2 ») formant un **OU** interne ;
- seules les exigences **réellement extraites** du DAO sont opposables ; les
  valeurs estimées (budget × taux) ne disqualifient jamais.

Ces règles sont **déterministes, auditables et testées unitairement** (27 tests
sur le moteur de décision, 11 sur l'extraction du personnel clé). C'est là que
réside la valeur défendable du système : une décision qu'on peut **expliquer
ligne à ligne** devant un soumissionnaire, ce qu'un modèle boîte-noire ne permet
pas dans un contexte de marché public.

## 3. Le rôle réel du machine learning : un score de confiance, pas un verdict

Le XGBoost et l'analyse qualitative Groq ne **décident** pas ; ils **graduent et
priorisent**. Leur sortie est un *score de confiance* qui aide l'utilisateur à
ordonner les opportunités éligibles, pas à les filtrer. Concrètement, la fusion
(`_fuse_scores`) combine :

- le **score financier** (confiance XGBoost) — un lissage continu de la règle de
  seuil, utile pour distinguer « confortablement au-dessus du seuil » de « tout
  juste au-dessus » ;
- le **score qualitatif** (Groq) — une analyse en langage naturel des forces et
  points bloquants du dossier ;
- les **règles de conformité** (`evaluate_eligibility`) — qui, elles, peuvent
  **forcer** un NO-GO si un critère éliminatoire explicite n'est pas satisfait.

La hiérarchie est donc claire et honnête : **les règles tranchent, le ML
nuance.** Le verdict final n'est jamais le fruit d'un apprentissage opaque.

## 4. Pourquoi ce cadrage est le bon choix pour KIAMA

- **Honnêteté scientifique.** On ne revendique pas une capacité d'apprentissage
  que les données ne permettent pas. C'est la posture qu'un jury valorise.
- **Explicabilité réglementaire.** En marché public, une décision doit pouvoir
  être justifiée. Un système de règles le permet nativement ; un classifieur
  appris, beaucoup moins.
- **Robustesse au manque de données.** KIAMA n'a pas — et ne pouvait pas avoir au
  stade du PFE — un historique annoté de milliers de décisions. Le système expert
  fonctionne dès le premier DAO, sans phase d'apprentissage préalable.
- **Trajectoire d'évolution ouverte.** Le jour où un historique de verdicts
  humains existera, l'étage ML pourra être ré-entraîné sur ces **labels
  indépendants** et prendre progressivement plus de poids. Le cadrage actuel ne
  ferme aucune porte ; il décrit honnêtement l'état présent.

## 5. Le préalable technique indissociable (lien avec C1)

Le cadrage « système expert » ne suffit pas à lui seul à corriger le symptôme du
**score figé à 96,12 %** observé en production. Même un score de confiance ne
devrait pas être identique pour toutes les opportunités. La cause est que
l'extraction financière échoue trop souvent (la caution, le chiffre d'affaires
minimum et la ligne de crédit présents dans le texte ne sont pas captés), si bien
que les quatre variables retombent sur leur valeur par défaut et que les règles
n'ont rien pour discriminer.

Le chantier **C1 — fiabilisation de l'extraction financière** est donc le
complément indispensable : ce sont des règles transparentes *alimentées par des
données fiables* qui rendent le système crédible. Le cadrage (C2) explique
*comment on présente* le moteur ; l'extraction (C1) garantit qu'il *produit des
sorties variées et justes*.

## 6. Réponse-type à la question du jury

> « Votre XGBoost n'apprend-il pas simplement votre règle ? »

« Exactement, et c'est assumé. KIAMA est un système expert : la décision
éliminatoire vient de règles métier traçables, calquées sur le travail d'une
commission d'évaluation. Le modèle statistique ne rend pas le verdict ; il fournit
un score de confiance qui lisse la règle et aide à prioriser les dossiers
éligibles. Nous n'avions pas d'historique de décisions humaines pour un
apprentissage supervisé honnête ; plutôt que de simuler une capacité que les
données ne permettent pas, nous avons fait le choix de l'explicabilité — décisif
en marché public — tout en laissant la porte ouverte à un ré-entraînement sur
labels réels lorsqu'un tel historique existera. »

---

### Ajustements de code associés (mineurs, à faire au prochain build)

Pour aligner le code sur ce discours, sans changer le comportement :

- Renommer dans l'interface et les libellés exposés « prédiction » / « verdict du
  modèle » en **« score de confiance »** / **« recommandation »**, pour ne pas
  laisser croire à une décision apprise.
- Ajouter un commentaire d'en-tête dans `train_pipeline.py` documentant
  explicitement que le label est une règle métier et que le modèle est un étage
  de confiance (et non un classifieur sur vérité-terrain).
- Optionnel : exposer au front la liste `triggered_rules` déjà produite par
  `_fuse_scores`, pour matérialiser visuellement que ce sont les règles qui
  tranchent.

Ces retouches sont cosmétiques et n'altèrent ni le scoring ni les tests ; elles
seront livrées avec le lot backend une fois l'environnement de compilation
rétabli.
