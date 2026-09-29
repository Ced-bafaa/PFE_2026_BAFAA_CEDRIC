"""
Pipeline d'inférence : un JSON OCR -> features -> verdict via modèle .pkl
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import joblib
import pandas as pd

from core_logic import DAOProcessor, FEATURE_COLUMNS

DEFAULT_COMPANY = "data/company_profile.json"
DEFAULT_MODEL = "models/decision_model.pkl"


def load_company_profile(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_dao_json(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, list):
        if len(data) != 1:
            raise ValueError("Le fichier contient plusieurs DAO : fournissez un seul objet JSON.")
        return data[0]
    if not isinstance(data, dict):
        raise ValueError("Format JSON invalide : objet ou liste d'un élément attendu.")
    return data


def _compute_shap(model, X) -> dict | None:
    """
    Calcule les contributions SHAP (TreeSHAP) pour une prédiction XGBoost.
    Retourne un dict {feature: shap_value} pour la classe GO (label=1),
    ou None si SHAP n'est pas installé.
    """
    try:
        import shap
        import numpy as np
        explainer = shap.TreeExplainer(model)
        shap_vals = explainer.shap_values(X)
        # XGBoost binaire retourne un array 2D (n_samples × n_features)
        if isinstance(shap_vals, list):
            # Sklearn-style : [classe_0, classe_1]
            vals = shap_vals[1][0] if len(shap_vals) == 2 else shap_vals[0][0]
        else:
            vals = np.array(shap_vals)[0]
        return {col: round(float(v), 4) for col, v in zip(FEATURE_COLUMNS, vals)}
    except Exception:
        return None


def predict_verdict(
    dao_data: dict,
    company_profile: dict,
    model_path: str = DEFAULT_MODEL,
) -> dict:
    processor = DAOProcessor()
    features = processor.calculate_features(dao_data, company_profile)

    if not os.path.exists(model_path):
        raise FileNotFoundError(f"Modèle introuvable : {model_path}. Lancez train_pipeline.py d'abord.")

    model = joblib.load(model_path)
    X = processor.features_to_frame(features)

    prediction = int(model.predict(X)[0])
    proba = model.predict_proba(X)[0]
    # XGBoost : classes_ peut être [0, 1] ou absent selon la version
    try:
        classes = list(model.classes_)
        confidence_go = float(proba[classes.index(1)] * 100) if 1 in classes else float(proba[1] * 100)
    except (AttributeError, ValueError):
        confidence_go = float(proba[1] * 100)

    shap_contributions = _compute_shap(model, X)

    return {
        "ref_dao": features["ref_dao"],
        "budget_fcfa": features["budget_fcfa"],
        "caution_fcfa": features["caution_fcfa"],
        "features": {col: features[col] for col in FEATURE_COLUMNS},
        "rule_label": processor.compute_label(features),
        "prediction": prediction,
        "verdict": "GO (Postuler)" if prediction == 1 else "NO-GO (Risque)",
        "confidence_go_pct": round(confidence_go, 2),
        "shap_contributions": shap_contributions,
    }


def print_result(result: dict) -> None:
    print("\n--- RESULTAT INFERENCE ---")
    print(f"Reference      : {result['ref_dao']}")
    print(f"Budget         : {result['budget_fcfa']:,} FCFA".replace(",", " "))
    print(f"Caution        : {result['caution_fcfa']:,} FCFA".replace(",", " "))
    f = result["features"]
    print(
        f"Features       : ratio_ca={f['ratio_ca']} | ratio_credit={f['ratio_credit']} "
        f"| poids_caution={f['poids_caution']} | score_tech={f['score_tech']}"
    )
    print(f"Label (regle)  : {'GO' if result['rule_label'] == 1 else 'NO-GO'}")
    print(f"Confiance GO   : {result['confidence_go_pct']}%")
    print(f"Verdict modele : {result['verdict']}")


def run(
    dao_path: str,
    company_path: str = DEFAULT_COMPANY,
    model_path: str = DEFAULT_MODEL,
) -> dict:
    dao = load_dao_json(dao_path)
    company = load_company_profile(company_path)
    result = predict_verdict(dao, company, model_path)
    print_result(result)
    return result


def main():
    parser = argparse.ArgumentParser(description="Inférence sur un DAO (JSON OCR)")
    parser.add_argument("dao_json", help="Chemin vers le JSON d'un DAO extrait")
    parser.add_argument("--company", default=DEFAULT_COMPANY, help="Profil entreprise JSON")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Modèle .pkl")
    parser.add_argument("--output", help="Sauvegarder le résultat en JSON")
    args = parser.parse_args()

    result = run(args.dao_json, company_path=args.company, model_path=args.model)

    if args.output:
        out = Path(args.output)
        out.parent.mkdir(parents=True, exist_ok=True)
        with open(out, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print(f"Resultat exporte -> {out}")


if __name__ == "__main__":
    main()
