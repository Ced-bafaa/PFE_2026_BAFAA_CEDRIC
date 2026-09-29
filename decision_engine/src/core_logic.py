"""
Logique partagée entre entraînement et inférence.
Toute transformation de features passe par DAOProcessor.
"""

from __future__ import annotations

import re
from typing import Any

import unicodedata

import pandas as pd

from amount_utils import clean_amount

# Ordre strict utilisé pour l'entraînement et la prédiction
FEATURE_COLUMNS = ["ratio_ca", "ratio_credit", "poids_caution", "score_tech"]

DEFAULT_BUDGET_FCFA = 20_000_000
CAUTION_RATE_ESTIMATE = 0.02


class DAOProcessor:
    """Normalise un DAO (OCR simplifié ou ao_extractor) et calcule les features."""

    def normalize_ref(self, ref: str | None) -> str:
        if not ref or ref == "INCONNU":
            return "INCONNU"
        ref = str(ref).strip()
        if len(ref) <= 80:
            return ref
        m = re.search(r"N[°ºo]\s*[\w./\-]+", ref, re.IGNORECASE)
        if m:
            return m.group(0)[:80]
        first_line = ref.split("\n")[0].strip()
        return (first_line[:80] if first_line else ref[:80])

    def _coerce_amount(self, value: Any, *, pick: str = "first") -> int:
        if value is None:
            return 0
        if isinstance(value, (int, float)):
            return int(value) if value > 0 else 0
        if isinstance(value, str):
            return clean_amount(value, prefer_currency=True, pick=pick)
        if isinstance(value, dict):
            v = value.get("valeur") or value.get("value") or 0
            if v and int(v) > 0:
                return int(v)
            text = value.get("text") or value.get("raw") or ""
            if text:
                return clean_amount(text, prefer_currency=True, pick=pick)
        return 0

    def normalize_dao(self, dao_data: dict) -> dict:
        dao = dict(dao_data or {})
        adm = dict(dao.get("administratif") or {})
        fin = dict(dao.get("financier") or {})
        tech = dict(dao.get("technique") or {})

        budget = (
            self._coerce_amount(fin.get("budget_estime"), pick="max")
            or self._coerce_amount(fin.get("budget"), pick="max")
            or self._coerce_amount(fin.get("budget_global"), pick="max")
        )
        caution = (
            self._coerce_amount(fin.get("caution"), pick="min")
            or self._coerce_amount(fin.get("caution_solvabilite"), pick="min")
            or self._coerce_amount(fin.get("caution_global"), pick="min")
        )

        fin["budget_estime"] = budget
        fin["caution"] = caution
        if budget > 0 and "budget_global" not in fin:
            fin["budget_global"] = {"valeur": budget, "text": ""}
        if caution > 0 and "caution_global" not in fin:
            fin["caution_global"] = {"valeur": caution, "text": ""}

        dao["administratif"] = adm
        dao["financier"] = fin
        dao["technique"] = tech
        return dao

    def extract_budget(self, financier: dict) -> int:
        fin = financier or {}
        budget = (
            self._coerce_amount(fin.get("budget_estime"), pick="max")
            or self._coerce_amount(fin.get("budget"), pick="max")
            or self._coerce_amount(fin.get("budget_global"), pick="max")
        )
        if budget > 0:
            return budget

        lots = fin.get("lots") or []
        lot_budgets = []
        for lot in lots:
            val = int(lot.get("budget") or 0)
            block = (lot.get("lot_text_block") or "").lower()
            if not (1_000_000 <= val <= 500_000_000):
                continue
            if any(x in block for x in ("scife", "capital de", "r.c", "nui ")):
                continue
            lot_budgets.append(val)
        if lot_budgets:
            return max(lot_budgets)

        return DEFAULT_BUDGET_FCFA

    def extract_caution(self, financier: dict, budget: int) -> int:
        fin = financier or {}
        caution = (
            self._coerce_amount(fin.get("caution"), pick="min")
            or self._coerce_amount(fin.get("caution_solvabilite"), pick="min")
            or self._coerce_amount(fin.get("caution_global"), pick="min")
        )
        if caution > 0:
            return caution

        lots = fin.get("lots") or []
        lot_cautions = [int(l.get("caution") or 0) for l in lots if int(l.get("caution") or 0) > 0]
        if budget > 0:
            lot_cautions = [c for c in lot_cautions if c <= int(budget * 0.15)]
        if lot_cautions:
            return min(lot_cautions)

        if budget > 0:
            return int(budget * CAUTION_RATE_ESTIMATE)
        return 0

    def build_tech_corpus(self, dao_data: dict) -> str:
        adm = dao_data.get("administratif") or {}
        fin = dao_data.get("financier") or {}
        tech = dao_data.get("technique") or {}

        parts = [
            adm.get("objet", ""),
            adm.get("maitre_ouvrage", ""),
            (fin.get("budget_global") or {}).get("text", "") if isinstance(fin.get("budget_global"), dict) else "",
            (fin.get("caution_global") or {}).get("text", "") if isinstance(fin.get("caution_global"), dict) else "",
        ]
        parts.extend(tech.get("tech_stack_keywords") or [])

        for sec in (adm.get("sections") or {}).values():
            if isinstance(sec, dict) and sec.get("text"):
                parts.append(sec["text"][:2000])

        return " ".join(str(p) for p in parts if p).lower()

    @staticmethod
    def _extract_keywords_from_profile(company_profile: dict) -> list[str]:
        """
        Dérive une liste exhaustive de mots-clés depuis le profil enrichi :
          - competencies[].keywords
          - past_projects[].technologies + past_projects[].domains
          - personnel[].skills
          - domaines
          - past_projects_keywords (rétrocompatibilité)
        """
        kws: set[str] = set()

        # Ancienne liste (rétrocompatibilité)
        for kw in company_profile.get("past_projects_keywords") or []:
            kws.add(str(kw).lower().strip())

        # Compétences par domaine
        for comp in company_profile.get("competencies") or []:
            for kw in comp.get("keywords") or []:
                kws.add(str(kw).lower().strip())
            domain = comp.get("domain", "")
            if domain:
                kws.add(domain.lower().strip())

        # Projets passés
        for proj in company_profile.get("past_projects") or []:
            for tech in proj.get("technologies") or []:
                kws.add(str(tech).lower().strip())
            for dom in proj.get("domains") or []:
                kws.add(str(dom).lower().strip())

        # Personnel : compétences individuelles
        for member in company_profile.get("personnel") or []:
            for skill in member.get("skills") or []:
                kws.add(str(skill).lower().strip())

        # Domaines généraux
        for domain in company_profile.get("domaines") or []:
            kws.add(str(domain).lower().strip())

        return [k for k in kws if k]

    def compute_tech_score(self, corpus: str, keywords: list[str]) -> float:
        if not keywords:
            return 0.0
        matches = [kw for kw in keywords if kw.lower() in corpus]
        score = len(matches) / len(keywords)
        if score == 0:
            it_hints = ("informatique", "logiciel", "donnees", "data", "web", "cloud")
            if any(h in corpus for h in it_hints):
                score = min(0.33, 1 / len(keywords))
        return round(score, 2)

    def compute_label(self, features: dict) -> int:
        """Règle métier GO (1) / NO-GO (0)."""
        return (
            1
            if (
                features["ratio_ca"] >= 1.0
                and features["ratio_credit"] >= 1.0
                and features["poids_caution"] < 0.2
            )
            else 0
        )

    def resolve_label(self, dao_data: dict, features: dict) -> int:
        """Label humain prioritaire, sinon règle métier."""
        for key in ("label_decision", "decision", "label"):
            val = dao_data.get(key)
            if val is None and isinstance(dao_data.get("meta"), dict):
                val = dao_data["meta"].get(key)
            if val is not None:
                if isinstance(val, str):
                    return 1 if val.strip().upper() in ("GO", "1", "OUI", "YES") else 0
                return int(bool(val))
        return self.compute_label(features)

    def _extract_ca_min_from_hard_filters(self, dao_data: dict) -> int:
        """
        Extrait le CA minimum exigé depuis technique.hard_filters.chiffre_affaires_min.
        Retourne 0 si non trouvé ou non extractible.
        L'ao_extractor remplit ce champ dans ~50 % des DAOs IT analysés.
        """
        try:
            tech = (dao_data.get("technique") or {})
            hard = tech.get("hard_filters") or {}
            items = hard.get("chiffre_affaires_min") or []
            if not items:
                return 0
            # Prend le maximum des valeurs extraites (plusieurs lots possibles)
            values = [int(item.get("valeur") or 0) for item in items if item.get("valeur")]
            return max(values) if values else 0
        except Exception:
            return 0

    def _extract_credit_min_from_hard_filters(self, dao_data: dict) -> int:
        """
        Extrait la ligne de crédit minimum exigée depuis technique.hard_filters.ligne_credit_min.
        """
        try:
            tech = (dao_data.get("technique") or {})
            hard = tech.get("hard_filters") or {}
            items = hard.get("ligne_credit_min") or []
            if not items:
                return 0
            values = [int(item.get("valeur") or 0) for item in items if item.get("valeur")]
            return max(values) if values else 0
        except Exception:
            return 0

    def calculate_features(self, dao_data: dict, company_profile: dict) -> dict:
        """
        Calcule les ratios et métadonnées pour un DAO.
        Retourne un dict incluant FEATURE_COLUMNS + ref_dao, budget_fcfa, caution_fcfa.

        Amélioration v2 : utilise le CA minimum et la ligne de crédit minimum
        RÉELLEMENT exigés dans le DAO (extraits par ao_extractor) quand disponibles,
        plutôt que les estimations budget×0.5 et budget×0.2.
        Cela rend ratio_ca et ratio_credit nettement plus précis sur les marchés IT.
        """
        dao = self.normalize_dao(dao_data)
        adm = dao.get("administratif") or {}
        fin = dao.get("financier") or {}

        ref = self.normalize_ref(adm.get("reference", "INCONNU"))
        budget = self.extract_budget(fin)
        caution = self.extract_caution(fin, budget)

        keywords = self._extract_keywords_from_profile(company_profile)
        corpus = self.build_tech_corpus(dao)
        score_tech = self.compute_tech_score(corpus, keywords)

        # ── Exigence CA : valeur réelle du DAO si extraite, sinon estimation ──
        ca_min_dao = self._extract_ca_min_from_hard_filters(dao_data)
        if ca_min_dao > 0:
            exigence_ca = ca_min_dao
        elif budget > 0:
            exigence_ca = budget * 0.5   # estimation prudente (50 % du budget)
        else:
            exigence_ca = 0

        ratio_ca = (
            float(company_profile.get("annual_revenue") or 0) / exigence_ca if exigence_ca > 0 else 1.0
        )

        # ── Exigence crédit : valeur réelle si extraite, sinon estimation ──
        credit_min_dao = self._extract_credit_min_from_hard_filters(dao_data)
        if credit_min_dao > 0:
            exigence_credit = credit_min_dao
        elif budget > 0:
            exigence_credit = budget * 0.2
        else:
            exigence_credit = 0

        ratio_credit = (
            float(company_profile.get("credit_line") or 0) / exigence_credit if exigence_credit > 0 else 1.0
        )

        available_cash = company_profile.get("available_cash", 0)
        poids_caution = caution / available_cash if available_cash > 0 else 1.0

        features = {
            "ref_dao": ref,
            "budget_fcfa": budget,
            "caution_fcfa": caution,
            "ratio_ca": round(ratio_ca, 2),
            "ratio_credit": round(ratio_credit, 2),
            "poids_caution": round(poids_caution, 4),
            "score_tech": score_tech,
        }
        features["label_decision"] = self.resolve_label(dao_data, features)
        return features

    def features_to_frame(self, features: dict) -> pd.DataFrame:
        """Une ligne X avec colonnes dans l'ordre FEATURE_COLUMNS."""
        return pd.DataFrame([[features[col] for col in FEATURE_COLUMNS]], columns=FEATURE_COLUMNS)

    @staticmethod
    def dao_quality_score(dao: dict) -> int:
        proc = DAOProcessor()
        dao = proc.normalize_dao(dao)
        fin = dao.get("financier") or {}
        score = 0
        if proc.extract_budget(fin) != DEFAULT_BUDGET_FCFA:
            score += 1000
        if proc.extract_caution(fin, proc.extract_budget(fin)) > 0:
            score += 500
        bg = fin.get("budget_global") or {}
        cg = fin.get("caution_global") or {}
        if isinstance(bg, dict):
            score += min(len(bg.get("text", "")), 500)
        if isinstance(cg, dict):
            score += min(len(cg.get("text", "")), 300)
        return score

    def dedupe_daos(self, daos: list[dict]) -> list[dict]:
        best: dict[str, dict] = {}
        for dao in daos:
            ref = self.normalize_ref((dao.get("administratif") or {}).get("reference", "INCONNU"))
            if ref not in best or self.dao_quality_score(dao) > self.dao_quality_score(best[ref]):
                best[ref] = dao
        return list(best.values())


