# Données d'entraînement (manuel uniquement)

Déposez ici vos JSON validés (un DAO par fichier ou une liste dans un fichier).

**Ne pas** copier automatiquement `ao_extractor/output/resultats.json` — ce flux sert à la **prédiction**, pas à l'entraînement.

```powershell
cd decision_engine
python src/train_pipeline.py
# ou : python src/train_pipeline.py --archive data/training/mon_lot.json
```
