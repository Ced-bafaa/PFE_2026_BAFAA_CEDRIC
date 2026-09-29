"""
Matching mots-clés POST-extraction.

Le scraper télécharge tous les AO d'une région ; c'est ici qu'on décide quels mots-clés
ont matché chaque AO, en regardant le contenu RÉEL du PDF (pas seulement le titre).

Les mots-clés sont lus depuis :
  1. variable d'env `AO_EXTRACTOR_KEYWORDS` (séparée par virgules, point-virgules ou \\n)
  2. fichier `keywords.json` à la racine d'ao_extractor (liste JSON), si absent → []

Le résultat ne FILTRE PAS : il ANNOTE chaque entrée de resultats.json avec :
  - matched_keywords : list[str]    -> mots-clés trouvés (case-insensitive)
  - keyword_match_score : float     -> 0.0 à 1.0, ratio mots-clés trouvés / total recherchés
  - keyword_match_zones : dict      -> {keyword: [zone1, zone2, ...]} pour traçabilité

Cela permet :
  - au frontend de filtrer dynamiquement sans rescraper
  - au dataset ML de garder les "non-matchs" comme contre-exemples utiles
  - à l'utilisateur de comprendre POURQUOI un AO a été retenu
"""
from __future__ import annotations

import json
import os
import re
from typing import Iterable

# Zones du JSON d'extraction où on cherche les mots-clés, par ordre de priorité.
# Une "zone" est un chemin pointé dans le dict `extraction`.
SEARCH_ZONES: list[tuple[str, str]] = [
    ("administratif.objet", "objet"),
    ("technique.tech_stack_keywords", "tech_stack"),
    ("technique.sections.exigences_techniques.text", "exigences_techniques"),
    ("technique.sections.criteres_evaluation.text", "criteres_evaluation"),
    ("technique.sections.personnel_cle.text", "personnel_cle"),
    ("administratif.sections.pieces_administratives.text", "pieces_administratives"),
]


def _split_keyword_string(raw: str) -> list[str]:
    if not raw:
        return []
    parts = re.split(r"[,\n;]+", raw)
    return [p.strip() for p in parts if p.strip()]


def load_keywords(base_dir: str | None = None) -> list[str]:
    """
    Charge les mots-clés depuis l'env puis le fichier keywords.json (fusion dédupliquée).
    `base_dir` : racine d'ao_extractor (où chercher keywords.json).
    """
    env_keywords = _split_keyword_string(os.environ.get("AO_EXTRACTOR_KEYWORDS", ""))

    file_keywords: list[str] = []
    if base_dir:
        path = os.path.join(base_dir, "keywords.json")
        if os.path.isfile(path):
            try:
                with open(path, encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, list):
                    file_keywords = [str(x).strip() for x in data if str(x).strip()]
                elif isinstance(data, dict) and isinstance(data.get("keywords"), list):
                    file_keywords = [str(x).strip() for x in data["keywords"] if str(x).strip()]
            except (OSError, json.JSONDecodeError):
                pass

    seen: set[str] = set()
    out: list[str] = []
    for kw in env_keywords + file_keywords:
        low = kw.lower()
        if low and low not in seen:
            seen.add(low)
            out.append(kw)
    return out


def _resolve_zone(extraction: dict, dotted_path: str) -> str:
    """Récupère le contenu d'une zone par chemin pointé. Renvoie '' si absent."""
    cur: object = extraction
    for part in dotted_path.split("."):
        if isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return ""
        if cur is None:
            return ""
    if isinstance(cur, str):
        return cur
    if isinstance(cur, list):
        # ex: tech_stack_keywords est une liste -> on joint pour matching
        return " ".join(str(x) for x in cur)
    return str(cur)


def _word_boundary_pattern(keyword: str) -> re.Pattern:
    """
    Construit un pattern qui matche le mot-clé en délimitation 'mot' tolérante
    (gère accents, espaces multiples, tirets internes).
    """
    escaped = re.escape(keyword.strip()).replace(r"\ ", r"\s+")
    return re.compile(rf"(?<![A-Za-zÀ-ÿ0-9]){escaped}(?![A-Za-zÀ-ÿ0-9])", re.IGNORECASE)


def match_keywords(extraction: dict, keywords: Iterable[str]) -> dict:
    """
    Annote l'extraction avec les mots-clés trouvés.
    Retourne un dict prêt à fusionner dans le résultat principal.
    """
    keywords = [k for k in keywords if k and k.strip()]
    if not keywords:
        return {
            "matched_keywords": [],
            "keyword_match_score": 0.0,
            "keyword_match_zones": {},
            "keywords_searched": [],
        }

    matched: list[str] = []
    zones_per_kw: dict[str, list[str]] = {}

    for kw in keywords:
        pat = _word_boundary_pattern(kw)
        hit_zones: list[str] = []
        for dotted, label in SEARCH_ZONES:
            content = _resolve_zone(extraction, dotted)
            if content and pat.search(content):
                hit_zones.append(label)
        if hit_zones:
            matched.append(kw)
            zones_per_kw[kw] = hit_zones

    score = len(matched) / len(keywords) if keywords else 0.0

    return {
        "matched_keywords": matched,
        "keyword_match_score": round(score, 4),
        "keyword_match_zones": zones_per_kw,
        "keywords_searched": list(keywords),
    }
