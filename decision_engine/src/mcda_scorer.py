# -*- coding: utf-8 -*-
"""
Scoring décisionnel MCDA (aide à la décision multicritère) — remplace le XGBoost
circulaire (qui sortait 96/go pour tout). Transparent et discriminant par construction.

Architecture (voir KIAMA_Conception_refonte_scoring) :
  - Barrière d'éligibilité (go/no-go) : gérée en amont (evaluate_eligibility).
  - Score d'adéquation = somme pondérée de 5 critères, poids AHP (Saaty), CR=0.015 :
        S = 100 * Σ wᵢ·vᵢ
  - Recommandation = barrière éligibilité + seuils sur S.

Chaque critère est ramené sur [0,1] par une fonction de valeur explicite.
"""
from __future__ import annotations

import datetime as _dt
import re
from typing import Optional

# ─── Poids AHP — « Valeur du marché » conservée mais ALLÉGÉE (23/06/2026) ────────
# Décision de Ced : la taille du marché doit compter un PEU (récompenser les gros
# gains) mais ne jamais HANDICAPER un petit marché. On baisse donc son poids de
# 16 % → 7 % (les autres critères, poids AHP d'origine 0.417/0.263/0.097/0.062,
# renormalisés sur les 93 % restants), ET la fonction de valeur a un plancher haut
# (cf. _v_valeur) : un petit marché perd au pire ~1 point.
# Poids AHP bruts (vecteur propre de la matrice de comparaison, cf. annexe A du
# mémoire) : 0.420 / 0.264 / 0.159 / 0.096 / 0.061  —  lambda_max = 5.0673,
# CI = 0.01684, CR = 0.01503 (< 0.10, jugements cohérents).
# Puis « valeur du marché » ramenée de 0.159 à 0.070 et les quatre autres
# renormalisés sur les 93 % restants (facteur 1.10527).
W = {
    "technique":    0.465,  # adéquation au profil de compétences (embeddings)
    "capacite":     0.292,  # capacité financière (ratio CA / budget)
    "valeur":       0.070,  # valeur du marché (bonus de taille, ne pénalise jamais)
    "delai":        0.106,  # faisabilité du délai (jours avant clôture)
    "financement":  0.067,  # fiabilité du financement (BIP / bailleur)
}

# Seuils de recommandation (calibrables, voir gold set)
SEUIL_GO = 70.0
SEUIL_ETUDE = 50.0


def _clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def _profile_text(cp: dict) -> str:
    """Texte-profil de l'entreprise pour la comparaison sémantique."""
    parts = [str(cp.get("description", ""))]
    parts += [str(d) for d in (cp.get("domaines") or [])]
    for c in (cp.get("competencies") or []):
        parts.append(str(c.get("domain", "")))
        parts += [str(k) for k in (c.get("keywords") or [])]
    return " ; ".join(p for p in parts if p)[:2000]


# ─── Fonctions de valeur (chaque critère → [0,1]) ───────────────────────────────
def _v_technique(objet: str, cp: dict, sem_filter) -> tuple[float, str]:
    """C1 : cosinus entre l'objet de l'AO et le profil de compétences (embeddings)."""
    if sem_filter is None or not getattr(sem_filter, "is_available", False):
        return 0.5, "modèle indisponible (repli neutre)"
    try:
        from semantic_filter import clean_title
        o = clean_title(objet) or (objet or "")
        if len(o) < 4:
            return 0.5, "objet vide"
        ov = sem_filter._encode(o, kind="query")[0]
        # profil entreprise mis en cache (identique d'un AO à l'autre)
        if hasattr(sem_filter, "_encode_passage_cached"):
            pv = sem_filter._encode_passage_cached(_profile_text(cp))
        else:
            pv = sem_filter._encode(_profile_text(cp), kind="passage")[0]
        sim = float(ov @ pv)
        # cosinus ~ [0.15 ; 0.55] sur ce corpus → rééchelonné sur [0 ; 1]
        return round(_clamp((sim - 0.15) / 0.40), 3), f"cosinus={round(sim, 3)}"
    except Exception as exc:  # pragma: no cover
        return 0.5, f"erreur ({exc})"


