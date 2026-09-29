@echo off
REM ============================================================================
REM  decision_engine en LOCAL avec le filtre semantique ACTIVE (drapeau 1).
REM  - SEMANTIC_FILTER_ENABLED=true  -> le modele est charge, /relevance classe
REM  - SEMANTIC_CACHE_DIR            -> reutilise mpnet deja en cache (pas de
REM                                     re-telechargement)
REM  Lance l'API sur le port 8765 (meme port que dans Docker).
REM  Prerequis : pip install fastapi "uvicorn[standard]" sentence-transformers
REM ============================================================================
set SEMANTIC_FILTER_ENABLED=true
set SEMANTIC_CACHE_DIR=%USERPROFILE%\.cache\kiama_models
set SEMANTIC_MODEL=paraphrase-multilingual-mpnet-base-v2
set SEMANTIC_EPS=0.05
cd /d %~dp0
echo [decision_engine] filtre semantique ACTIVE  (modele=%SEMANTIC_MODEL%)
python -m uvicorn api_service:app --app-dir src --port 8765
