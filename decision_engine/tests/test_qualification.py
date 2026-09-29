# -*- coding: utf-8 -*-
"""
Tests du moteur de qualification déterministe du personnel (core_logic).

Règle métier : pour chaque rôle exigé par le DAO, un expert est qualifié
si et seulement s'il satisfait TOUS les critères du rôle (ET strict).
Les alternatives (« PMP ou Prince2 ») forment un OU à l'intérieur d'un critère.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from core_logic import (  # noqa: E402
    degree_rank,
    extract_personnel_requirements,
    qualify_personnel,
)


# ── Profils de test ────────────────────────────────────────────────────────────

def make_company(**over):
    company = {
        "personnel": [
            {
                "name": "Christelle MBARGA",
                "role": "Cheffe de projet senior",
                "years_experience": 11,
                "certifications": ["PMP", "Prince2 Practitioner"],
                "diplomas": [{"degree": "Master", "field": "Management de projet", "years_experience": 11}],
            },
            {
                "name": "Diane FOUDA",
                "role": "Développeuse Full Stack",
                "years_experience": 6,
                "certifications": ["Oracle Java SE 11 Developer"],
                "diplomas": [{"degree": "Licence", "field": "Informatique", "years_experience": 6}],
            },
            {
                "name": "Rodrigue ATANGANA",
                "role": "Expert Cybersécurité",
                "years_experience": 8,
                "certifications": ["CEH", "ISO 27001 Lead Auditor"],
                "diplomas": [{"degree": "Master", "field": "SSI", "years_experience": 8}],
            },
        ],
        "past_projects": [
            {
                "title": "Audit sécurité bancaire",
                "domains": ["Cybersécurité"],
                "personnel_names": ["Rodrigue ATANGANA"],
            },
            {
                "title": "Plateforme e-administration",
                "domains": ["E-administration", "Développement logiciel"],
                "personnel_names": ["Diane FOUDA", "Christelle MBARGA"],
            },
        ],
    }
    company.update(over)
    return company


# ── Hiérarchie des diplômes ────────────────────────────────────────────────────

def test_degree_rank_hierarchy():
    assert degree_rank("Doctorat") > degree_rank("Master")
    assert degree_rank("Master") > degree_rank("Licence")
    assert degree_rank("Ingénieur") == degree_rank("Master")  # bac+5 équivalents
    assert degree_rank("Licence") > degree_rank("BTS")
    assert degree_rank("") == 0
    assert degree_rank("inconnu") == 0

def test_degree_rank_bac_plus_and_accents():
    assert degree_rank("Bac+5") == degree_rank("master")
    assert degree_rank("BAC + 3") == degree_rank("licence")
    assert degree_rank("ingenieur") == degree_rank("Ingénieur")  # accents ignorés


# ── Cas sans exigences ─────────────────────────────────────────────────────────

def test_no_requirements_not_applicable():
    res = qualify_personnel([], make_company())
    assert res["applicable"] is False
    assert res["required_count"] == 0
    assert res["coverage"] is None

def test_requirements_without_poste_ignored():
    res = qualify_personnel([{"poste": "", "experience_min_annees": 5}], make_company())
    assert res["applicable"] is False


# ── Qualification nominale (ET strict) ─────────────────────────────────────────

def test_simple_match_role_exp_diploma():
    reqs = [{"poste": "Chef de projet", "experience_min_annees": 5, "diplome": "Master"}]
    res = qualify_personnel(reqs, make_company())
    assert res["applicable"] is True
    assert res["required_count"] == 1
    assert res["covered_count"] == 1
    assert res["coverage"] == 1.0
    role = res["roles"][0]
    assert role["covered"] is True
    assert "Christelle MBARGA" in role["qualified_experts"]

def test_and_strict_diploma_fails():
    # Diane a l'expérience (6 ≥ 5) mais Licence < Master exigé
    reqs = [{"poste": "Développeur", "experience_min_annees": 5, "diplome": "Master"}]
    res = qualify_personnel(reqs, make_company())
    role = res["roles"][0]
    assert role["covered"] is False
    diane = next(c for c in role["candidates"] if c["name"] == "Diane FOUDA")
    assert diane["qualified"] is False
    assert any("dipl" in m.lower() for m in diane["missing"])

def test_and_strict_experience_fails():
    reqs = [{"poste": "Développeur", "experience_min_annees": 10, "diplome": "Licence"}]
    res = qualify_personnel(reqs, make_company())
    role = res["roles"][0]
    assert role["covered"] is False
    diane = next(c for c in role["candidates"] if c["name"] == "Diane FOUDA")
    assert any("exp" in m.lower() for m in diane["missing"])

def test_role_mismatch_blocks():
    # Aucun expert réseau dans l'équipe : rôle non couvert même si exp/diplôme passent
    reqs = [{"poste": "Administrateur réseau", "experience_min_annees": 2, "diplome": "Licence"}]
    res = qualify_personnel(reqs, make_company())
    assert res["roles"][0]["covered"] is False

def test_role_match_tolerant_to_gender_and_case():
    # « Développeur » doit matcher « Développeuse Full Stack »
    reqs = [{"poste": "développeur", "experience_min_annees": 3, "diplome": "Licence"}]
    res = qualify_personnel(reqs, make_company())
    role = res["roles"][0]
    assert role["covered"] is True
    assert "Diane FOUDA" in role["qualified_experts"]


# ── Certifications : ET entre groupes, OU dans un groupe ──────────────────────

def test_certification_group_or_satisfied():
    reqs = [{
        "poste": "Chef de projet",
        "certifications": [["PMP", "Prince2"]],
    }]
    res = qualify_personnel(reqs, make_company())
    assert res["roles"][0]["covered"] is True

def test_certification_missing():
    reqs = [{
        "poste": "Développeur",
        "certifications": [["AWS Solutions Architect"]],
    }]
    res = qualify_personnel(reqs, make_company())
    role = res["roles"][0]
    diane = next(c for c in role["candidates"] if c["name"] == "Diane FOUDA")
    assert diane["qualified"] is False
    assert any("certification" in m.lower() for m in diane["missing"])

def test_certification_partial_match_inside_label():
    # L'expert a « Prince2 Practitioner » : l'exigence « Prince2 » doit matcher
    reqs = [{"poste": "Chef de projet", "certifications": [["Prince2"]]}]
    res = qualify_personnel(reqs, make_company())
    assert res["roles"][0]["covered"] is True


# ── Domaine prouvé par les projets rattachés ───────────────────────────────────

def test_domain_proven_by_projects():
    reqs = [{"poste": "Expert sécurité", "domaines": ["Cybersécurité"]}]
    res = qualify_personnel(reqs, make_company())
    role = res["roles"][0]
    assert role["covered"] is True
    assert "Rodrigue ATANGANA" in role["qualified_experts"]

def test_domain_not_proven():
    # Rodrigue n'a aucun projet e-administration rattaché
    reqs = [{"poste": "Expert sécurité", "domaines": ["E-administration"]}]
    res = qualify_personnel(reqs, make_company())
    role = res["roles"][0]
    rod = next(c for c in role["candidates"] if c["name"] == "Rodrigue ATANGANA")
    assert rod["qualified"] is False
    assert any("domaine" in m.lower() for m in rod["missing"])


# ── Dédoublonnage des exigences (l'extracteur émet une entrée par occurrence) ──

def test_requirements_deduplicated_keep_strictest():
    reqs = [
        {"poste": "Chef de projet", "experience_min_annees": 3, "diplome": "Licence"},
        {"poste": "chef de projet", "experience_min_annees": 8, "diplome": "Master"},
    ]
    res = qualify_personnel(reqs, make_company())
    assert res["required_count"] == 1
    exigences = res["roles"][0]["exigences"]
    assert exigences["experience_min_annees"] == 8
    assert exigences["diplome_min"].lower() == "master"


# ── Expérience déduite des diplômes si non déclarée ────────────────────────────

def test_experience_fallback_from_diplomas():
    company = make_company()
    chef = company["personnel"][0]
    chef.pop("years_experience")  # plus de valeur déclarée, diplôme = 11 ans
    reqs = [{"poste": "Chef de projet", "experience_min_annees": 10}]
    res = qualify_personnel(reqs, company)
    assert res["roles"][0]["covered"] is True


# ── Couverture partielle ───────────────────────────────────────────────────────

def test_partial_coverage():
    reqs = [
        {"poste": "Chef de projet", "experience_min_annees": 5},
        {"poste": "Administrateur réseau", "experience_min_annees": 2},
    ]
    res = qualify_personnel(reqs, make_company())
    assert res["required_count"] == 2
    assert res["covered_count"] == 1
    assert res["coverage"] == 0.5


# ── Extraction des exigences depuis le JSON du DAO ─────────────────────────────

def test_extract_requirements_top_level():
    dao = {"personnel_cle_struct": [{"poste": "Chef de projet"}]}
    assert extract_personnel_requirements(dao) == [{"poste": "Chef de projet"}]

def test_extract_requirements_nested_technique():
    dao = {"technique": {"personnel_cle_struct": [{"poste": "DBA"}]}}
    assert extract_personnel_requirements(dao)[0]["poste"] == "DBA"

def test_extract_requirements_absent():
    assert extract_personnel_requirements({}) == []
    assert extract_personnel_requirements({"personnel_cle_struct": "texte brut"}) == []


# ── Évaluateur d'éligibilité unifié (financier + personnel, même format) ──────

from core_logic import evaluate_eligibility  # noqa: E402


def make_dao(**over):
    dao = {
        "administratif": {"reference": "DAO-TEST-001"},
        "financier": {},
        "technique": {},
    }
    dao.update(over)
    return dao


def company_finances(**over):
    c = make_company()
    c.update({"annual_revenue": 850_000_000, "credit_line": 200_000_000, "available_cash": 120_000_000})
    c.update(over)
    return c


def test_eligibility_not_applicable_without_explicit_requirements():
    res = evaluate_eligibility(make_dao(), company_finances())
    assert res["applicable"] is False
    assert res["eligible"] is None
    assert res["criteres"] == []


def test_eligibility_ca_min_pass_and_fail():
    dao = make_dao(technique={"hard_filters": {"chiffre_affaires_min": [{"valeur": 500_000_000}]}})
    res = evaluate_eligibility(dao, company_finances())
    assert res["applicable"] is True
    assert res["eligible"] is True
    ca = next(c for c in res["criteres"] if c["id"] == "ca_min")
    assert ca["satisfait"] is True and ca["categorie"] == "financier"

    dao2 = make_dao(technique={"hard_filters": {"chiffre_affaires_min": [{"valeur": 2_000_000_000}]}})
    res2 = evaluate_eligibility(dao2, company_finances())
    assert res2["eligible"] is False
    assert "ca_min" in res2["non_satisfaits"]


def test_eligibility_credit_min():
    dao = make_dao(technique={"hard_filters": {"ligne_credit_min": [{"valeur": 300_000_000}]}})
    res = evaluate_eligibility(dao, company_finances())
    assert "credit_min" in res["non_satisfaits"]  # 200M < 300M


def test_eligibility_caution_explicit_only():
    # Caution explicite : opposable (capacité = trésorerie + ligne de crédit)
    dao = make_dao(financier={"caution": 250_000_000})
    res = evaluate_eligibility(dao, company_finances())
    cau = next(c for c in res["criteres"] if c["id"] == "caution")
    assert cau["satisfait"] is True  # 120M + 200M = 320M ≥ 250M

    dao2 = make_dao(financier={"caution": 400_000_000})
    res2 = evaluate_eligibility(dao2, company_finances())
    assert "caution" in res2["non_satisfaits"]


def test_eligibility_estimated_caution_not_opposable():
    # Budget présent mais aucune caution explicite : pas de critère caution
    dao = make_dao(financier={"budget_estime": 100_000_000})
    res = evaluate_eligibility(dao, company_finances())
    assert not any(c["id"] == "caution" for c in res["criteres"])


def test_eligibility_includes_personnel_criterion():
    dao = make_dao()
    dao["personnel_cle_struct"] = [
        {"poste": "Chef de projet", "experience_min_annees": 5, "diplome": "Master"},
        {"poste": "Administrateur réseau", "experience_min_annees": 2},
    ]
    res = evaluate_eligibility(dao, company_finances())
    perso = next(c for c in res["criteres"] if c["id"] == "personnel")
    assert perso["satisfait"] is False  # 1 rôle sur 2 couvert
    assert res["eligible"] is False
    assert res["personnel"]["coverage"] == 0.5


def test_eligibility_combined_all_pass():
    dao = make_dao(
        financier={"caution": 50_000_000},
        technique={"hard_filters": {"chiffre_affaires_min": [{"valeur": 400_000_000}]}},
    )
    dao["personnel_cle_struct"] = [{"poste": "Chef de projet", "experience_min_annees": 5}]
    res = evaluate_eligibility(dao, company_finances())
    assert res["eligible"] is True
    assert res["non_satisfaits"] == []
    assert {c["categorie"] for c in res["criteres"]} == {"financier", "personnel"}