def _v_capacite(ratio_ca: Optional[float], ratio_credit: Optional[float]) -> float:
    """C2 : capacité financière. ratio_ca = CA / budget ; confortable si ≥ 3."""
    if not ratio_ca or ratio_ca <= 0:
        return 0.5
    return round(_clamp(float(ratio_ca) / 3.0), 3)


def _v_valeur(budget: Optional[float]) -> float:
    """C3 : valeur du marché — BONUS de taille qui NE PÉNALISE JAMAIS. Plancher haut
    (0.85) pour tout marché ; monte doucement vers 1.0 pour les gros (≥ 300 M).
    Couplé à un poids faible (7 %), un petit marché perd au pire ~1 point. La capacité
    à FINANCER un gros marché reste gérée par C2 (capacité financière), pas ici."""
    if not budget or budget <= 0:
        return 0.9
    return round(0.85 + 0.15 * min(float(budget), 300_000_000) / 300_000_000, 3)


def _v_delai(jours: Optional[int]) -> float:
    """C4 : faisabilité du délai. ≥ 30 jours = idéal ; clôturé = 0."""
    if jours is None:
        return 0.5
    if jours < 0:
        return 0.0
    return round(_clamp(jours / 30.0), 3)


_FIN_FIABLE = ("bip", "budget d'investissement", "bailleur", "banque mondiale",
               "bad ", "union europ", "afd", "ida ", "fonds", "c2d", "kfw", "bid")


def _v_financement(txt: Optional[str]) -> float:
    """C5 : fiabilité du financement."""
    t = (txt or "").lower()
    if any(k in t for k in _FIN_FIABLE):
        return 1.0
    if "budget" in t:
        return 0.7
    return 0.6


def days_until(date_str: Optional[str]) -> Optional[int]:
    """Jours entre aujourd'hui et une date (formats jj-mm-aaaa, jj/mm/aaaa, aaaa-mm-jj)."""
    if not date_str:
        return None
    s = str(date_str).strip()
    m = re.search(r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})", s)        # aaaa-mm-jj
    if m:
        y, mo, d = map(int, m.groups())
    else:
        m = re.search(r"(\d{1,2})[-/](\d{1,2})[-/](\d{4})", s)    # jj-mm-aaaa
        if not m:
            return None
        d, mo, y = map(int, m.groups())
    try:
        return (_dt.date(y, mo, d) - _dt.date.today()).days
    except ValueError:
        return None


def score_mcda(
    *,
    objet: str,
    budget: Optional[float],
    ratio_ca: Optional[float],
    ratio_credit: Optional[float],
    deadline: Optional[str],
    financement: Optional[str],
    company_profile: dict,
    sem_filter=None,
    eligible: bool = True,
    blocking: bool = False,
) -> dict:
    """Calcule le score MCDA (0–100) + le détail des critères + la recommandation."""
    v1, e1 = _v_technique(objet, company_profile or {}, sem_filter)
    v2 = _v_capacite(ratio_ca, ratio_credit)
    v3 = _v_valeur(budget)
    j = days_until(deadline)
    v4 = _v_delai(j)
    v5 = _v_financement(financement)

    s = 100.0 * (W["technique"] * v1 + W["capacite"] * v2 + W["valeur"] * v3
                 + W["delai"] * v4 + W["financement"] * v5)
    s = round(s, 1)

    # Barrière d'éligibilité + seuils
    if (not eligible) or blocking:
        verdict, reco, prediction = "NO-GO (Risque)", "écarter", 0
    elif s >= SEUIL_GO:
        verdict, reco, prediction = "GO (Postuler)", "soumettre", 1
    elif s >= SEUIL_ETUDE:
        verdict, reco, prediction = "À ÉTUDIER", "à étudier", 1
    else:
        verdict, reco, prediction = "NO-GO (Risque)", "écarter", 0

    return {
        "score": s,
        "prediction": prediction,
        "verdict": verdict,
        "recommandation": reco,
        "eligible": bool(eligible) and not blocking,
        "criteres": {
            "adequation_technique":  {"valeur": v1, "poids": W["technique"], "detail": e1},
            "capacite_financiere":   {"valeur": v2, "poids": W["capacite"]},
            "valeur_marche":         {"valeur": v3, "poids": W["valeur"]},
            "faisabilite_delai":     {"valeur": v4, "poids": W["delai"], "jours": j},
            "fiabilite_financement": {"valeur": v5, "poids": W["financement"]},
        },
    }