# ══════════════════════════════════════════════════════════════════════════════
# Qualification déterministe du personnel
# ------------------------------------------------------------------------------
# Reproduit la logique d'une commission d'évaluation : les exigences de
# personnel d'un DAO sont des critères éliminatoires combinés en ET strict ;
# les alternatives (« PMP ou Prince2 ») forment un OU au sein d'un critère.
# Aucun ML ici : règles pures, traçables, testées unitairement.
# ══════════════════════════════════════════════════════════════════════════════


def _strip_accents(s) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", str(s)) if unicodedata.category(c) != "Mn"
    )


def _norm(s) -> str:
    """Normalisation : minuscules, accents retirés, espaces réduits."""
    return " ".join(_strip_accents(s or "").lower().split())


# Hiérarchie des diplômes (rang croissant). Bac+5 ⇔ Master ⇔ Ingénieur.
_DEGREE_RANKS: list[tuple[tuple[str, ...], int]] = [
    (("doctorat", "phd", "ph.d"), 6),
    (("master", "ingenieur", "dess", "dea", "mba", "msc"), 5),
    (("maitrise",), 4),
    (("licence", "bachelor"), 3),
    (("bts", "dut", "deug"), 2),
    (("certificat",), 1),
]


def degree_rank(label) -> int:
    """Rang d'un libellé de diplôme (0 si inconnu — critère alors non opposable)."""
    n = _norm(label)
    if not n:
        return 0
    m = re.search(r"bac\s*\+\s*(\d)", n)
    if m:
        v = int(m.group(1))
        return 6 if v >= 8 else 5 if v >= 5 else max(v, 1)
    for keys, rank in _DEGREE_RANKS:
        if any(k in n for k in keys):
            return rank
    return 0


