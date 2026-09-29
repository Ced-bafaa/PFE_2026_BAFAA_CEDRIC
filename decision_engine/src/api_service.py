"""
Microservice HTTP FastAPI — moteur de décision KIAMA.
Lancer depuis decision_engine/ :
  uvicorn src.api_service:app --host 0.0.0.0 --port 8765

Refonte (juin 2026) : le scoring est désormais piloté par le MCDA
(aide à la décision multicritère, voir mcda_scorer.py) — l'ancien modèle
XGBoost et l'explicabilité SHAP ont été retirés du service. Le DAO est
analysé en règles (DAOProcessor) pour en extraire référence, budget,
caution et ratios financiers ; le MCDA produit le score et le verdict ;
Groq fournit la couche qualitative ; le filtre sémantique recommande le
personnel. Aucun modèle .pkl n'est chargé.
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

_SRC = Path(__file__).resolve().parent
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from inference_pipeline import load_company_profile
from core_logic import evaluate_eligibility, DAOProcessor, FEATURE_COLUMNS
from groq_scorer import get_scorer
from semantic_filter import get_filter

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_COMPANY = ROOT / "data" / "company_profile.json"

app = FastAPI(
    title="Strategic Compass AI",
    description="Scoring GO/NO-GO pour appels d'offres (KIAMA) — moteur MCDA",
    version="3.1.0",
)

# CORS : autorise les appels (ex. /relevance) depuis le navigateur — outils de test locaux.
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


# ─── Fusion des scores (explicabilité) ────────────────────────────────────────
# NB : le score AFFICHÉ vient du MCDA. La « fusion » ne sert plus qu'à produire
# les justifications de blocage (Groq + critères financiers du DAO) et le malus
# de couverture du personnel, regroupés dans triggered_rules pour l'explicabilité.
# Les poids ci-dessous ne pilotent qu'un score de repli (si le MCDA échoue).
WEIGHT_BASE        = float(os.environ.get("WEIGHT_FINANCIAL",   "0.60"))
WEIGHT_QUALITATIVE = float(os.environ.get("WEIGHT_QUALITATIVE", "0.40"))


def _fuse_scores(
    base_score: float,            # 0-100 (score MCDA, sert de base au repli)
    qualitative: dict,            # résultat GroqQualitativeScorer
    eligibility: dict | None = None,  # résultat evaluate_eligibility (core_logic)
) -> dict:
    """
    Agrège, par règles nommées, les signaux de conformité et de qualité :

      R1 ponderation_base_qual   : score de repli = w1·base + w2·qual (ou base seul)
      R2 blocage_qualitatif      : check Groq « blocking » → NO-GO forcé
      R3 blocage_financier       : critère financier EXPLICITE du DAO non satisfait
                                   (CA min, crédit min, caution) → NO-GO forcé
      R4 malus_personnel         : rôles exigés partiellement couverts →
                                   malus proportionnel borné à 0.10 (non bloquant,
                                   l'extraction OCR restant faillible)

    Retourne aussi triggered_rules pour l'explicabilité de bout en bout.
    """
    eligibility = eligibility or {}
    triggered: list[str] = []

    score_base = base_score / 100.0
    score_qual = qualitative.get("score_qualitatif", 0.5)
    groq_ok = qualitative.get("ollama_available", False)  # champ conservé pour compatibilité DB

    # R1 — pondération (repli)
    if groq_ok:
        score_global = WEIGHT_BASE * score_base + WEIGHT_QUALITATIVE * score_qual
        triggered.append("ponderation_base_qual")
    else:
        score_global = score_base
        triggered.append("score_base_seul")

    # R4 — malus de couverture du personnel (jamais bloquant)
    perso = eligibility.get("personnel") or {}
    if perso.get("applicable") and (perso.get("coverage") or 0) < 1.0:
        malus = round(0.10 * (1.0 - float(perso["coverage"])), 4)
        score_global -= malus
        triggered.append(f"malus_personnel(-{malus})")

    score_global = round(max(score_global, 0.0), 4)

    # R2 — blocage qualitatif (Groq)
    has_blocking = any(
        c.get("status") == "blocking"
        for c in (qualitative.get("checks") or [])
    )
    override = None
    if has_blocking:
        pts = qualitative.get("points_bloquants") or []
        override = "Critère(s) disqualifiant(s) : " + " ; ".join(pts[:3]) if pts else "Exigence bloquante détectée."
        triggered.append("blocage_qualitatif")

    # R3 — blocage par critère financier explicite du DAO
    fin_manquants = [
        c for c in (eligibility.get("criteres") or [])
        if c.get("categorie") == "financier" and not c.get("satisfait")
    ]
    if fin_manquants:
        labels = " ; ".join(c.get("libelle", c.get("id", "?")) for c in fin_manquants[:3])
        msg = f"Exigence(s) financière(s) du DAO non satisfaite(s) : {labels}."
        override = f"{override} {msg}" if override else msg
        has_blocking = True
        triggered.append("blocage_financier")

    # Seuil GO : 50 % sur le score global
    is_go = (score_global >= 0.50) and not has_blocking

    return {
        "score_financier":         round(score_base, 4),
        "score_qualitatif":        round(score_qual, 4),
        "score_global":            score_global,
        "verdict_final":           "GO (Postuler)" if is_go else "NO-GO (Risque)",
        "prediction_final":        1 if is_go else 0,
        "justification_override":  override,
        "triggered_rules":         triggered,
    }


# ─── Modèles Pydantic ─────────────────────────────────────────────────────────

class PredictRequest(BaseModel):
    dao: Dict[str, Any] = Field(..., description="JSON extracteur (administratif/financier/technique)")
    company_profile: Optional[Dict[str, Any]] = Field(None)
    partners: Optional[List[Dict[str, Any]]] = Field(
        None, description="Profils partenaires (mêmes champs que l'entreprise) pour la reco de groupement")
    skip_qualitative: bool = Field(False, description="Si True, n'appelle pas Groq (plus rapide)")


class QualitativeCheck(BaseModel):
    type: str
    label: str
    status: str          # "ok" | "warning" | "blocking"
    exigence: str
    profil: str
    detail: str


class QualitativeAnalysis(BaseModel):
    checks: List[QualitativeCheck]
    score_qualitatif: float
    points_forts: List[str]
    points_bloquants: List[str]
    resume: str
    ollama_available: bool


class ScoreFusion(BaseModel):
    score_financier: float
    score_qualitatif: float
    score_global: float
    weights: Dict[str, float]
    justification_override: Optional[str] = None
    triggered_rules: List[str] = []


class PredictResponse(BaseModel):
    # ── Identité
    ref_dao: str
    budget_fcfa: int
    caution_fcfa: int

    # ── Features financières (extraites en règles du DAO)
    features: Dict[str, float]
    rule_label: int

    # ── Scoring (piloté par le MCDA ; champs conservés pour compatibilité backend)
    prediction: int
    confidence_go_pct: float
    shap_contributions: Optional[Dict[str, float]] = None  # déprécié (toujours null)

    # ── Scoring qualitatif (Groq)
    qualitative: Optional[QualitativeAnalysis] = None

    # ── Fusion (explicabilité : règles de blocage + malus personnel)
    fusion: Optional[ScoreFusion] = None

    # ── Conformité (critères éliminatoires financiers + personnel)
    eligibility: Optional[Dict[str, Any]] = None

    # ── Verdict final
    verdict: str
    prediction_final: int

    # ── Scoring MCDA (critères + poids AHP) et recommandation de personnel
    mcda: Optional[Dict[str, Any]] = None
    recommended_experts: Optional[List[Dict[str, Any]]] = None

    # ── Recommandation de partenaires pour un groupement (par complémentarité)
    recommended_partners: Optional[List[Dict[str, Any]]] = None


# ─── Pertinence (filtre sémantique IT / non-IT) ────────────────────────────────

class RelevanceRequest(BaseModel):
    objets: List[str] = Field(..., description="Objets d'AO à classer")


class RelevanceItem(BaseModel):
    objet: str                       # texte d'entrée (titre brut)
    objet_nettoye: Optional[str] = None  # objet réellement classé (après nettoyage)
    label: str                       # "IT" | "non-IT" | "à vérifier" | "inconnu"
    pertinent: bool
    diff: Optional[float] = None
    sim_it: Optional[float] = None
    sim_non: Optional[float] = None
    raison: Optional[str] = None


class RelevanceResponse(BaseModel):
    available: bool
    model: str
    eps: float
    results: List[RelevanceItem]


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _resolve_company(profile: Optional[Dict[str, Any]]) -> dict:
    if profile:
        return profile
    path = os.environ.get("COMPANY_PROFILE_PATH", str(DEFAULT_COMPANY))
    return load_company_profile(path)


def _parse_dao(dao: dict, company: dict) -> dict:
    """Extrait du DAO les éléments factuels nécessaires au scoring MCDA
    (référence, budget, caution, ratios financiers) par règles — SANS modèle ML."""
    proc = DAOProcessor()
    features = proc.calculate_features(dao, company)
    return {
        "ref_dao": features["ref_dao"],
        "budget_fcfa": features["budget_fcfa"],
        "caution_fcfa": features["caution_fcfa"],
        "features": {col: features[col] for col in FEATURE_COLUMNS},
        "rule_label": proc.compute_label(features),
    }


# ─── Initialisation au démarrage ──────────────────────────────────────────────

@app.on_event("startup")
def _warm_semantic_filter() -> None:
    """Charge le filtre sémantique au démarrage et logge son état — diagnostic
    immédiat (plus besoin d'appeler /relevance pour savoir s'il est actif)."""
    try:
        f = get_filter()
        logger.info("[startup] Filtre sémantique : available=%s | modèle=%s | eps=%s",
                    f.is_available, f.model_name, f.eps)
        if not f.is_available:
            logger.warning("[startup] Filtre sémantique INACTIF — vérifier que "
                           "SEMANTIC_FILTER_ENABLED=true et SEMANTIC_CACHE_DIR pointe "
                           "vers le cache du modèle.")
    except Exception as exc:  # pragma: no cover
        logger.warning("[startup] Filtre sémantique : initialisation échouée (%s)", exc)


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    scorer = get_scorer()
    filt = get_filter()
    return {
        "status": "ok",
        "version": "3.1.0",
        "scoring": "mcda",
        "semantic_filter_available": filt.is_available,
        "semantic_model": filt.model_name,
        "groq_available": scorer.is_available,
        "groq_model": scorer.model,
    }


@app.post("/predict", response_model=PredictResponse)
def predict(body: PredictRequest):
    if not body.dao or not isinstance(body.dao, dict):
        raise HTTPException(status_code=400, detail="Champ 'dao' requis.")

    try:
        company = _resolve_company(body.company_profile)
        result  = _parse_dao(body.dao, company)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    # ── Caractéristiques de l'AO (réutilisées par Groq, le MCDA et la reco)
    adm = (body.dao.get("administratif") or {}) if isinstance(body.dao, dict) else {}
    fin = (body.dao.get("financier") or {}) if isinstance(body.dao, dict) else {}
    objet_ao = (adm.get("objet") or adm.get("intitule") or adm.get("titre")
                or result.get("ref_dao") or "")
    deadline = (adm.get("date_cloture") or adm.get("date_limite") or adm.get("date_remise")
                or adm.get("date_limite_depot") or adm.get("cloture") or "")
    financement = adm.get("financement") or fin.get("financement") or adm.get("source") or ""

    # ── Reco personnel + adéquation technique — calculées AVANT Groq pour enrichir
    #    son contexte (analyse plus spécifique, même quand le DAO a peu de texte).
    recommended_experts: list = []
    try:
        recommended_experts = get_filter().recommend_experts(
            objet_ao, (company.get("personnel") or []), top_n=3)
    except Exception as exc:
        logger.warning("[predict] recommend_experts erreur : %s", exc)
        recommended_experts = []

    # ── Reco de partenaires pour un GROUPEMENT (complémentarité aux lacunes).
    recommended_partners: list = []
    try:
        if body.partners:
            recommended_partners = get_filter().recommend_partners(
                objet_ao, company, body.partners, top_n=3)
    except Exception as exc:
        logger.warning("[predict] recommend_partners erreur : %s", exc)
        recommended_partners = []

    adequation_technique = None
    try:
        from mcda_scorer import _v_technique
        adequation_technique = _v_technique(objet_ao, company, get_filter())[0]
    except Exception as exc:
        logger.warning("[predict] adéquation technique (contexte Groq) erreur : %s", exc)

    # ── Scoring qualitatif Groq (couche qualitative optionnelle), enrichi du
    #    contexte décisionnel KIAMA : adéquation technique + experts recommandés.
    qualitative_raw: dict = {}
    if not body.skip_qualitative:
        try:
            scorer = get_scorer()
            qualitative_raw = scorer.score(
                body.dao, company,
                decision_context={
                    "adequation_technique": adequation_technique,
                    "experts": recommended_experts,
                },
            )
            logger.info(
                "[predict] Groq score_qual=%.3f checks=%d available=%s",
                qualitative_raw.get("score_qualitatif", 0),
                len(qualitative_raw.get("checks") or []),
                qualitative_raw.get("ollama_available"),
            )
        except Exception as exc:
            logger.warning("[predict] Groq scorer erreur : %s", exc)
            qualitative_raw = {}

    # ── Conformité : critères éliminatoires du DAO (financiers + personnel)
    try:
        eligibility = evaluate_eligibility(body.dao, company)
        if eligibility.get("applicable"):
            logger.info(
                "[predict] Éligibilité : eligible=%s, non_satisfaits=%s, couverture personnel=%s",
                eligibility.get("eligible"),
                eligibility.get("non_satisfaits"),
                (eligibility.get("personnel") or {}).get("coverage"),
            )
    except Exception as exc:
        logger.warning("[predict] evaluate_eligibility erreur : %s", exc)
        eligibility = {"applicable": False, "eligible": None, "criteres": [], "non_satisfaits": [], "personnel": {}}

    # ── Score MCDA (aide à la décision multicritère) — LE moteur de décision.
    mcda = None
    try:
        from mcda_scorer import score_mcda
        feats = result.get("features") or {}
        fin_unmet = any(c.get("categorie") == "financier" and not c.get("satisfait")
                        for c in (eligibility.get("criteres") or []))
        # NOTE (conception) : la couche qualitative n'intervient NI dans la note,
        # NI dans le verdict. Un modèle de langue n'étant pas déterministe, lui
        # laisser un droit de veto rendrait le verdict non reproductible — ce qui
        # contredirait l'exigence d'explicabilité du cahier des charges.
        # Les points bloquants qu'il signale restent affichés sur la fiche
        # décisionnelle : l'agent les voit, mais c'est lui qui tranche.
        block_qual_labels = [c.get("label") for c in (qualitative_raw.get("checks") or [])
                             if c.get("status") == "blocking"]
        if block_qual_labels:
            logger.info("[predict] points bloquants signalés (sans effet sur le verdict) : %s",
                        block_qual_labels)
        mcda = score_mcda(
            objet=objet_ao, budget=result.get("budget_fcfa"),
            ratio_ca=feats.get("ratio_ca"), ratio_credit=feats.get("ratio_credit"),
            deadline=deadline, financement=financement,
            company_profile=company, sem_filter=get_filter(),
            eligible=(eligibility.get("eligible") is not False) and not fin_unmet,
            blocking=fin_unmet,
        )
        logger.info("[predict] MCDA score=%.1f verdict=%s critères=%s",
                    mcda["score"], mcda["verdict"],
                    {k: v["valeur"] for k, v in mcda["criteres"].items()})
    except Exception as exc:
        logger.warning("[predict] MCDA erreur : %s", exc)
        mcda = None

    # ── Fusion (explicabilité : règles de blocage + malus personnel). Le score
    # affiché vient du MCDA ; la fusion produit les justifications/triggered_rules.
    base_score = float(mcda["score"]) if mcda else 0.0
    fusion_data = _fuse_scores(base_score, qualitative_raw, eligibility)

    if mcda:
        # Le MCDA pilote le score/verdict affichés (portés par confidence_go_pct
        # + prediction, déjà consommés par le backend → aucun changement requis).
        disp_score = float(mcda["score"])
        disp_pred = int(mcda["prediction"])
        disp_pred_final = int(mcda["prediction"])
        disp_verdict = mcda["verdict"]
        fusion_data["score_global"] = round(mcda["score"] / 100.0, 4)
        fusion_data.setdefault("triggered_rules", []).append("scoring_mcda")
    else:
        # Repli si le MCDA échoue : on s'appuie sur la fusion (règles + Groq).
        disp_score = round(fusion_data["score_global"] * 100.0, 1)
        disp_pred = int(fusion_data["prediction_final"])
        disp_pred_final = int(fusion_data["prediction_final"])
        disp_verdict = fusion_data["verdict_final"]

    # ── Construction réponse
    qualitative_out: Optional[QualitativeAnalysis] = None
    if qualitative_raw:
        raw_checks = qualitative_raw.get("checks") or []
        checks = [
            QualitativeCheck(
                type=c.get("type", ""),
                label=c.get("label", ""),
                status=c.get("status", "ok"),
                exigence=c.get("exigence", ""),
                profil=c.get("profil", ""),
                detail=c.get("detail", ""),
            )
            for c in raw_checks
        ]
        qualitative_out = QualitativeAnalysis(
            checks=checks,
            score_qualitatif=qualitative_raw.get("score_qualitatif", 0.5),
            points_forts=qualitative_raw.get("points_forts") or [],
            points_bloquants=qualitative_raw.get("points_bloquants") or [],
            resume=qualitative_raw.get("resume") or "",
            ollama_available=qualitative_raw.get("ollama_available", False),
        )

    fusion_out = ScoreFusion(
        score_financier=fusion_data["score_financier"],
        score_qualitatif=fusion_data["score_qualitatif"],
        score_global=fusion_data["score_global"],
        weights={"base": WEIGHT_BASE, "qualitative": WEIGHT_QUALITATIVE},
        justification_override=fusion_data.get("justification_override"),
        triggered_rules=fusion_data.get("triggered_rules") or [],
    )

    return PredictResponse(
        ref_dao=result["ref_dao"],
        budget_fcfa=int(result["budget_fcfa"]),
        caution_fcfa=int(result["caution_fcfa"]),
        features=result["features"],
        rule_label=int(result["rule_label"]),
        prediction=disp_pred,
        confidence_go_pct=disp_score,
        shap_contributions=None,
        qualitative=qualitative_out,
        fusion=fusion_out,
        eligibility=eligibility,
        verdict=disp_verdict,
        prediction_final=disp_pred_final,
        mcda=mcda,
        recommended_experts=recommended_experts,
        recommended_partners=recommended_partners,
    )


@app.post("/relevance", response_model=RelevanceResponse)
def relevance(body: RelevanceRequest):
    """Classe des objets d'AO en IT / non-IT / à vérifier (filtre sémantique par embeddings).

    Dégradation gracieuse : si le filtre est désactivé (SEMANTIC_FILTER_ENABLED=false)
    ou indisponible, available=False et pertinent=True pour tous — l'appelant
    (backend) conserve alors son comportement actuel (mots-clés).
    """
    filt = get_filter()
    results = []
    for o in body.objets:
        r = filt.classify(o)
        results.append(RelevanceItem(
            objet=o,
            objet_nettoye=r.get("objet_nettoye"),
            label=r["label"],
            pertinent=r["pertinent"],
            diff=r.get("diff"),
            sim_it=r.get("sim_it"),
            sim_non=r.get("sim_non"),
            raison=r.get("raison"),
        ))
    return RelevanceResponse(
        available=filt.is_available, model=filt.model_name, eps=filt.eps, results=results,
    )


@app.get("/")
def root():
    return {
        "service": "decision-engine",
        "version": "3.1.0",
        "endpoints": {
            "predict":          "POST /predict  → scoring MCDA + Groq qualitatif + reco personnel",
            "relevance":        "POST /relevance → classe des objets d'AO IT/non-IT (filtre sémantique)",
            "health":           "GET /health",
        },
    }
