# -*- coding: utf-8 -*-
"""
Tests du scoring décisionnel MCDA (mcda_scorer).

Objectif : verrouiller les propriétés du moteur de décision multicritère qui
remplace l'ancien XGBoost dégénéré (96/go pour tout) — voir
KIAMA_Conception_refonte_scoring. On vérifie :

  - les fonctions de valeur de chaque critère (C1..C5) ;
  - les poids AHP (somme = 1) ;
  - la barrière d'éligibilité (go/no-go prioritaire sur le score) ;
  - le mapping score → verdict (seuils 70 / 50) ;
  - le GARDE-FOU « valeur du marché » : un petit marché n'est JAMAIS handicapé.

La plupart des tests tournent SANS modèle d'embeddings : avec sem_filter=None,
le critère technique (C1) vaut un neutre 0.5, rendant le score déterministe.
Un test optionnel (skip si modèle absent) vérifie la discrimination technique
IT vs non-IT.

Lancement :  pytest decision_engine/tests/test_mcda_scorer.py -v
"""
import datetime as dt
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from mcda_scorer import (  # noqa: E402
    score_mcda,
    days_until,
    _v_capacite,
    _v_valeur,
    _v_delai,
    _v_financement,
    W,
    SEUIL_GO,
    SEUIL_ETUDE,
)

CP = {"description": "Entreprise de développement logiciel et systèmes d'information"}


def _future(days: int) -> str:
    return (dt.date.today() + dt.timedelta(days=days)).strftime("%d-%m-%Y")


def _base(**over):
    """Dossier de référence (sans modèle → C1 neutre). Surchargeable par mot-clé."""
    kw = dict(
        objet="Objet quelconque",
        budget=None,
        ratio_ca=None,
        ratio_credit=None,
        deadline=None,
        financement=None,
        company_profile=CP,
        sem_filter=None,
    )
    kw.update(over)
    return kw


# ─── 1. Poids AHP ───────────────────────────────────────────────────────────────
def test_poids_somment_a_un():
    assert abs(sum(W.values()) - 1.0) < 1e-6


def test_technique_est_le_poids_dominant():
    # L'adéquation au profil doit primer (cœur de la stratégie KIAMA).
    assert max(W, key=W.get) == "technique"


def test_valeur_marche_a_un_poids_faible():
    # Garde-fou de conception : la valeur du marché pèse peu (<= 7 %) pour ne
    # jamais handicaper un petit marché, et reste très en deçà du technique.
    assert W["valeur"] <= 0.07
    assert W["valeur"] < W["technique"]


# ─── 2. Fonctions de valeur des critères ────────────────────────────────────────
class TestCapacite:
    def test_inconnu_neutre(self):
        assert _v_capacite(None, None) == 0.5
        assert _v_capacite(0, None) == 0.5

    def test_confortable_plafonne_a_un(self):
        assert _v_capacite(3.0, None) == 1.0
        assert _v_capacite(10.0, None) == 1.0

    def test_proportionnel_en_dessous_du_seuil(self):
        assert _v_capacite(1.5, None) == 0.5


class TestDelai:
    def test_inconnu_neutre(self):
        assert _v_delai(None) == 0.5

    def test_cloture_est_zero(self):
        assert _v_delai(-1) == 0.0

    def test_trente_jours_est_ideal(self):
        assert _v_delai(30) == 1.0
        assert _v_delai(45) == 1.0

    def test_proportionnel(self):
        assert _v_delai(15) == 0.5


class TestFinancement:
    @pytest.mark.parametrize("txt", ["BIP 2026", "Budget d'investissement public",
                                     "Financement Banque Mondiale", "AFD", "C2D"])
    def test_sources_fiables(self, txt):
        assert _v_financement(txt) == 1.0

    def test_budget_simple(self):
        assert _v_financement("Budget national") == 0.7

    def test_inconnu_plancher(self):
        assert _v_financement("") == 0.6
        assert _v_financement(None) == 0.6


class TestDaysUntil:
    def test_formats_multiples(self):
        assert days_until("2020-01-01") < 0          # aaaa-mm-jj passé
        assert days_until("01-01-2020") < 0          # jj-mm-aaaa passé
        assert days_until(_future(10)) in (9, 10, 11)
        assert days_until(None) is None
        assert days_until("date illisible") is None


