"""
Surveillance du dossier data/ : à chaque nouveau PDF, extraction puis déplacement vers processed/.
"""
from __future__ import annotations

import logging
import os
import queue
import shutil
import threading
import time

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

from main import (
    BASE_DIR,
    process_single_pdf,
    result_saved_for_file,
    _configure_stdout_utf8,
)
from notify_backend import notify_score_after_extraction

# Dossiers (chemins absolus demandés / relatifs au projet)
DATA_DIR = os.environ.get(
    "AO_EXTRACTOR_WATCH_DATA",
    os.path.join(BASE_DIR, "data"),
)
PROCESSED_DIR = os.environ.get(
    "AO_EXTRACTOR_WATCH_PROCESSED",
    os.path.join(BASE_DIR, "processed"),
)
OUTPUT_DIR = os.path.join(BASE_DIR, "output")

# Éviter les doubles traitements (création + parfois modification sous Windows)
_processing_lock = threading.Lock()
_recent: dict[str, float] = {}
_DEBOUNCE_SEC = 2.0
_in_flight: set[str] = set()
_in_flight_lock = threading.Lock()

# Un seul worker traite les PDF à la fois (ordre garanti : extraction → JSON → déplacement)
_task_queue: queue.Queue[str | None] = queue.Queue()

log = logging.getLogger("ao_extractor.watcher")


def cleanup_processed_older_than(
    processed_dir: str,
    *,
    max_age_days: int = 30,
) -> int:
    """
    Supprime les fichiers dans processed_dir dont la date de modification est
    strictement antérieure à maintenant - max_age_days.
    Retourne le nombre de fichiers supprimés.
    """
    if max_age_days < 1:
        return 0
    if not os.path.isdir(processed_dir):
        return 0

    cutoff = time.time() - max_age_days * 86400
    removed = 0
    for name in os.listdir(processed_dir):
        path = os.path.join(processed_dir, name)
        try:
            if not os.path.isfile(path):
                continue
            if os.path.getmtime(path) < cutoff:
                os.remove(path)
                removed += 1
                log.info("Nettoyage: supprimé (>%s j) %s", max_age_days, name)
        except OSError as e:
            log.warning("Nettoyage: impossible de traiter %s: %s", path, e)
    return removed


def _wait_until_file_stable(path: str, *, max_wait: float = 30.0, interval: float = 0.25) -> bool:
    """Attend que la taille du fichier se stabilise (téléchargement terminé)."""
    deadline = time.time() + max_wait
    last_size = -1
    stable_rounds = 0
    needed_stable = 2

    while time.time() < deadline:
        if not os.path.isfile(path):
            time.sleep(interval)
            continue
        try:
            size = os.path.getsize(path)
        except OSError:
            time.sleep(interval)
            continue
        if size <= 0:
            time.sleep(interval)
            continue
        if size == last_size:
            stable_rounds += 1
            if stable_rounds >= needed_stable:
                return True
        else:
            stable_rounds = 0
            last_size = size
        time.sleep(interval)
    return os.path.isfile(path) and os.path.getsize(path) > 0


def _should_skip_duplicate(path: str) -> bool:
    now = time.time()
    with _processing_lock:
        # purge vieux entrées debounce
        stale = [k for k, t in _recent.items() if now - t > _DEBOUNCE_SEC * 3]
        for k in stale:
            del _recent[k]
        last = _recent.get(path)
        if last is not None and (now - last) < _DEBOUNCE_SEC:
            return True
        _recent[path] = now
    return False


def _safe_move_to_processed(src: str, dest_dir: str) -> str:
    os.makedirs(dest_dir, exist_ok=True)
    name = os.path.basename(src)
    dest = os.path.join(dest_dir, name)
    if os.path.abspath(src) == os.path.abspath(dest):
        return dest
    if os.path.exists(dest):
        base, ext = os.path.splitext(name)
        dest = os.path.join(dest_dir, f"{base}__{int(time.time())}{ext}")
    shutil.move(src, dest)
    return dest


def _same_data_dir(path: str, data_root: str) -> bool:
    d = os.path.normpath(os.path.dirname(path))
    root = os.path.normpath(data_root)
    return os.path.normcase(d) == os.path.normcase(root)