def _person_degree_rank(person: dict) -> int:
    best = 0
    for d in person.get("diplomas") or []:
        label = d.get("degree", "") if isinstance(d, dict) else d
        best = max(best, degree_rank(label))
    if person.get("education"):
        best = max(best, degree_rank(person["education"]))
    return best


def _person_experience_years(person: dict) -> float:
    """Expérience déclarée, sinon déduite du diplôme le plus expérimenté."""
    y = person.get("years_experience")
    if isinstance(y, (int, float)) and y > 0:
        return float(y)
    best = 0.0
    for d in person.get("diplomas") or []:
        if isinstance(d, dict) and isinstance(d.get("years_experience"), (int, float)):
            best = max(best, float(d["years_experience"]))
    return best


def _person_certifications(person: dict) -> list[str]:
    return [_norm(c) for c in (person.get("certifications") or []) if _norm(c)]


def _person_domains(person: dict, past_projects: list) -> set:
    """Domaines réellement pratiqués : projets de l'entreprise rattachés à l'expert."""
    name = person.get("name")
    out: set = set()
    for proj in past_projects or []:
        if name and name in (proj.get("personnel_names") or []):
            for d in proj.get("domains") or []:
                out.add(_norm(d))
    return out


_ROLE_STOPWORDS = {"de", "du", "des", "la", "le", "les", "en", "et", "un", "une", "senior", "junior"}


