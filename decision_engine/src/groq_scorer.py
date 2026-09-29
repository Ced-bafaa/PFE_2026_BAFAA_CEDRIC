"""
Scoring qualitatif via Groq API (GPT-OSS 120B).

Analyse le texte du DAO et le compare au profil entreprise.
Produit un score_qualitatif (0-1) + justifications structurées.

Dégradation gracieuse : si Groq est indisponible ou la clé absente,
retourne un résultat neutre sans bloquer l'inférence XGBoost.

Configuration :
    GROQ_API_KEY   : clé API Groq (https://console.groq.com)
    GROQ_MODEL     : modèle à utiliser (défaut : openai/gpt-oss-120b)
    GROQ_ENABLED   : "false" pour désactiver (défaut : true)
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from typing import Optional

logger = logging.getLogger(__name__)

# ─── Configuration ────────────────────────────────────────────────────────────

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_MODEL   = os.environ.get("GROQ_MODEL",   "openai/gpt-oss-120b")
GROQ_ENABLED = os.environ.get("GROQ_ENABLED", "true").lower() != "false"

# Fallback si Groq est indisponible
_FALLBACK: dict = {
    "checks": [],
    "score_qualitatif": 0.5,
    "points_forts": [],
    "points_bloquants": [],
    "resume": "Analyse qualitative non disponible (Groq non configuré).",
    "ollama_available": False,   # champ conservé pour compatibilité DB
}


# ─── Helpers de construction du contexte ─────────────────────────────────────

def _extract_rc_text(dao_data: dict, max_chars: int = 3500) -> str:
    parts: list[str] = []
    adm  = dao_data.get("administratif") or {}
    tech = dao_data.get("technique") or {}
    fin  = dao_data.get("financier") or {}

    if adm.get("objet"):
        parts.append(f"Objet : {adm['objet']}")
    if adm.get("maitre_ouvrage"):
        parts.append(f"Autorité contractante : {adm['maitre_ouvrage']}")

    bg = fin.get("budget_global")
    budget_text = ""
    if isinstance(bg, dict) and bg.get("text"):
        budget_text = bg["text"]
    elif fin.get("budget_estime"):
        budget_text = str(fin["budget_estime"])
    if budget_text:
        parts.append(f"Budget : {budget_text[:400]}")

    for name, sec in (adm.get("sections") or {}).items():
        if isinstance(sec, dict) and sec.get("text"):
            parts.append(f"[{name}]\n{sec['text'][:600]}")

    kws = tech.get("tech_stack_keywords") or []
    if kws:
        parts.append(f"Technologies mentionnées : {', '.join(kws)}")

    corpus = "\n".join(parts)
    return corpus[:max_chars] if len(corpus) > max_chars else corpus


def _fmt_fcfa(value) -> str:
    try:
        return f"{int(value):,} FCFA".replace(",", " ")
    except (TypeError, ValueError):
        return str(value)


def _summarize_profile(company_profile: dict) -> str:
    lines: list[str] = []

    lines.append(f"Entreprise : {company_profile.get('company_name', 'N/A')}")

    years_exp = company_profile.get("years_experience")
    headcount = company_profile.get("staff_headcount")
    if years_exp:
        lines.append(f"Ancienneté : {years_exp} ans")
    if headcount:
        lines.append(f"Effectif : {headcount} collaborateurs")

    ca     = company_profile.get("annual_revenue")
    cash   = company_profile.get("available_cash")
    credit = company_profile.get("credit_line")
    if ca:
        lines.append(f"CA annuel : {_fmt_fcfa(ca)}")
    if cash:
        lines.append(f"Trésorerie : {_fmt_fcfa(cash)}")
    if credit:
        lines.append(f"Ligne de crédit : {_fmt_fcfa(credit)}")

    compliance = company_profile.get("fiscal_social_compliance")
    if compliance:
        lines.append(f"Conformité fiscale/sociale : {compliance}")

    insurance = company_profile.get("insurance_coverage")
    if insurance:
        lines.append(f"Assurances : {insurance}")

    certs = company_profile.get("certifications") or []
    if certs:
        cert_list = [
            f"{c.get('name', '')} ({c.get('issuer', '')} {c.get('year', '')})"
            for c in certs if c.get("name")
        ]
        lines.append(f"Certifications : {', '.join(cert_list)}")
    else:
        lines.append("Certifications : aucune renseignée")

    tech_qual = company_profile.get("technical_qualifications")
    if tech_qual:
        lines.append(f"Qualifications techniques : {tech_qual}")

    personnel = company_profile.get("personnel") or []
    if personnel:
        lines.append("Personnel clé :")
        for m in personnel[:5]:
            certs_m = ", ".join(m.get("certifications") or [])
            yexp    = m.get("years_experience", "")
            # Diplômes structurés (nouveau format) ou legacy string
            diplomas_raw = m.get("diplomas") or []
            if diplomas_raw and isinstance(diplomas_raw[0], dict):
                def _fmt_diploma(d: dict) -> str:
                    yrs = " ({} ans)".format(d["years_experience"]) if d.get("years_experience") else ""
                    return "{} {}{}".format(d.get("degree", ""), d.get("field", ""), yrs)
                diplomas_m = " / ".join(_fmt_diploma(d) for d in diplomas_raw[:3])
            else:
                diplomas_m = m.get("education", "")
            projects = m.get("projects_count")
            success  = m.get("success_rate")
            lines.append(
                f"  • {m.get('name', '?')} — {m.get('role', '?')}"
                f"{f', {yexp} ans exp.' if yexp else ''}"
                f"{f' | {projects} projets' if projects else ''}"
                f"{f' | réussite {success}%' if success else ''}"
                f"{f' | certs: {certs_m}' if certs_m else ''}"
                f"{f' | formation: {diplomas_m}' if diplomas_m else ''}"
            )

    projects = company_profile.get("past_projects") or []
    if projects:
        lines.append("Références :")
        for p in projects[:4]:
            budget = _fmt_fcfa(p["budget_fcfa"]) if p.get("budget_fcfa") else "N/A"
            lines.append(
                f"  • {p.get('title', '?')} — {p.get('client', '')} ({p.get('year', '')}) — {budget}"
            )

    competencies = company_profile.get("competencies") or []
    if competencies:
        comp_summary = "; ".join(
            f"{c.get('domain', '?')} ({', '.join((c.get('keywords') or [])[:4])})"
            for c in competencies[:4]
        )
        lines.append(f"Compétences : {comp_summary}")

    return "\n".join(lines)


# ─── Prompt ──────────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """\
Tu es un analyste senior en marchés publics africains (zones CEMAC, UEMOA) qui
conseille une entreprise de services numériques sur l'opportunité de soumissionner.
Tes analyses sont CONCRÈTES et propres à CHAQUE marché : tu cites l'objet réel et
l'autorité contractante, et tu relies chaque point aux éléments PRÉCIS du profil
(références nommées, certifications, experts, compétences, montants).
Tu bannis absolument les formules passe-partout (« l'entreprise semble qualifiée »,
« bonne expérience », « profil adapté ») : chaque phrase doit s'appuyer sur un fait
tiré du DAO ou du profil.
Tu réponds UNIQUEMENT en JSON valide, sans markdown, sans texte avant ou après.\
"""

def _format_kiama_signals(ctx: Optional[dict]) -> str:
    """Met en forme les signaux internes KIAMA (adéquation technique du MCDA +
    experts recommandés) pour les injecter dans le prompt — rend l'analyse Groq
    plus spécifique, surtout quand le texte du DAO est pauvre."""
    if not ctx:
        return ""
    lines: list[str] = []
    adq = ctx.get("adequation_technique")
    if adq is not None:
        try:
            lines.append(
                f"Adéquation technique (objet ↔ compétences entreprise, via embeddings) "
                f": {round(float(adq) * 100)}%"
            )
        except (TypeError, ValueError):
            pass
    experts = ctx.get("experts") or []
    fmt_experts: list[str] = []
    for e in experts[:3]:
        if not isinstance(e, dict) or not e.get("name"):
            continue
        fit = e.get("fit")
        fit_txt = f" — adéquation {round(float(fit) * 100)}%" if isinstance(fit, (int, float)) else ""
        comp = ", ".join((e.get("competences_match") or [])[:3])
        comp_txt = f" (compétences : {comp})" if comp else ""
        fmt_experts.append(f"{e.get('name')} ({e.get('role', '')}){fit_txt}{comp_txt}")
    if fmt_experts:
        lines.append("Experts internes recommandés pour ce marché : " + " ; ".join(fmt_experts))
    if not lines:
        return ""
    return "\n## Signaux internes KIAMA (à exploiter)\n" + "\n".join(lines) + "\n"


def _build_prompt(rc_text: str, profile_summary: str, kiama_signals: str = "") -> str:
    return f"""\
