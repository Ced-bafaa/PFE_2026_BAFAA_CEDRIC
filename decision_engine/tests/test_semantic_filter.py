# -*- coding: utf-8 -*-
"""
Tests du filtre de pertinence HYBRIDE (semantic_filter).

Couche mots-clés (P1/P2) : testée SANS modèle (enabled=False) -> tourne partout.
Couche sémantique (P3) : nécessite le modèle -> ignorée si indisponible.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from semantic_filter import (  # noqa: E402
    SemanticRelevanceFilter,
    clean_title,
    _na,
    _kw_hit,
    WHITELIST_IT,
    BLACKLIST_NON_IT,
)

# Instance sans modèle : seule la couche mots-clés est active.
KW = SemanticRelevanceFilter(enabled=False)

IT_KW = [
    "Acquisition de matériel informatique : ordinateurs et imprimantes",
    "Fourniture de licences de logiciels bureautiques",
    "Audit de cybersécurité du système d'information",
    "Extension du réseau informatique local (LAN)",
    "Mise en place d'une solution de dématérialisation des procédures",
    "Acquisition de serveurs et équipements de datacenter",
]
NON_IT_KW = [
    "Travaux de construction d'un bâtiment administratif",
    "Forage et adduction d'eau potable de Maroua",
    "Réhabilitation du réseau routier urbain de Garoua",
    "Acquisition de mobilier de bureau",
    "Gardiennage des locaux administratifs",
    "Acquisition de petit matériel et outillage agricole",
    "Acquisition de matériel roulant : véhicules pick-up",
    "Fourniture de produits pharmaceutiques et consommables hospitaliers",
]


@pytest.mark.parametrize("o", IT_KW)
def test_whitelist_it(o):
    r = KW.classify(o)
    assert r["label"] == "IT" and r["pertinent"] and "mot-clé" in r["raison"], (o, r)


@pytest.mark.parametrize("o", NON_IT_KW)
def test_blacklist_non_it(o):
    r = KW.classify(o)
    assert r["label"] == "non-IT" and not r["pertinent"] and "mot-clé" in r["raison"], (o, r)


def test_keyword_rescue_titre_verbeux():
    # Cas vedette : titre ARMP verbeux où le sémantique seul échouait (-0.13).
    # Le mot-clé « informatique » le rattrape.
    o = ("AVIS D'APPEL D'OFFRES NATIONAL OUVERT N°0090 DU 15 JUIN 2026 POUR "
         "L'ACQUISITION DU MATERIEL INFORMATIQUE ET BUREAUTIQUE AU MINISTERE "
         "DE L'HABITAT ET DU DEVELOPPEMENT URBAIN")
    assert KW.classify(o)["label"] == "IT"


def test_pas_de_faux_positif_solaire():
    # AO d'énergie solaire : whitelist curée ne le prend pas, blacklist l'écarte.
    o = "TRAVAUX D'AUTONOMISATION EN ENERGIE ELECTRIQUE PAR SYSTEME SOLAIRE NUMERIQUE"
    assert KW.classify(o)["label"] == "non-IT"


def test_degradation_sans_modele():
    r = KW.classify("Communiqué relatif à une réunion d'information")
    assert r["available"] is False and r["label"] == "inconnu" and r["pertinent"] is True


def test_clean_title():
    raw = ("AVIS D'APPEL D'OFFRES NATIONAL OUVERT N°004/AONO/MINEDUB DU 09 JUIN 2026 "
           "POUR L'EXTENSION DU RESEAU INFORMATIQUE DANS LES SERVICES CENTRAUX "
           "FINANCEMENT : BIP 2026")
    c = clean_title(raw).upper()
    assert "RESEAU INFORMATIQUE" in c and "FINANCEMENT" not in c and "AVIS" not in c


def test_clean_title_deglue_mots_soudes():
    # Marqueurs soudés par l'extraction PDF : « 2026POUR », « YAOUNDEFINANCEMENT ».
    raw = ("APPEL D'OFFRES OUVERTN° 08/ADC DU 17/06/2026POUR LA FOURNITURE DU MATERIEL "
           "INFORMATIQUE A LA SOCIETE AEROPORTS DU CAMEROUNFINANCEMENT : BIP 2026")
    c = clean_title(raw).upper()
    assert "MATERIEL INFORMATIQUE" in c and "FINANCEMENT" not in c


def test_additif_travaux_rejete_sur_objet():
    # Faux positif réel (20/06/2026) : un ADDITIF « travaux de route » était retenu IT
    # car on classait le titre brut (qui contient « plateforme COLEPS »). En classant
    # l'OBJET extrait, la blacklist « travaux » l'écarte correctement.
    raw = ("ADDITIF N° 009/AD/CUG/SG/DUM/2026 portant rectificatif du Dossier d'Appel "
           "d'Offres National Ouvert N°06/AONO/CUG DU 21/05/2026 POUR LES TRAVAUX "
           "D'AMENAGEMENT EN PAVE DE LA ROUTE FIN GOUDRON DJABBEL En procedure d'urgence "
           "Au point 12. Remise des offres transmise sur la plateforme COLEPS sur cle USB")
    r = KW.classify(raw)
    assert r["label"] == "non-IT" and not r["pertinent"], r
    assert "travaux" in clean_title(raw).lower()


def test_objet_nettoye_expose():
    r = KW.classify("AVIS POUR L'ACQUISITION DE LOGICIELS FINANCEMENT BIP 2026")
    assert r.get("objet_nettoye") and "FINANCEMENT" not in r["objet_nettoye"].upper()


# ── Couche sémantique (modèle requis) ──
@pytest.fixture(scope="module")
def filt():
    pytest.importorskip("sentence_transformers")
    f = SemanticRelevanceFilter(enabled=True)
    if not f.is_available:
        pytest.skip("modèle d'embeddings indisponible")
    return f


def test_semantique_sur_ambigu(filt):
    # Paraphrase IT sans mot-clé whitelist -> passe au sémantique.
    r = filt.classify("mise en place d'une plateforme de gestion en ligne du courrier")
    assert r["raison"] == "sémantique" and r["diff"] is not None


# ── Normalisation des apostrophes (_na) — bug réel corrigé ──
def test_na_apostrophe_courbe_devient_droite():
    # Les titres ARMP utilisent l'apostrophe courbe ’ ; la whitelist attend '.
    assert _na("système d’information") == "systeme d'information"


@pytest.mark.parametrize("apo", ["’", "‘", "ʼ", "`", "´"])
def test_na_toutes_variantes_apostrophe(apo):
    assert _na(f"d{apo}information") == "d'information"


def test_systeme_information_apostrophe_courbe_non_regression():
    # Sans _na, « système d’information » (apostrophe courbe) n'était jamais capté.
    assert KW.classify("Refonte du système d’information ministériel")["label"] == "IT"


def test_kw_hit_normalise_accents_et_apostrophe():
    assert _kw_hit("Système d’Information", WHITELIST_IT) == "systeme d'information"


# ── Précédence du pipeline : P1 (IT) consulté avant P2 (non-IT) ──
def test_precedence_it_gagne_sur_objet_hybride():
    # Matériel informatique (IT, P1) + mobilier de bureau (non-IT, P2) :
    # P1 étant évalué en premier, l'objet est classé IT.
    r = KW.classify("Acquisition de matériel informatique et de mobilier de bureau")
    assert r["label"] == "IT", r


def test_objet_ambigu_delegue_au_semantique():
    # « travaux » / « régie » dans AUCUNE liste : sans P1 ni P2, l'objet part en P3.
    # Modèle désactivé -> label « inconnu » mais conservé (jamais rejeté par défaut).
    r = KW.classify("Travaux divers en régie")
    assert r["label"] == "inconnu" and r["pertinent"] is True and r["available"] is False


# ── Invariants de conception des listes de mots-clés ──
def test_blacklist_sans_verbe_ambigu():
    # La blacklist ne contient que des NOMS de domaine, jamais de verbes d'action
    # ambigus (présents aussi en IT : « travaux de câblage réseau »).
    interdits = {"travaux", "amenagement", "construction", "rehabilit",
                 "refection", "entretien"}
    assert interdits.isdisjoint(set(BLACKLIST_NON_IT))


def test_whitelist_sans_termes_trop_larges():
    # « numérique »/« digital » SEULS retirés (faux positif énergie solaire « numérique »).
    assert "numerique" not in WHITELIST_IT and "digital" not in WHITELIST_IT


# ── Recommandation de personnel (repli recouvrement, sans modèle) ──
ROSTER = [
    {"name": "Patrick NDONGO", "role": "Ingénieur déploiement matériel",
     "skills": ["matériel informatique", "serveurs", "câblage réseau"]},
    {"name": "Diane FOUDA", "role": "Développeuse full-stack",
     "skills": ["application web", "mobile", "API"]},
]


def test_reco_respecte_top_n():
    out = KW.recommend_experts("matériel informatique", ROSTER, top_n=1)
    assert len(out) == 1


def test_reco_structure_resultat():
    out = KW.recommend_experts("matériel informatique et serveurs", ROSTER)
    assert out
    for champ in ("name", "role", "fit", "fit_brut", "base", "competences_match"):
        assert champ in out[0]


def test_reco_roster_vide():
    assert KW.recommend_experts("matériel informatique", []) == []