def _stem_fr(token: str) -> str:
    """Stemming léger : neutralise genre et marques finales (cheffe→chef, développeuse→développeur)."""
    t = token
    if t.endswith("euse"):
        t = t[:-4] + "eur"
    elif t.endswith("trice"):
        t = t[:-5] + "teur"
    elif t.endswith("e") and len(t) > 4:
        t = t[:-1]
    if len(t) >= 4 and t[-1] == t[-2]:
        t = t[:-1]
    return t


def _role_tokens(label) -> set:
    return {
        _stem_fr(t)
        for t in re.split(r"[^a-z0-9]+", _norm(label))
        if len(t) >= 3 and t not in _ROLE_STOPWORDS
    }


def _tokens_match(a: str, b: str) -> bool:
    """Tolère genre/déclinaisons : « developpeur » ~ « developpeuse », « chef » ~ « cheffe »."""
    if a == b:
        return True
    if len(a) >= 4 and len(b) >= 4 and (a.startswith(b) or b.startswith(a)):
        return True
    return False


def _role_match(required_poste: str, person_role: str) -> bool:
    req_tokens = _role_tokens(required_poste)
    person_tokens = _role_tokens(person_role)
    if not req_tokens or not person_tokens:
        return False
    return any(_tokens_match(a, b) for a in req_tokens for b in person_tokens)


