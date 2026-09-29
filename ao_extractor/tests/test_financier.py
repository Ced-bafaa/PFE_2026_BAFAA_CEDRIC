# -*- coding: utf-8 -*-
"""
Tests C1 — extraction financière robuste (caution, CA min / surface financière,
ligne de crédit). Verrouille le correctif du « score figé » : ces montants
doivent être captés pour que les features du decision engine varient.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.engine import (  # noqa: E402
    extract_caution_global_struct,
    extract_hard_filters_struct,
)


# ── Caution ────────────────────────────────────────────────────────────────────

def test_caution_de_soumission_montant():
    text = (
        "9. Cautionnement de soumission\n"
        "Chaque soumissionnaire doit joindre un cautionnement de soumission daté, "
        "signé, timbré, dont le montant s'élève à trois cent dix mille (310 000) "
        "francs CFA, valable pendant 90 jours au-delà de la validité des offres.\n"
        "11. Acquisition du DAO\n"
        "contre versement d'une somme non remboursable de vingt-cinq mille "
        "(25 000) francs CFA."
    )
    out = extract_caution_global_struct(text)
    # Le montant de la caution est capté…
    assert out["valeur"] == 310000
    # …et les frais d'achat (25 000, 5 chiffres) sont exclus, pas confondus.
    assert out["valeur"] != 25000


def test_caution_libelle_provisoire():
    text = (
        "Cautionnement provisoire : le soumissionnaire fournit une garantie "
        "d'un montant de cinq cent mille (500 000) FCFA."
    )
    out = extract_caution_global_struct(text)
    assert out["valeur"] == 500000


def test_caution_absente():
    out = extract_caution_global_struct("Le présent marché porte sur la fourniture de mobilier.")
    assert out["valeur"] == 0


def test_caution_texte_vide():
    out = extract_caution_global_struct("")
    assert out == {"text": "", "valeur": 0, "validite": ""}


# ── CA minimum / surface financière ─────────────────────────────────────────────

def test_surface_financiere_captee():
    text = (
        "Critères éliminatoires : l'absence d'une attestation de surface "
        "financière d'un montant minimal de huit millions (8 000 000) francs CFA "
        "délivrée par une banque agréée entraînera le rejet."
    )
    out = extract_hard_filters_struct(text)
    valeurs = [item["valeur"] for item in out["chiffre_affaires_min"]]
    assert 8000000 in valeurs


def test_chiffre_affaires_minimum_capte():
    text = (
        "Le soumissionnaire doit justifier d'un chiffre d'affaires annuel minimum "
        "de cent millions (100 000 000) FCFA sur les trois derniers exercices."
    )
    out = extract_hard_filters_struct(text)
    valeurs = [item["valeur"] for item in out["chiffre_affaires_min"]]
    assert 100000000 in valeurs


# ── Ligne de crédit ─────────────────────────────────────────────────────────────

def test_ligne_de_credit_captee():
    text = (
        "Le candidat fournira une attestation de ligne de crédit d'un montant de "
        "cinquante millions (50 000 000) FCFA délivrée par un établissement agréé."
    )
    out = extract_hard_filters_struct(text)
    valeurs = [item["valeur"] for item in out["ligne_credit_min"]]
    assert 50000000 in valeurs


# ── Hard filters vide ───────────────────────────────────────────────────────────

def test_hard_filters_texte_vide():
    out = extract_hard_filters_struct("")
    assert out == {
        "certifications": [],
        "chiffre_affaires_min": [],
        "ligne_credit_min": [],
        "autres": [],
    }