## DAO — Texte du Règlement de Consultation
{rc_text}

## Profil de l'entreprise candidate
{profile_summary}
{kiama_signals}
## Tâche
Analyse si cette entreprise peut soumissionner à CE marché précis.
Vérifie dans le texte du RC les exigences :
- Certifications (ISO, labels, agréments)
- Qualifications du personnel (expérience, diplômes, certifications)
- Références similaires (nombre de marchés, montants minimaux)
- Clauses disqualifiantes (redressement judiciaire, exclusions)
- Adéquation technique / domaine

Pour chaque exigence trouvée, compare-la au profil entreprise.
Si le RC ne mentionne pas d'exigence d'un type, ne crée pas de check.
Si le texte du DAO est limité (objet seul), concentre-toi sur l'adéquation entre
l'OBJET du marché et les compétences/références de l'entreprise.

## Style de réponse (IMPÉRATIF — sinon la réponse est inutile)
- SPÉCIFIQUE à ce marché : nomme l'objet et l'autorité contractante ; cite des
  éléments PRÉCIS du profil (une référence par son nom, une certification, un
  expert, un montant), jamais des généralités.
- INTERDIT : « l'entreprise semble qualifiée », « bonne expérience », « profil
  adapté », « répond aux exigences » sans preuve.
- Chaque `points_forts` / `points_bloquants` doit citer un fait concret.
  Mauvais : « Expérience pertinente ». Bon : « Référence SIGFIP 2023 (MINFI,
  120 M) proche de l'objet ».