def extract_personnel_requirements(dao_data: dict) -> list:
    """Localise les exigences de personnel dans le JSON extrait du DAO."""
    if not isinstance(dao_data, dict):
        return []
    candidates = [
        dao_data.get("personnel_cle_struct"),
        (dao_data.get("technique") or {}).get("personnel_cle_struct")
        if isinstance(dao_data.get("technique"), dict)
        else None,
    ]
    for node in candidates:
        if isinstance(node, list) and node:
            return node
    return []


def _dedupe_requirements(requirements: list) -> list[dict]:
    """Fusionne les occurrences d'un même poste en gardant le critère le plus strict."""
    by_poste: dict = {}
    for r in requirements or []:
        if not isinstance(r, dict):
            continue
        poste = str(r.get("poste") or "").strip()
        if not poste:
            continue
        key = _norm(poste)
        cur = by_poste.setdefault(
            key,
            {"poste": poste, "experience_min_annees": 0, "diplome_min": "", "certifications": [], "domaines": []},
        )
        exp = r.get("experience_min_annees") or 0
        if isinstance(exp, (int, float)) and exp > cur["experience_min_annees"]:
            cur["experience_min_annees"] = int(exp)
        dip = str(r.get("diplome_min") or r.get("diplome") or "")
        if degree_rank(dip) > degree_rank(cur["diplome_min"]):
            cur["diplome_min"] = dip
        for grp in r.get("certifications") or []:
            grp_list = [str(g).strip() for g in (grp if isinstance(grp, list) else [grp]) if str(g).strip()]
            if grp_list and grp_list not in cur["certifications"]:
                cur["certifications"].append(grp_list)
        for d in r.get("domaines") or []:
            if d and d not in cur["domaines"]:
                cur["domaines"].append(d)
    return list(by_poste.values())


def _evaluate_candidate(person: dict, req: dict, past_projects: list) -> dict:
    """ET strict : liste les critères manquants ; qualifié ⇔ aucun manque."""
    missing: list[str] = []

    if not _role_match(req["poste"], person.get("role", "")):
        missing.append(f"poste : « {person.get('role', '?')} » ne correspond pas à « {req['poste']} »")

    exp_min = req.get("experience_min_annees") or 0
    if exp_min > 0:
        have = _person_experience_years(person)
        if have < exp_min:
            missing.append(f"expérience : {int(have)} an(s) < {exp_min} exigé(s)")

    required_rank = degree_rank(req.get("diplome_min", ""))
    if required_rank > 0 and _person_degree_rank(person) < required_rank:
        missing.append(f"diplôme : niveau « {req.get('diplome_min')} » minimum exigé")

    certs = _person_certifications(person)
    for grp in req.get("certifications") or []:
        # OU dans le groupe : une certification de l'expert peut contenir le libellé exigé
        ok = any(any(_norm(want) in have for have in certs) for want in grp)
        if not ok:
            missing.append("certification : " + " ou ".join(grp))

    if req.get("domaines"):
        pdoms = _person_domains(person, past_projects)
        for d in req["domaines"]:
            if _norm(d) not in pdoms:
                missing.append(f"domaine : « {d} » non prouvé par ses projets rattachés")

    return {"name": person.get("name", ""), "qualified": not missing, "missing": missing}


def qualify_personnel(requirements: list, company_profile: dict) -> dict:
    """
    Évalue la couverture des exigences de personnel d'un DAO par les experts
    du profil entreprise.

    Retour :
      applicable      False si le DAO n'exprime aucune exigence exploitable
      required_count  nombre de rôles exigés (dédoublonnés)
      covered_count   rôles pour lesquels au moins un expert est qualifié
      coverage        covered/required (None si non applicable)
      roles           détail par rôle : exigences, experts qualifiés,
                      candidats triés avec leurs critères manquants
    """
    reqs = _dedupe_requirements(requirements)
    if not reqs:
        return {"applicable": False, "required_count": 0, "covered_count": 0, "coverage": None, "roles": []}

    personnel = company_profile.get("personnel") or []
    projects = company_profile.get("past_projects") or []

    roles = []
    covered = 0
    for req in reqs:
        candidates = [_evaluate_candidate(p, req, projects) for p in personnel]
        qualified = [c["name"] for c in candidates if c["qualified"]]
        if qualified:
            covered += 1
        candidates.sort(key=lambda c: (not c["qualified"], len(c["missing"])))
        exigences = {
            k: req[k]
            for k in ("experience_min_annees", "diplome_min", "certifications", "domaines")
            if req.get(k)
        }
        roles.append(
            {
                "poste": req["poste"],
                "exigences": exigences,
                "covered": bool(qualified),
                "qualified_experts": qualified,
                "candidates": candidates[:5],
            }
        )

    return {
        "applicable": True,
        "required_count": len(reqs),
        "covered_count": covered,
        "coverage": round(covered / len(reqs), 4),
        "roles": roles,
    }


