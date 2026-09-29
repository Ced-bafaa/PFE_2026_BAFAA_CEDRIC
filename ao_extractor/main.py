import os
import json
import shutil
import sys
import tempfile
import threading
import time
from typing import Any

from core.engine import MarchesPublicsExtractor

# Dossier racine du projet (là où se trouve main.py)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Évite les courses entre threads (watcher) : lecture + fusion + écriture de resultats.json
_results_json_lock = threading.Lock()

_EXTRACT_OPEN_RETRIES = 10
_EXTRACT_OPEN_DELAY_SEC = 0.45


def _configure_stdout_utf8() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def _is_file_busy_error(exc: BaseException) -> bool:
    if isinstance(exc, PermissionError):
        return True
    if isinstance(exc, OSError):
        # Windows: 32 = ERROR_SHARING_VIOLATION, 33 = ERROR_LOCK_VIOLATION
        if getattr(exc, "winerror", None) in (32, 33):
            return True
        if getattr(exc, "errno", None) in (11, 13, 16):  # EAGAIN, EACCES, EBUSY (selon OS)
            return True
    return False


def _validate_is_binary_pdf(pdf_path: str) -> None:
    """Rejette les « .pdf » qui sont en réalité du HTML (téléchargement ARMP incorrect)."""
    with open(pdf_path, "rb") as f:
        head = f.read(4096)
    if len(head) >= 4 and head[:4] == b"%PDF":
        return
    probe = head.lstrip()[:300].lower()
    if probe.startswith((b"<!doctype", b"<html", b"<head", b"<!--", b"<?xml")):
        raise ValueError(
            "Le fichier est une page HTML/XML, pas un PDF binaire. "
            "Mettez à jour le backend (Nest) pour résoudre le vrai PDF puis rescrapez."
        )
    raise ValueError(
        "En-tête fichier invalide (attendu %PDF). Le téléchargement n'a probablement pas renvoyé un PDF."
    )


