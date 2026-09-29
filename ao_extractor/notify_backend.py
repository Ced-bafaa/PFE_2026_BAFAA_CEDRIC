"""Appelle le backend KIAMA pour scorer une opportunité juste après extraction."""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request

log = logging.getLogger("ao_extractor.notify_backend")


def notify_score_after_extraction(nom_fichier: str) -> bool:
    """
    POST /opportunities/score-by-pdf — déclenchement immédiat du scoring.
    Retourne True si le backend a répondu 2xx.
    """
    base = (os.environ.get("KIAMA_BACKEND_URL") or "http://localhost:3004").rstrip("/")
    url = f"{base}/opportunities/score-by-pdf"
    payload = json.dumps({"nomFichier": nom_fichier}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            # Clé d'API partagée (voir ApiKeyGuard côté backend) — facultative en dev
            **({"x-api-key": os.environ["KIAMA_API_KEY"].strip()}
               if os.environ.get("KIAMA_API_KEY", "").strip() else {}),
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            log.info("Scoring backend OK (%s): %s", resp.status, body[:200])
            return 200 <= resp.status < 300
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        log.warning("Scoring backend HTTP %s: %s", e.code, err_body[:300])
        return False
    except Exception as e:
        log.warning("Scoring backend indisponible (%s): %s", url, e)
        return False