- `resume` : 15 à 35 mots, propre à CE marché = (1) nature (domaine + autorité),
  (2) la raison clé d'y aller ou de s'en méfier, avec un élément concret.
  Mauvais : « L'entreprise est qualifiée pour ce marché. »
  Bon : « Refonte du SI du MINSANTE : forte adéquation (réf. GED CENAME 2022,
  experts AMOA), mais agrément ANTIC non renseigné — à vérifier. »
- Si des « Signaux internes KIAMA » figurent ci-dessus (adéquation technique,
  experts recommandés), APPUIE-toi dessus : nomme les experts recommandés dans
  `points_forts` et, si pertinent, dans le `resume` ; relie l'adéquation chiffrée
  à l'objet du marché.

Retourne UNIQUEMENT ce JSON (sans markdown) :
{{
  "checks": [
    {{
      "type": "certification|personnel|reference|disqualification|technique",
      "label": "Libellé court (< 8 mots)",
      "status": "ok|warning|blocking",
      "exigence": "Ce que le DAO exige exactement (cite le RC)",
      "profil": "Ce que l'entreprise possède (élément nommé du profil)",
      "detail": "Comparaison concrète en 1-2 phrases, avec le fait précis"
    }}
  ],
  "score_qualitatif": 0.75,
  "points_forts": ["Fait concret 1", "Fait concret 2"],
  "points_bloquants": ["Fait concret bloquant 1"],
  "resume": "Synthèse spécifique à ce marché (15-35 mots, voir consignes ci-dessus)"
}}

Règles de score :
- score_qualitatif = 1.0 si toutes les exigences sont satisfaites (ou aucune trouvée)
- score_qualitatif = 0.0–0.3 si au moins un check "blocking"
- score_qualitatif = 0.4–0.7 si des checks "warning" sans blocking
- score_qualitatif = 0.7–1.0 si uniquement des checks "ok"\
"""


# ─── Rate limiter global ─────────────────────────────────────────────────────
# Tier gratuit Groq : 6 000 TPM. Chaque requête ≈ 2 200 tokens.
# On sérialise les appels et on attend 25 s entre chaque pour rester sous la limite.

_groq_lock   = threading.Lock()
_last_call_ts: float = 0.0
_MIN_INTERVAL = 25.0   # secondes entre deux appels Groq


def _throttled_call(fn, *args, **kwargs):
    """Appel sérialisé + espacé d'au moins _MIN_INTERVAL secondes."""
    global _last_call_ts
    with _groq_lock:
        elapsed = time.monotonic() - _last_call_ts
        if elapsed < _MIN_INTERVAL:
            wait = _MIN_INTERVAL - elapsed
            logger.info("[Groq] Rate-limit throttle : attente %.1fs", wait)
            time.sleep(wait)
        result = fn(*args, **kwargs)
        _last_call_ts = time.monotonic()
        return result