def _extract_with_retries(pdf_path: str) -> dict:
    """
    Lance MarchesPublicsExtractor sur le fichier ; en cas de fichier encore verrouillé
    (téléchargement / antivirus), retente puis copie vers un temporaire si nécessaire.
    """
    last: BaseException | None = None
    for attempt in range(_EXTRACT_OPEN_RETRIES):
        try:
            extractor = MarchesPublicsExtractor(pdf_path)
            return extractor.parse()
        except Exception as e:
            last = e
            if not _is_file_busy_error(e):
                raise
            time.sleep(_EXTRACT_OPEN_DELAY_SEC * (attempt + 1))

    # Dernière tentative : copie hors du fichier source (libère le lock côté scraper)
    tmp_path = None
    try:
        fd, tmp_path = tempfile.mkstemp(
            suffix=".pdf",
            prefix="ao_extract_",
            dir=os.path.dirname(os.path.abspath(pdf_path)) or None,
        )
        os.close(fd)
        # copyfile libère le descripteur rapidement ; le scraper peut garder son handle sur l'original
        shutil.copyfile(pdf_path, tmp_path)
        extractor = MarchesPublicsExtractor(tmp_path)
        return extractor.parse()
    except Exception:
        if last is not None:
            raise last from None
        raise
    finally:
        if tmp_path and os.path.isfile(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


def extract_pdf_file(pdf_path: str) -> dict | None:
    """
    Extraction d'un seul PDF (point d'entrée pour le watcher et scripts).
    Retourne le dict parse() enrichi de nom_fichier, ou None si ce n'est pas un .pdf.
    """
    if not str(pdf_path).lower().endswith(".pdf"):
        return None
    file = os.path.basename(pdf_path)
    _validate_is_binary_pdf(pdf_path)
    result = _extract_with_retries(pdf_path)
    result["nom_fichier"] = file
    return result


def load_results_list(output_json_path: str) -> list:
    if not os.path.isfile(output_json_path):
        return []
    with open(output_json_path, encoding="utf-8") as f:
        try:
            data = json.load(f)
            return data if isinstance(data, list) else []
        except json.JSONDecodeError:
            return []


def save_results_merged(output_json_path: str, new_results: list) -> None:
    """Fusionne new_results dans resultats.json par clé nom_fichier (mise à jour ou ajout)."""
    with _results_json_lock:
        d = os.path.dirname(output_json_path)
        if d:
            os.makedirs(d, exist_ok=True)
        existing = load_results_list(output_json_path)
        by_name = {
            r.get("nom_fichier"): r
            for r in existing
            if isinstance(r, dict) and r.get("nom_fichier")
        }
        for r in new_results:
            if isinstance(r, dict) and r.get("nom_fichier"):
                by_name[r["nom_fichier"]] = r
        payload: list[Any] = list(by_name.values())

        # Rotation : au-delà du plafond, les entrées les plus anciennes partent
        # en archive (rien n'est supprimé). Le fichier actif reste petit pour
        # le lecteur backend qui le recharge à chaque scoring.
        max_entries = int(os.environ.get("AO_RESULTS_MAX_ENTRIES", "300"))
        if max_entries > 0 and len(payload) > max_entries:
            archive_path = os.path.join(
                os.path.dirname(output_json_path) or ".", "resultats.archive.json"
            )
            overflow = payload[:-max_entries]
            payload = payload[-max_entries:]
            archived = load_results_list(archive_path)
            _atomic_write_json(archive_path, archived + overflow)

        _atomic_write_json(output_json_path, payload)


def _atomic_write_json(output_json_path: str, payload: list[Any]) -> None:
    d = os.path.dirname(output_json_path) or "."
    fd, tmp = tempfile.mkstemp(
        suffix=".json.tmp",
        prefix="resultats_",
        dir=d,
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=4, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, output_json_path)
    except Exception:
        try:
            if os.path.isfile(tmp):
                os.remove(tmp)
        except OSError:
            pass
        raise


def result_saved_for_file(output_dir: str, nom_fichier: str) -> bool:
    """Vérifie que resultats.json contient bien une entrée pour ce nom (après écriture)."""
    out_path = os.path.join(output_dir, "resultats.json")
    with _results_json_lock:
        for r in load_results_list(out_path):
            if isinstance(r, dict) and r.get("nom_fichier") == nom_fichier:
                return True
    return False


def process_single_pdf(pdf_path: str, output_dir: str) -> dict | None:
    """
    Extrait un PDF et enregistre le résultat dans output/resultats.json (merge).
    Lève les exceptions de parse() / I/O pour que l'appelant puisse éviter de déplacer le fichier.
    """
    result = extract_pdf_file(pdf_path)
    if not result:
        return None
    out_path = os.path.join(output_dir, "resultats.json")
    save_results_merged(out_path, [result])
    return result


def run():
    _configure_stdout_utf8()

    input_dir = os.path.join(BASE_DIR, "data")
    output_dir = os.path.join(BASE_DIR, "output")
    os.makedirs(output_dir, exist_ok=True)
    all_results = []

    print(f"--- Démarrage de l'extraction ---", flush=True)

    for file in os.listdir(input_dir):
        if file.endswith(".pdf"):
            path = os.path.join(input_dir, file)
            print(f"Analyse de : {file}...", flush=True)

            try:
                extractor = MarchesPublicsExtractor(path)
                result = extractor.parse()
                result["nom_fichier"] = file
                all_results.append(result)
            except Exception as e:
                print(f"Erreur sur {file} : {e}", flush=True)

    out_json = os.path.join(output_dir, "resultats.json")
    save_results_merged(out_json, all_results)

    print(
        f"--- Terminé ! {len(all_results)} fichiers analysés. Résultats dans {output_dir} ---",
        flush=True,
    )


if __name__ == "__main__":
    run()