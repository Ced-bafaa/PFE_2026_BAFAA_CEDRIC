# Déploiement de KIAMA sur un VPS (tests d'entreprise)

Guide pour héberger KIAMA sur un VPS Linux avec Docker, accessible par les
testeurs via **IP:port sur le réseau de l'entreprise**.

Architecture lancée : MySQL + 4 services (backend NestJS, decision-engine
Python, ao-extractor, frontend nginx), orchestrés par `docker-compose.yml`.

---

## 1. Prérequis sur le VPS

- Linux (Ubuntu 22.04+ recommandé), accès `sudo`.
- **Docker** + **plugin Docker Compose** :
  ```bash
  sudo apt update && sudo apt install -y docker.io docker-compose-plugin
  sudo usermod -aG docker $USER     # puis se reconnecter
  ```
- **Accès internet au premier démarrage** : le decision-engine télécharge le
  modèle d'embeddings (~1 Go). C'est fait **une seule fois** (mis en cache dans
  le volume `model_cache`).
- **RAM** : prévoir au moins 4 Go (le modèle d'embeddings + MySQL + Node).
- Ouvrir le **port 8096** (et éventuellement 3004) sur le pare-feu interne pour
  que les postes du réseau puissent accéder.

## 2. Récupérer le projet et configurer les secrets

```bash
# Copier le projet sur le VPS (git clone, scp, rsync… selon votre setup)
cd KIAMA            # dossier contenant docker-compose.yml

cp .env.example .env
nano .env           # renseigner les vraies valeurs
```

À renseigner impérativement dans `.env` :

| Variable | Rôle |
|----------|------|
| `DB_PASSWORD`, `MYSQL_ROOT_PASSWORD` | mots de passe MySQL (mettre du solide) |
| `GROQ_API_KEY` | clé Groq (chat + analyse qualitative) |

Le reste a des valeurs par défaut qui conviennent aux tests. L'URL de l'API du
frontend est gérée automatiquement (voir §5), il n'y a **rien à figer**.

## 3. Construire et lancer

```bash
docker compose build       # construit les 4 images (long la 1re fois)
docker compose up -d       # démarre tout en arrière-plan
docker compose ps          # vérifier que tout est "running"/"healthy"
docker compose logs -f     # suivre les logs (Ctrl-C pour quitter)
```

Au **premier** démarrage, laisser quelques minutes : MySQL initialise la base,
le backend crée le schéma (`TYPEORM_SYNC=true`), et le decision-engine télécharge
le modèle. Les redémarrages suivants sont rapides.

## 4. Accéder à l'application

Depuis n'importe quel poste du réseau de l'entreprise :

```
http://IP_DU_VPS:8096
```

(Remplacer `IP_DU_VPS` par l'adresse du serveur, ex. `http://10.0.0.42:8080`.)

## 5. Pourquoi ça marche quel que soit l'IP

Le frontend n'appelle pas une IP figée : il appelle `/api/...` (la **même
origine** que la page). Le serveur nginx du conteneur frontend **relaie** ces
appels vers le backend via le réseau interne Docker. Conséquence : que les
testeurs ouvrent l'appli par `10.0.0.42:8080`, `localhost:8080` ou un nom de
machine, l'API est toujours jointe correctement — **aucun réglage d'IP**, et
**pas de problème CORS**.

## 6. Vérifier que chaque brique répond (santé)

```bash
# Backend (depuis le VPS)
curl http://localhost:3004/health      # ou la route de santé du backend

# Moteur de décision et extracteur (réseau interne)
docker compose exec backend wget -qO- http://decision-engine:8765/health
docker compose exec backend wget -qO- http://ao-extractor:8770/health

# Le filtre sémantique est-il bien actif ?
docker compose logs decision-engine | grep -i "SemanticFilter"
# -> doit afficher « prêt — modèle ... » (et non « indisponible »)
```

Test fonctionnel rapide : ouvrir l'appli, aller sur **Opportunités**, lancer
une collecte (« Vérifier les nouveautés »), puis attendre le scoring. Le premier
scoring est lent (téléchargement/extraction des PDF), c'est normal.

## 7. Cycle de mise à jour

```bash
git pull                      # récupérer les changements
docker compose build
docker compose up -d          # recrée seulement ce qui a changé
```

## 8. Données persistantes (ne pas perdre entre redémarrages)

- `mysql_data` (volume) : la base.
- `model_cache` (volume) : le modèle d'embeddings.
- `backend/uploads` : CV, diplômes, justificatifs.
- `backend/data`, `decision_engine/data` : paramètres et profil entreprise.

`docker compose down` arrête sans supprimer les volumes. **Ne pas** utiliser
`docker compose down -v` (le `-v` efface la base et le cache modèle).

## 9. Points d'attention pour ces tests

- **API ouverte** : `KIAMA_API_KEY` n'est pas définie, donc l'API n'est pas
  protégée. Acceptable sur un réseau d'entreprise fermé ; à ne pas exposer tel
  quel sur internet. (L'authentification réelle multi-utilisateur est un chantier
  séparé prévu.)
- **HTTP simple** (pas de HTTPS) : suffisant en réseau interne. Pour de l'internet
  public, ajouter un reverse-proxy TLS (Caddy/Traefik) devant.
- **Premier démarrage lent** : modèle d'embeddings ~1 Go à télécharger une fois.

## 10. Dépannage rapide

| Symptôme | Piste |
|----------|-------|
| `frontend`/`ao-extractor` ne se construit pas | vérifier que `docker-compose.yml` a bien `build:` pour ces services (corrigé) |
| Page blanche, appels API en échec | regarder `docker compose logs frontend` et `backend` ; vérifier que le backend est `healthy` |
| Scoring toujours « en attente » | `docker compose logs decision-engine` ; le modèle est-il « prêt » ? Groq répond-il ? |
| « relevance » lent / repli mots-clés | normal sur gros lots ; le tri est batché par paquets de 40 |
| Base repartie de zéro | un `down -v` a été fait : les volumes ont été effacés |