# ─── Scorer ──────────────────────────────────────────────────────────────────

class GroqQualitativeScorer:
    """
    Évalue qualitativement un DAO via Groq API.
    Interface identique à l'ancien OllamaQualitativeScorer.
    """

    def __init__(
        self,
        api_key: str = GROQ_API_KEY,
        model: str = GROQ_MODEL,
    ) -> None:
        self.model   = model
        self._client = None
        self._ready  = False

        if not GROQ_ENABLED:
            logger.info("[Groq] Désactivé (GROQ_ENABLED=false)")
            return

        if not api_key:
            logger.warning("[Groq] GROQ_API_KEY absent — analyse qualitative désactivée")
            return

        try:
            from groq import Groq
            # timeout court + pas de retry : Groq best-effort. S'il ne répond pas,
            # on échoue vite et le scoring MCDA continue sans la couche qualitative
            # (au lieu de bloquer /predict jusqu'au timeout de 30 s du backend).
            self._client = Groq(api_key=api_key, timeout=10.0, max_retries=0)
            self._ready  = True
            logger.info("[Groq] Client initialisé — modèle : %s", model)
        except ImportError:
            logger.error("[Groq] Package 'groq' introuvable — pip install groq")
        except Exception as exc:
            logger.error("[Groq] Erreur initialisation : %s", exc)

    @property
    def is_available(self) -> bool:
        return self._ready

    # ── Appel API ──────────────────────────────────────────────────────────

    def _call_groq(self, prompt: str) -> str:
        response = self._client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user",   "content": prompt},
            ],
            temperature=0.1,
            max_tokens=1024,
        )
        return response.choices[0].message.content or ""

    # ── Parsing ────────────────────────────────────────────────────────────

    @staticmethod
    def _parse_response(raw: str) -> dict:
        m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.DOTALL)
        if m:
            raw = m.group(1)
        else:
            start = raw.find("{")
            end   = raw.rfind("}") + 1
            if start >= 0 and end > start:
                raw = raw[start:end]

        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("[Groq] JSON non parseable : %s…", raw[:200])
            return {}

        checks = data.get("checks", [])
        if not isinstance(checks, list):
            checks = []

        score = float(data.get("score_qualitatif", 0.5))
        score = max(0.0, min(1.0, score))

        has_blocking = any(c.get("status") == "blocking" for c in checks)
        if has_blocking and score > 0.3:
            score = min(score, 0.3)

        return {
            "checks":            checks,
            "score_qualitatif":  round(score, 3),
            "points_forts":      data.get("points_forts") or [],
            "points_bloquants":  data.get("points_bloquants") or [],
            "resume":            data.get("resume") or "",
            "ollama_available":  True,   # champ conservé pour compatibilité DB
        }

    # ── Point d'entrée ─────────────────────────────────────────────────────

    def score(self, dao_data: dict, company_profile: dict,
              decision_context: Optional[dict] = None) -> dict:
        if not self._ready:
            return dict(_FALLBACK)

        try:
            rc_text         = _extract_rc_text(dao_data)
            profile_summary = _summarize_profile(company_profile)
            kiama_signals   = _format_kiama_signals(decision_context)

            if not rc_text.strip() and not kiama_signals:
                return {
                    **_FALLBACK,
                    "ollama_available": True,
                    "resume": "Texte RC vide — analyse qualitative impossible.",
                }

            prompt = _build_prompt(rc_text, profile_summary, kiama_signals)
            logger.info("[Groq] Envoi requête — %d chars prompt", len(prompt))
            raw    = _throttled_call(self._call_groq, prompt)
            result = self._parse_response(raw)

            if not result:
                return {**_FALLBACK, "ollama_available": True}

            logger.info(
                "[Groq] score_qual=%.3f checks=%d",
                result.get("score_qualitatif", 0),
                len(result.get("checks") or []),
            )
            return result

        except Exception as exc:
            logger.warning("[Groq] Erreur : %s", exc)
            return dict(_FALLBACK)


# ─── Singleton ────────────────────────────────────────────────────────────────

_scorer_instance: Optional[GroqQualitativeScorer] = None


def get_scorer() -> GroqQualitativeScorer:
    global _scorer_instance
    if _scorer_instance is None:
        _scorer_instance = GroqQualitativeScorer()
    return _scorer_instance
