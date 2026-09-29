# Decision engine — Strategic Compass AI (FastAPI, port 8765)
FROM python:3.11-slim

WORKDIR /app

# Dépendances runtime allégées (voir requirements.runtime.txt) :
# pas de xgboost/shap/jupyter/matplotlib → image légère (scoring MCDA, pas de modèle ML).
# --retries/--timeout : résistance aux coupures réseau (téléchargements tronqués).
COPY requirements.runtime.txt .
# Cache pip (BuildKit) : les wheels déjà téléchargés sont réutilisés d'un build à
# l'autre. Une coupure réseau (connexion lente/instable) reprend SANS tout
# retélécharger. Le cache reste hors de l'image (montage de build, pas une couche).
# Étapes séparées : une fois torch installé, sa couche est mise en cache.
RUN --mount=type=cache,target=/root/.cache/pip pip install --upgrade pip
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --retries 10 --timeout 180 --index-url https://download.pytorch.org/whl/cpu torch
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --retries 10 --timeout 180 -r requirements.runtime.txt

# Code source + profil entreprise par défaut (aucun modèle .pkl — scoring MCDA pur)
COPY . .

ENV PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8765/health').status==200 else 1)" || exit 1

CMD ["python", "-m", "uvicorn", "src.api_service:app", "--host", "0.0.0.0", "--port", "8765"]
