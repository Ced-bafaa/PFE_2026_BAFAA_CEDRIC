# -*- coding: utf-8 -*-
"""
Tests de l'extraction structurée des exigences de personnel depuis le texte
d'un bloc « Personnel clé » de DAO (core.engine.extract_personnel_cle_struct).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.engine import extract_personnel_cle_struct  # noqa: E402


def test_empty_text():
    assert extract_personnel_cle_struct("") == []
    assert extract_personnel_cle_struct(None) == []


def test_no_known_role():
    assert extract_personnel_cle_struct("Le présent marché porte sur la fourniture de mobilier.") == []


def test_basic_role_with_experience_and_diploma():
    text = "Un Chef de projet titulaire d'un Master en informatique justifiant de 10 ans d'expérience."
    out = extract_personnel_cle_struct(text)
    assert len(out) == 1
    req = out[0]
    assert req["poste"] == "Chef de projet"
    assert req["experience_min_annees"] == 10
    assert "master" in req["diplome"].lower()
    assert req["effectif_min"] == 1


def test_deduplication_keeps_strictest():
    # Le même poste mentionné deux fois : on garde l'exigence la plus stricte
    text = (
        "Un Chef de projet avec 5 ans d'expérience, Licence exigée. "
        "Par ailleurs le Chef de projet devra justifier de 8 ans d'expérience et d'un Master."
    )
    out = extract_personnel_cle_struct(text)
    postes = [r["poste"] for r in out]
    assert postes.count("Chef de projet") == 1
    req = next(r for r in out if r["poste"] == "Chef de projet")
    assert req["experience_min_annees"] == 8
    assert "master" in req["diplome"].lower()


def test_certifications_alternatives_ou():
    text = "Un Chef de projet certifié PMP ou Prince2, avec 5 ans d'expérience."
    out = extract_personnel_cle_struct(text)
    req = next(r for r in out if r["poste"] == "Chef de projet")
    assert ["PMP", "Prince2"] in req["certifications"]


def test_certifications_cumulatives_et():
    text = "Un Expert sécurité certifié CEH et titulaire de la certification ISO 27001 Lead Auditor."
    out = extract_personnel_cle_struct(text)
    req = next(r for r in out if "sécurité" in r["poste"].lower() or "securite" in r["poste"].lower())
    groups = req["certifications"]
    # Deux groupes distincts (ET) : CEH d'une part, ISO 27001 d'autre part
    flat = [c for g in groups for c in g]
    assert "CEH" in flat and "ISO 27001" in flat
    assert not any("CEH" in g and "ISO 27001" in g for g in groups)


def test_headcount_parentheses():
    text = "Deux (02) Ingénieurs en génie logiciel, Bac+5, 5 ans d'expérience minimum."
    out = extract_personnel_cle_struct(text)
    req = next(r for r in out if "ingénieur" in r["poste"].lower() or "ingenieur" in r["poste"].lower())
    assert req["effectif_min"] == 2


def test_headcount_word():
    text = "Trois développeurs ayant une Licence en informatique."
    out = extract_personnel_cle_struct(text)
    req = next(r for r in out if "développeur" in r["poste"].lower() or "developpeur" in r["poste"].lower())
    assert req["effectif_min"] == 3


def test_experience_not_confused_with_headcount():
    # « 10 ans » ne doit pas devenir un effectif
    text = "Un Consultant senior, 10 ans d'expérience."
    out = extract_personnel_cle_struct(text)
    req = next(r for r in out if r["poste"] == "Consultant")
    assert req["effectif_min"] == 1
    assert req["experience_min_annees"] == 10


def test_multiple_roles():
    text = (
        "Le personnel clé comprend : Un (01) Chef de projet certifié PMP, Master, 10 ans ; "
        "Deux (02) Développeurs, Licence, 3 ans d'expérience ; "
        "Un (01) Expert sécurité certifié CISSP ou CEH, Master, 7 ans."
    )
    out = extract_personnel_cle_struct(text)
    postes = {r["poste"] for r in out}
    assert len(out) == 3
    assert any("Chef de projet" == p for p in postes)
    dev = next(r for r in out if "veloppeur" in r["poste"])
    assert dev["effectif_min"] == 2
    sec = next(r for r in out if "sécurité" in r["poste"].lower() or "securite" in r["poste"].lower())
    assert ["CISSP", "CEH"] in sec["certifications"]


def test_backward_compatible_keys():
    # Les clés historiques restent présentes (consommées ailleurs)
    text = "Un Chef de projet, Master, 5 ans."
    out = extract_personnel_cle_struct(text)
    req = out[0]
    for key in ("poste", "experience_min_annees", "diplome", "snippet"):
        assert key in req