def handle_new_pdf(abs_path: str) -> None:
    path = os.path.normpath(os.path.abspath(abs_path))
    if not path.lower().endswith(".pdf"):
        return
    data_root = os.path.normpath(os.path.abspath(DATA_DIR))
    if not _same_data_dir(path, data_root):
        return

    if not os.path.isfile(path):
        log.debug("PDF absent sur disque (déjà déplacé ou renommage en cours): %s", path)
        return

    if _should_skip_duplicate(path):
        log.debug("Ignoré (debounce): %s", path)
        return

    with _in_flight_lock:
        if path in _in_flight:
            log.debug("Déjà en cours: %s", path)
            return
        _in_flight.add(path)

    try:
        log.info("Traitement PDF: %s", path)

        if not _wait_until_file_stable(path):
            log.warning("Fichier pas stable ou vide, abandon: %s", path)
            return

        nom_fichier = os.path.basename(path)
        try:
            result = process_single_pdf(path, OUTPUT_DIR)
        except Exception as e:
            log.exception("Extraction échouée, le fichier reste dans data: %s — %s", path, e)
            return

        if not result:
            log.warning("Aucun résultat d'extraction, fichier non déplacé: %s", path)
            return

        if not result_saved_for_file(OUTPUT_DIR, nom_fichier):
            log.error(
                "resultats.json ne contient pas %s après écriture — déplacement annulé.",
                nom_fichier,
            )
            return

        if not os.path.isfile(path):
            log.warning("Fichier source disparu avant déplacement: %s", path)
            return

        try:
            final = _safe_move_to_processed(path, PROCESSED_DIR)
            log.info("Extraction enregistrée, déplacé vers processed: %s", final)
        except OSError as e:
            log.error("Déplacement vers processed impossible: %s — %s", path, e)
            return

        notify_score_after_extraction(nom_fichier)
    finally:
        with _in_flight_lock:
            _in_flight.discard(path)


def _pdf_worker_loop() -> None:
    while True:
        item = _task_queue.get()
        if item is None:
            _task_queue.task_done()
            break
        try:
            handle_new_pdf(item)
        finally:
            _task_queue.task_done()


class PdfWatchHandler(FileSystemEventHandler):
    def on_created(self, event: FileSystemEvent) -> None:
        if event.is_directory:
            return
        self._enqueue(event.src_path)

    def on_modified(self, event: FileSystemEvent) -> None:
        # Certains outils écrivent le fichier puis le ferment (modified après created)
        if event.is_directory:
            return
        self._enqueue(event.src_path)

    def on_moved(self, event: FileSystemEvent) -> None:
        # Téléchargements atomiques : .tmp → .pdf dans le même dossier
        if event.is_directory:
            return
        dest = getattr(event, "dest_path", None) or ""
        if str(dest).lower().endswith(".pdf"):
            self._enqueue(dest)

    def _enqueue(self, src_path: str) -> None:
        if not str(src_path).lower().endswith(".pdf"):
            return
        path = os.path.normpath(os.path.abspath(src_path))
        _task_queue.put(path)


def _periodic_cleanup(stop_event: threading.Event, interval_sec: float = 86400.0) -> None:
    while not stop_event.wait(timeout=interval_sec):
        n = cleanup_processed_older_than(PROCESSED_DIR, max_age_days=30)
        if n:
            log.info("Nettoyage périodique: %s fichier(s) supprimé(s).", n)


def main() -> None:
    _configure_stdout_utf8()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(PROCESSED_DIR, exist_ok=True)
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    n = cleanup_processed_older_than(PROCESSED_DIR, max_age_days=30)
    if n:
        log.info("Au démarrage: %s fichier(s) de plus de 30 jours supprimé(s) dans processed.", n)

    stop_cleanup = threading.Event()
    cleanup_thread = threading.Thread(
        target=_periodic_cleanup,
        args=(stop_cleanup,),
        daemon=True,
        name="cleanup-processed",
    )
    cleanup_thread.start()

    worker = threading.Thread(target=_pdf_worker_loop, daemon=True, name="pdf-worker")
    worker.start()

    handler = PdfWatchHandler()
    observer = Observer()
    observer.schedule(handler, DATA_DIR, recursive=False)
    observer.start()
    log.info("Surveillance de %s — PDFs extraits puis déplacés vers %s", DATA_DIR, PROCESSED_DIR)

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        log.info("Arrêt demandé.")
    finally:
        stop_cleanup.set()
        _task_queue.put(None)
        observer.stop()
        observer.join(timeout=5)


if __name__ == "__main__":
    main()