# ─── 3. GARDE-FOU : la valeur du marché ne handicape JAMAIS ──────────────────────
class TestGardeFouValeurMarche:
    def test_plancher_haut_pour_tout_budget_positif(self):
        # Quel que soit le budget, la valeur reste >= 0.85 (jamais pénalisante).
        for b in [1, 500_000, 1_000_000, 50_000_000, 300_000_000, 900_000_000]:
            assert _v_valeur(b) >= 0.85

    def test_budget_inconnu_reste_haut(self):
        assert _v_valeur(None) == 0.9
        assert _v_valeur(0) == 0.9

    def test_monotone_non_decroissante(self):
        vals = [_v_valeur(b) for b in [1_000_000, 10_000_000, 100_000_000, 300_000_000]]
        assert vals == sorted(vals)

    def test_petit_marche_a_peine_penalise_sur_le_score(self):
        # Deux dossiers identiques sauf le budget (1 M vs 500 M).
        commun = dict(ratio_ca=3.0, deadline=_future(40), financement="BIP 2026")
        petit = score_mcda(**_base(budget=1_000_000, **commun))
        gros = score_mcda(**_base(budget=500_000_000, **commun))
        # L'écart total imputable à la valeur du marché est plafonné (~1 point).
        assert abs(gros["score"] - petit["score"]) <= 1.2
        # Et le petit marché reste un GO : il n'est pas dégradé par sa taille.
        assert petit["verdict"].startswith("GO")


# ─── 4. Barrière d'éligibilité (prioritaire sur le score) ───────────────────────
class TestEligibilite:
    def test_ineligible_force_no_go_malgre_bon_score(self):
        r = score_mcda(**_base(
            budget=500_000_000, ratio_ca=5.0, deadline=_future(40),
            financement="BIP 2026", eligible=False))
        assert r["prediction"] == 0
        assert r["recommandation"] == "écarter"
        assert "NO-GO" in r["verdict"]
        assert r["eligible"] is False

    def test_blocking_force_no_go(self):
        r = score_mcda(**_base(
            budget=500_000_000, ratio_ca=5.0, deadline=_future(40),
            financement="BIP 2026", eligible=True, blocking=True))
        assert r["prediction"] == 0 and r["eligible"] is False


# ─── 5. Mapping score → verdict (seuils 70 / 50) ────────────────────────────────
class TestVerdicts:
    def test_dossier_conforme_donne_go(self):
        r = score_mcda(**_base(
            budget=500_000_000, ratio_ca=3.0, deadline=_future(40), financement="BIP 2026"))
        assert r["score"] >= SEUIL_GO
        assert r["verdict"].startswith("GO") and r["prediction"] == 1

    def test_dossier_moyen_donne_a_etudier(self):
        r = score_mcda(**_base(
            budget=1_000_000, ratio_ca=1.5, deadline=_future(15), financement="Budget national"))
        assert SEUIL_ETUDE <= r["score"] < SEUIL_GO
        assert r["verdict"] == "À ÉTUDIER" and r["prediction"] == 1

    def test_dossier_faible_donne_no_go(self):
        r = score_mcda(**_base(
            budget=None, ratio_ca=0.3, deadline="01-01-2020", financement=""))
        assert r["score"] < SEUIL_ETUDE
        assert "NO-GO" in r["verdict"] and r["prediction"] == 0


# ─── 6. Structure du résultat ───────────────────────────────────────────────────
class TestStructure:
    def test_cles_principales(self):
        r = score_mcda(**_base(budget=10_000_000, ratio_ca=2.0, deadline=_future(20)))
        for k in ("score", "prediction", "verdict", "recommandation", "eligible", "criteres"):
            assert k in r

    def test_cinq_criteres_avec_poids(self):
        r = score_mcda(**_base(budget=10_000_000, ratio_ca=2.0, deadline=_future(20)))
        crit = r["criteres"]
        attendus = {"adequation_technique", "capacite_financiere", "valeur_marche",
                    "faisabilite_delai", "fiabilite_financement"}
        assert set(crit) == attendus
        for c in crit.values():
            assert "valeur" in c and "poids" in c
            assert 0.0 <= c["valeur"] <= 1.0

    def test_score_borne_0_100(self):
        r = score_mcda(**_base(budget=500_000_000, ratio_ca=9.0,
                               deadline=_future(60), financement="BIP"))
        assert 0.0 <= r["score"] <= 100.0


# ─── 7. Discrimination technique IT vs non-IT (optionnel — modèle requis) ────────
@pytest.fixture(scope="module")
def sem_filter():
    pytest.importorskip("sentence_transformers")
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
    from semantic_filter import SemanticRelevanceFilter
    f = SemanticRelevanceFilter(enabled=True)
    if not f.is_available:
        pytest.skip("modèle d'embeddings indisponible")
    return f


def test_technique_it_superieure_a_non_it(sem_filter):
    cp = {"description": "Développement logiciel, systèmes d'information, "
                         "infrastructure et réseaux informatiques"}
    it = score_mcda(**_base(objet="Développement d'une application web de gestion",
                            company_profile=cp, sem_filter=sem_filter))
    non_it = score_mcda(**_base(objet="Construction d'une route en pavé",
                                company_profile=cp, sem_filter=sem_filter))
    vit = it["criteres"]["adequation_technique"]["valeur"]
    vnon = non_it["criteres"]["adequation_technique"]["valeur"]
    assert vit > vnon, f"technique IT ({vit}) devrait dépasser non-IT ({vnon})"


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
