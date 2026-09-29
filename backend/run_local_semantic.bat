@echo off
REM ============================================================================
REM  Backend KIAMA en LOCAL, tri de pertinence = SEMANTIQUE.
REM  PREREQUIS : arrete d'abord le backend Docker pour liberer le port 3004 :
REM      docker compose stop backend
REM  Le front (.env = http://localhost:3004) parlera alors a ce backend local.
REM ============================================================================
set RELEVANCE_MODE=semantic
set DECISION_ENGINE_URL=http://localhost:8765
set PORT=3004
set TYPEORM_SYNC=true
cd /d %~dp0
echo [backend local] tri SEMANTIQUE - port %PORT% - decision_engine %DECISION_ENGINE_URL%
npm run start:dev
