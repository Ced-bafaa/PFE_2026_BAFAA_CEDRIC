"""
Service HTTP d'extraction (Option 2 — PDF transitoire).

Au lieu de surveiller un dossier partagé, l'extracteur expose une API : le
backend lui envoie les octets d'un PDF + l'identifiant de l'opportunité, et
reçoit en retour le JSON structuré (administratif / financier / technique /
personnel_cle_struct). Le PDF n'est jamais persisté ici : il est écrit dans un
fichier temporaire, extrait, puis supprimé immédiatement.

Ce fichier est ADDITIF : il réutilise `extract_pdf_file` (main.py) sans rien
modifier au moteur d'extraction existant. Le watcher reste fonctionnel tant que
la bascule n'est pas terminée ; les deux déclencheurs peuvent coexister.

Lancement :
  uvicorn api_extractor:app --host 0.0.0.0 --port 8770
Dépendances supplémentaires (à installer dans l'environnement ao_extractor) :
  pip install fastapi uvicorn
"""

from __future__ import annotations

import logging
import os
import tempfile
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel

from main import BASE_DIR, extract_pdf_file, _configure_stdout_utf8

_configure_stdout_utf8()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ao_extractor.api")

app = FastAPI(
    title="KIAMA — Extracteur DAO",
    description="Extraction structurée d'un PDF d'appel d'offres (PDF transitoire).",
    version="1.0.0",
)

# Taille maximale acceptée (garde-fou ; ARMP plafonne déjà les pièces à ~15 Mo).
_MAX_PDF_BYTES = int(os.environ.get("AO_EXTRACTOR_MAX_PDF_BYTES", str(40 * 1024 * 1024)))


class ExtractResponse(BaseModel):
    opportunity_id: str
    extraction: dict[str, Any]


@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "version": "1.0.0", "base_dir": BASE_DIR}


@app.post("/extract", response_model=ExtractResponse)
async def extract(request: Request, opportunity_id: Optional[str] = None) -> ExtractResponse:
    """
    Corps de la requête = octets bruts du PDF (Content-Type: application/pdf).
    L'identifiant de l'opportunité est passé en query (?opportunity_id=...) ou
    via l'en-tête `x-opportunity-id`. C'est lui qui supprime tout besoin de
    « rattacher » le PDF après coup : l'appelant sait déjà à quoi il correspond.
    """
    opp_id = (opportunity_id or request.headers.get("x-opportunity-id") or "").strip()
    if not opp_id:
        raise HTTPException(status_code=400, detail="opportunity_id requis (query ou en-tête x-opportunity-id).")

    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="Corps vide : octets du PDF attendus.")
    if len(body) > _MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail=f"PDF trop volumineux (> {_MAX_PDF_BYTES} octets).")

    # PDF écrit dans un temporaire, extrait, puis supprimé — jamais persisté.
    tmp_path: Optional[str] = None
    try:
        fd, tmp_path = tempfile.mkstemp(suffix=".pdf", prefix="ao_extract_")
        with os.fdopen(fd, "wb") as f:
            f.write(body)

        try:
            result = extract_pdf_file(tmp_path)
        except ValueError as exc:
            # En-tête non-PDF (page HTML ARMP, téléchargement incorrect…)
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except Exception as exc:  # noqa: BLE001 — on remonte une 500 explicite
            logger.exception("Extraction échouée pour %s", opp_id)
            raise HTTPException(status_code=500, detail=f"Extraction échouée : {exc}") from exc

        if not result:
            raise HTTPException(status_code=422, detail="Aucun résultat d'extraction.")

        # nom_fichier interne (temp) sans intérêt côté Option 2 : on le remplace
        # par une trace lisible. Le backend, lui, n'a besoin que d'opportunity_id.
        result["nom_fichier"] = f"{opp_id}.pdf"
        logger.info("Extraction OK opportunity_id=%s (%d octets)", opp_id, len(body))
        return ExtractResponse(opportunity_id=opp_id, extraction=result)
    finally:
        if tmp_path and os.path.isfile(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("AO_EXTRACTOR_API_PORT", "8770"))
    uvicorn.run(app, host="0.0.0.0", port=port)