# ══════════════════════════════════════════════════════════════════════════════
# Évaluateur d'éligibilité unifié
# ------------------------------------------------------------------------------
# Tous les critères éliminatoires du DAO — financiers ET personnel — sont
# évalués ICI, au même endroit et dans le même format. Règle de prudence :
# seules les exigences EXPLICITEMENT extraites du DAO sont opposables ;
# les valeurs estimées (budget × taux) ne disqualifient jamais.
# ══════════════════════════════════════════════════════════════════════════════


def evaluate_eligibility(dao_data: dict, company_profile: dict) -> dict:
    """
    Évalue la conformité de l'entreprise face aux critères éliminatoires du DAO.

    Retour :
      applicable      False si le DAO n'exprime aucune exigence explicite
      eligible        True/False (None si non applicable) — ET strict sur les critères
      criteres        liste homogène : {id, categorie, libelle, exigence, capacite,
                      satisfait, detail}
      non_satisfaits  ids des critères manquants
      personnel       résultat détaillé de qualify_personnel (toujours présent)
    """
    proc = DAOProcessor()
    dao = proc.normalize_dao(dao_data)
    fin = dao.get("financier") or {}

    criteres: list[dict] = []

    def add(cid, categorie, libelle, exigence, capacite, satisfait, detail=""):
        criteres.append({
            "id": cid,
            "categorie": categorie,
            "libelle": libelle,
            "exigence": exigence,
            "capacite": capacite,
            "satisfait": bool(satisfait),
            "detail": detail,
        })

    # ── Critères financiers (uniquement si exigés explicitement par le DAO) ──
    ca_min = proc._extract_ca_min_from_hard_filters(dao_data)
    if ca_min > 0:
        ca = float(company_profile.get("annual_revenue") or 0)
        add("ca_min", "financier", "Chiffre d'affaires annuel minimum",
            ca_min, ca, ca >= ca_min,
            "exigence extraite des hard_filters du DAO")

    credit_min = proc._extract_credit_min_from_hard_filters(dao_data)
    if credit_min > 0:
        credit = float(company_profile.get("credit_line") or 0)
        add("credit_min", "financier", "Ligne de crédit minimum",
            credit_min, credit, credit >= credit_min,
            "exigence extraite des hard_filters du DAO")

    # Caution : budget=0 pour désactiver l'estimation — seule une caution
    # explicitement mentionnée dans le DAO est opposable.
    caution_explicite = proc.extract_caution(fin, 0)
    if caution_explicite > 0:
        capacite = float(company_profile.get("available_cash") or 0) + float(
            company_profile.get("credit_line") or 0
        )
        add("caution", "financier", "Caution de soumission",
            caution_explicite, capacite, capacite >= caution_explicite,
            "capacité = trésorerie disponible + ligne de crédit")

    # ── Critère personnel (rôles exigés par le DAO) ──────────────────────────
    requirements = extract_personnel_requirements(dao_data)
    qualification = qualify_personnel(requirements, company_profile)
    if qualification["applicable"]:
        add("personnel", "personnel", "Profils de personnel exigés",
            f"{qualification['required_count']} rôle(s) exigé(s)",
            f"{qualification['covered_count']} rôle(s) couvert(s)",
            qualification["coverage"] == 1.0,
            "détail par rôle dans le bloc personnel")

    applicable = bool(criteres)
    return {
        "applicable": applicable,
        "eligible": all(c["satisfait"] for c in criteres) if applicable else None,
        "criteres": criteres,
        "non_satisfaits": [c["id"] for c in criteres if not c["satisfait"]],
        "personnel": qualification,
    }
