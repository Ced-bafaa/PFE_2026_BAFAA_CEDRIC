# -*- coding: utf-8 -*-
"""
Filtre de pertinence IT / non-IT — HYBRIDE (mots-clés + sémantique).

Ordre de priorité (entonnoir : du moins cher/plus décisif au plus cher/plus fin) :
  P1  whitelist IT (mots-clés)      -> "IT" si un terme IT explicite est présent
  P2  blacklist non-IT (mots-clés)  -> "non-IT" (sinon, et si aucun terme IT)
  P3  sémantique (embeddings)       -> sur le texte nettoyé, pour le reste (ambigu)

Justifié par l'expérience (juin 2026) : sur les titres ARMP bruts, le sémantique seul
s'effondre (pavé administratif qui dilue le signal). Les mots-clés sont fiables et
immunisés au bruit ; le sémantique rattrape les paraphrases sans mot-clé.

Activation du modèle : SEMANTIC_FILTER_ENABLED=true (défaut false). La couche mots-clés
fonctionne même sans modèle (dégradation gracieuse côté sémantique uniquement).

Paramètres validés (golden set) : modèle paraphrase-multilingual-mpnet-base-v2, eps=0.05.
"""
from __future__ import annotations

import logging
import os
import re
import threading
import unicodedata
from typing import Optional

logger = logging.getLogger(__name__)

# ─── Configuration ─────────────────────────────────────────────────────────────
SEMANTIC_FILTER_ENABLED = os.environ.get("SEMANTIC_FILTER_ENABLED", "false").lower() == "true"
SEMANTIC_MODEL = os.environ.get("SEMANTIC_MODEL", "paraphrase-multilingual-mpnet-base-v2")
SEMANTIC_EPS = float(os.environ.get("SEMANTIC_EPS", "0.05"))
SEMANTIC_CACHE_DIR = os.environ.get("SEMANTIC_CACHE_DIR") or None

# ─── Prototypes (pôles du sémantique) ──────────────────────────────────────────
PROTO_IT = [
    "Développement, acquisition ou maintenance de logiciels et d'applications web et mobiles",
    "Conception et intégration de progiciels de gestion intégrée (ERP), SIRH, SIGFIP, SIGIPES",
    "Gestion électronique de documents (GED), archivage électronique et système d'information",
    "Fourniture et installation de matériel informatique : ordinateurs, serveurs, imprimantes, scanners, onduleurs",
    "Fourniture de consommables informatiques, périphériques et pièces détachées informatiques",
    "Équipement de salles informatiques et de laboratoires numériques",
    "Réseaux informatiques et télécommunications : LAN, fibre optique, câblage structuré, VSAT, interconnexion",
    "Téléphonie IP, visioconférence et équipements de télécommunication",
    "Cybersécurité, audit de sécurité, pare-feu et protection des systèmes d'information",
    "Cloud, datacenter, virtualisation, hébergement et infrastructure informatique",
    "Données, business intelligence, big data et intelligence artificielle",
    "E-gouvernement, dématérialisation, numérisation et plateformes en ligne",
    "Maintenance informatique, support technique et tierce maintenance applicative",
    "Solutions biométriques, cartes à puce, identification et contrôle d'accès informatisé",
    "Vidéosurveillance et systèmes électroniques de sécurité et de supervision",
]
PROTO_NON_IT = [
    "Travaux de construction, génie civil et réhabilitation de bâtiments",
    "Construction et réhabilitation de routes, voirie, bitumage et ouvrages d'art",
    "Adduction d'eau potable, forages, assainissement et réseaux d'eau",
    "Électrification, réseau électrique, énergie solaire et éclairage public",
    "Matériel et intrants agricoles, semences, engrais et équipements ruraux",
    "Équipements et matériels médicaux, produits pharmaceutiques et consommables hospitaliers",
    "Mobilier de bureau, mobilier scolaire (tables-bancs) et fournitures de bureau",
    "Fourniture de matériels et équipements divers hors informatique",
    "Acquisition de véhicules, matériel roulant, engins, motos et pièces détachées",
    "Fourniture de carburant, lubrifiants et gaz",
    "Gardiennage, sécurité et surveillance",
    "Nettoyage, entretien des locaux et espaces verts",
    "Restauration, traiteur et fourniture de denrées alimentaires",
    "Impression, imprimerie, reprographie et édition",
    "Climatisation, froid, plomberie et électricité du bâtiment",
    "Confection d'uniformes, habillement et textile",
    "Études, formation, audit et assistance technique hors informatique",
    "Communication, événementiel, publicité et reportage",
]

# ─── Couche mots-clés (P1 / P2) ─────────────────────────────────────────────────
# Termes normalisés (minuscules, sans accents). Whitelist CURÉE : on retire les
# termes trop larges ("numérique", "digital" seuls) qui créaient des faux positifs
# (ex. AO d'énergie solaire « numérique »).
WHITELIST_IT = [
    "informatiq", "logiciel", "progiciel", "ordinateur", "serveur", "antivirus",
    "imprimante", "scanner", "onduleur", "reseau informatiq", "cablage informatiq",
    "fibre optiq", "datacenter", "telecommunicat", "cybersecur", "biometr",
    "application web", "application mobile", "application de gestion", "site web",
    "intranet", "dematerialis", "gestion electronique de document", "e-gouvern",
    "egouvern", "systeme d'information", "systeme d information", "numerisation",
    "bureautiq", "maintenance informatiq", "virtualisation", "sigfip", "sigipes",
    # Prestations intellectuelles / transformation numérique (formulations d'AMI).
    # Termes IT SANS AMBIGUÏTÉ uniquement — « plateforme »/« portail » SEULS restent
    # exclus (on n'ajoute que les formes qualifiées), de même que « schéma directeur »
    # ou « audit » seuls (qui existent aussi en BTP/comptabilité).
    "portail web", "portail numerique", "portail en ligne",
    "plateforme numerique", "plateforme web", "plateforme informatique",
    "plateforme digitale", "plateforme en ligne", "plateforme de gestion",
    "transformation numerique", "transformation digitale", "strategie numerique",
    "digitalisation", "informatisation", "schema directeur informatiq",
    "audit informatiq",
]
# Marqueurs de DOMAINE non-IT, EXPLICITES et organisés par secteur. On n'y met
# PAS de verbes d'action ambigus (« travaux », « aménagement ») : ils existent
# aussi en IT (« travaux de câblage réseau »). Quand un objet ne contient ni
# mot-clé IT (P1) ni marqueur de domaine ci-dessous (P2), c'est le sémantique
# (P3) qui tranche — pas un rejet sec sur un mot fourre-tout.
BLACKLIST_NON_IT = [
    # BTP / génie civil
    "route", "routier", "voirie", "bitumage", "pave", "ouvrage d'art",
    "ouvrage d art", "batiment", "immeuble", "pont", "genie civil",
    "voie urbaine", "amenagement urbain", "toiture", "plomberie",
    # Eau / assainissement
    "forage", "adduction", "eau potable", "assainissement",
    # Énergie / électricité
    "electrification", "reseau electriq", "eclairage public", "solaire", "energie",
    # Agriculture
    "agricole", "semence", "engrais", "intrant",
    # Mobilier / fournitures non-IT
    "mobilier", "tables-bancs", "table-banc",
    # Santé
    "medica", "pharmaceutiq", "hospital",
    # Transport / matériel roulant
    "vehicule", "engin", "moto", "carburant", "lubrifiant",
    # Habillement / textile
    "uniforme", "habillement", "textile",
    # Services généraux
    "gardiennage", "nettoyage", "espaces verts", "restauration",
    "traiteur", "denree", "climatisation",
    # Audit / comptabilité (hors IT)
    "audit comptable", "cabinet comptable",
]


def _na(s: str) -> str:
    # Normalise les apostrophes typographiques (’ ‘ ʼ ` ´) en apostrophe droite :
    # les titres ARMP utilisent ’, alors que les mots-clés sont écrits avec ' —
    # sans ça, « système d'information » ne matchait pas « systeme d'information ».
    s = (s or "").lower()
    for ch in ("’", "‘", "ʼ", "`", "´"):
        s = s.replace(ch, "'")
    return "".join(c for c in unicodedata.normalize("NFD", s)
                   if unicodedata.category(c) != "Mn")


def _kw_hit(text: str, kws) -> Optional[str]:
    t = _na(text)
    for k in kws:
        if k in t:
            return k
    return None


# ─── Nettoyage du titre ARMP : on isole l'OBJET du marché ───────────────────────
# Toutes les couches (P1 mot-clé, P2 blacklist, P3 sémantique) tournent désormais sur
# cet objet, pas sur le titre brut — pour ne pas se faire piéger par le boilerplate
# administratif (financement, instructions de dépôt, « plateforme COLEPS », clé USB,
# références N°…). C'est ce boilerplate qui retenait à tort un additif « travaux ».

# Pliage d'accents SANS changer la longueur (indices alignés pour la découpe de queue).
_ACC = str.maketrans("àáâäãéèêëíìîïóòôöõúùûüçñ", "aaaaaeeeeiiiiooooouuuucn")


def _fold(s: str) -> str:
    return (s or "").lower().translate(_ACC)


# Recolle les marqueurs soudés par l'extraction PDF : « 2026POUR », « YAOUNDEFINANCEMENT ».
_DEGLUE = re.compile(
    r"(?i)([0-9a-zàâäéèêëîïôöùûüç])"
    r"(POUR|FINANCEMENT|IMPUTATION|EXERCICE|RELATIFS?|LANCE)\b"
)

# Début de l'objet : ce qui suit POUR / RELATIF À / EN VUE DE / AYANT POUR OBJET.
_PREFIX = re.compile(
    r"(?:\bPOUR\b|\bRELATIFS?\s+[ÀA]\b|\bEN VUE D[EU']|\bAYANT POUR OBJET\b"
    r"|\bD[ÉE]SIGNATION DE LA MISSION\b|\bINTITUL[ÉE] DE LA MISSION\b"
    r"|\bOBJET DE LA (?:MISSION|CONSULTATION|DEMANDE|PRESTATION)\b|\bOBJET\b\s*:)"
    r"\s*:?\s*(.+)",
    re.I,
)

# Fin de l'objet : début du boilerplate administratif / instructions de dépôt.
# (Comparé sans accents, longueur préservée → on coupe le titre original au bon index.)
_TAIL_MARKERS = (
    "financement", "imputation", "exercice", "budget d",
    "en un ", "en deux", "en trois", "en quatre",
    "en procedure", "au point", "remise des offres", "la remise",
    "plateforme coleps", "coleps", "copie de sauvegarde", "pli scelle",
    "a n'ouvrir", "a nouvrir", "depouillement", "au lieu de",
)
_REF = re.compile(r"N[°ºo]\s*[\w./\-]+")


def clean_title(t: str) -> str:
    """Isole l'objet d'un titre ARMP : recolle les marqueurs soudés, retire l'en-tête
    (jusqu'à POUR / RELATIF À), coupe la queue administrative et les instructions de
    dépôt, supprime les références N°…. Renvoie '' si rien d'exploitable."""
    t = re.sub(r"\s+", " ", t or "").strip()
    t = _DEGLUE.sub(r"\1 \2", t)
    m = _PREFIX.search(t)
    if m:
        t = m.group(1)
    tn = _fold(t)
    idxs = [tn.find(k) for k in _TAIL_MARKERS if tn.find(k) > 0]
    if idxs:
        t = t[: min(idxs)]
    t = _REF.sub(" ", t)
    return re.sub(r"\s+", " ", t).strip()


_UNKNOWN = {"label": "inconnu", "pertinent": True, "raison": "filtre indisponible",
            "diff": None, "sim_it": None, "sim_non": None, "available": False}


def _expert_text(p: dict) -> str:
    """Texte-profil d'un expert pour la comparaison sémantique à l'objet d'un AO."""
    return " — ".join(filter(None, [
        str(p.get("role", "")),
        ", ".join(p.get("skills", []) or []),
        ", ".join(p.get("certifications", []) or []),
    ]))


def _profile_terms(profile: dict) -> set:
    """Ensemble normalisé des termes de capacité d'une organisation :
    mots-clés de compétences + domaines + référentiel technologies."""
    terms = set()
    for c in (profile.get("competencies") or []):
        for kw in (c.get("keywords") or []):
            if kw:
                terms.add(_na(str(kw)))
        d = c.get("domain")
        if d:
            terms.add(_na(str(d)))
    for d in (profile.get("domaines") or []):
        if d:
            terms.add(_na(str(d)))
    for t in (profile.get("technologies_catalog") or []):
        if t:
            terms.add(_na(str(t)))
    return {t for t in terms if t}


def _partner_text(p: dict) -> str:
    """Texte-profil d'un partenaire (entreprise) pour la comparaison sémantique."""
    doms = ", ".join(p.get("domaines") or [])
    kws = ", ".join(
        str(kw) for c in (p.get("competencies") or []) for kw in (c.get("keywords") or []) if kw
    )
    return " — ".join(filter(None, [
        str(p.get("company_name", "")),
        doms,
        kws,
        str(p.get("strengths", "")),
    ]))


class SemanticRelevanceFilter:
    """Classe un objet d'AO en IT / non-IT / à vérifier par le pipeline hybride."""

    def __init__(self, model_name: str = SEMANTIC_MODEL, eps: float = SEMANTIC_EPS,
                 cache_dir: Optional[str] = SEMANTIC_CACHE_DIR, enabled: Optional[bool] = None) -> None:
        self.model_name = model_name
        self.eps = eps
        self.cache_dir = cache_dir
        self._np = None
        self._model = None
        self._is_e5 = "e5" in model_name.lower()
        self._cen_it = None
        self._cen_non = None
        self._ready = False
        self._pcache: dict = {}  # cache d'embeddings 'passage' (profil, experts)

        enabled = SEMANTIC_FILTER_ENABLED if enabled is None else enabled
        if not enabled:
            logger.info("[SemanticFilter] sémantique désactivé (mots-clés actifs)")
            return
        self._try_init()

    def _try_init(self) -> None:
        try:
            import numpy as np
            from sentence_transformers import SentenceTransformer
            self._np = np
            self._model = SentenceTransformer(self.model_name, cache_folder=self.cache_dir)
            self._cen_it = self._centroid(PROTO_IT)
            self._cen_non = self._centroid(PROTO_NON_IT)
            self._ready = True
            logger.info("[SemanticFilter] prêt — modèle %s, eps=%.3f", self.model_name, self.eps)
        except Exception as exc:  # pragma: no cover
            logger.warning("[SemanticFilter] sémantique indisponible (%s) — mots-clés seuls", exc)
            self._ready = False

    @property
    def is_available(self) -> bool:
        return self._ready

    def _encode(self, texts, kind: str = "passage"):
        if isinstance(texts, str):
            texts = [texts]
        if self._is_e5:
            prefix = "query: " if kind == "query" else "passage: "
            texts = [prefix + t for t in texts]
        return self._model.encode(texts, convert_to_numpy=True, normalize_embeddings=True)

    def _encode_passage_cached(self, text: str):
        """Embedding 'passage' avec cache : le profil entreprise et les fiches
        experts sont identiques d'un /predict à l'autre — inutile de les ré-encoder."""
        v = self._pcache.get(text)
        if v is None:
            v = self._encode(text, kind="passage")[0]
            self._pcache[text] = v
        return v

    def _centroid(self, texts):
        v = self._encode(texts, kind="passage")
        c = v.mean(axis=0)
        return c / self._np.linalg.norm(c)

    # ── API publique : pipeline hybride ─────────────────────────────────────────
    def classify(self, objet: str) -> dict:
        raw = objet or ""
        # On isole l'OBJET du marché et on classe CET objet (pas le titre brut).
        obj = clean_title(raw)
        if len(obj) < 8:  # extraction vide / trop courte → repli sur le titre normalisé
            obj = re.sub(r"\s+", " ", raw).strip()
        # P1 — mot-clé IT (immunisé au bruit, fiable, gratuit)
        kw = _kw_hit(obj, WHITELIST_IT)
        if kw:
            return {"label": "IT", "pertinent": True, "raison": "mot-clé IT: " + kw,
                    "objet_nettoye": obj, "diff": None, "sim_it": None, "sim_non": None,
                    "available": self._ready}
        # P2 — mot-clé non-IT (écarte le bruit évident sans dépenser le modèle)
        bl = _kw_hit(obj, BLACKLIST_NON_IT)
        if bl:
            return {"label": "non-IT", "pertinent": False, "raison": "mot-clé non-IT: " + bl,
                    "objet_nettoye": obj, "diff": None, "sim_it": None, "sim_non": None,
                    "available": self._ready}
        # P3 — sémantique sur l'objet nettoyé (cas ambigu / paraphrases)
        if not self._ready:
            d = dict(_UNKNOWN)
            d["objet_nettoye"] = obj
            return d
        v = self._encode(obj, kind="query")[0]
        sim_it = float(v @ self._cen_it)
        sim_non = float(v @ self._cen_non)
        diff = sim_it - sim_non
        if diff >= self.eps:
            label = "IT"
        elif diff <= -self.eps:
            label = "non-IT"
        else:
            label = "à vérifier"
        return {"label": label, "pertinent": label != "non-IT", "raison": "sémantique",
                "objet_nettoye": obj, "diff": round(diff, 4), "sim_it": round(sim_it, 4),
                "sim_non": round(sim_non, 4), "available": True}

    def is_relevant(self, objet: str) -> bool:
        return self.classify(objet)["pertinent"]

    # ── Recommandation de personnel par adéquation à l'objet d'un AO ─────────────
    def recommend_experts(self, objet: str, personnel: list, top_n: int = 3) -> list:
        """Classe les experts du roster par adéquation à l'objet d'un AO.

        Sémantique si le modèle est chargé (profil de la personne ↔ objet de l'AO) ;
        repli sur le recouvrement de compétences sinon. Renvoie les `top_n` meilleurs
        avec leur score d'adéquation, les compétences qui matchent et la disponibilité.
        Complète `qualify_personnel` (exigences du DAO) : ici on recommande même
        quand le DAO n'exprime pas d'exigence de personnel explicite.
        """
        obj = clean_title(objet) or (objet or "")
        people = [p for p in (personnel or []) if p.get("name")]
        if not people:
            return []
        out = []
        if self._ready:
            ov = self._encode(obj, kind="query")[0]
            for p in people:
                ev = self._encode_passage_cached(_expert_text(p))
                out.append((float(ev @ ov), "sémantique", p))
        else:
            objn = _na(obj)
            for p in people:
                sk = p.get("skills") or []
                matched = [s for s in sk if _na(s) in objn]
                out.append((len(matched) / (len(sk) or 1), "recouvrement", p))
        out.sort(key=lambda t: t[0], reverse=True)
        res = []
        objn = _na(obj)
        for fit, base, p in out[:top_n]:
            # Affichage : le cosinus brut (~0.15–0.55) est rééchelonné sur [0,1]
            # pour un % d'adéquation lisible (un bon match ~70–90 %).
            disp = max(0.0, min(1.0, (fit - 0.15) / 0.40)) if base == "sémantique" else float(fit)
            res.append({
                "name": p.get("name"), "role": p.get("role"),
                "fit": round(disp, 4), "fit_brut": round(float(fit), 4), "base": base,
                "competences_match": [s for s in (p.get("skills") or []) if _na(s) in objn],
                "disponibilite": p.get("availability"),
            })
        return res

    # ── Recommandation de PARTENAIRES par complémentarité (groupement) ───────────
    def recommend_partners(
        self, objet: str, own_profile: dict, partners: list, top_n: int = 3
    ) -> list:
        """Recommande des partenaires pour un GROUPEMENT sur un AO donné.

        Symétrique de `recommend_experts`, mais raisonne à l'échelle de
        l'organisation ET par COMPLÉMENTARITÉ : on privilégie les partenaires qui
        COMBLENT les lacunes de l'entreprise sur cet AO (compétences/domaines que
        l'AO évoque, que le partenaire couvre et que l'entreprise ne couvre pas),
        pondérées par l'adéquation sémantique du partenaire à l'objet du marché.
        """
        obj = clean_title(objet) or (objet or "")
        objn = _na(obj)
        plist = [p for p in (partners or []) if p.get("id")]
        if not plist:
            return []

        company_cov = _profile_terms(own_profile or {})
        ov = self._encode(obj, kind="query")[0] if self._ready else None

        scored = []
        for p in plist:
            p_terms = _profile_terms(p)
            # Termes que l'AO évoque, que le partenaire couvre, et que l'entreprise NE couvre PAS.
            comble = sorted({t for t in p_terms if t and t in objn and t not in company_cov})

            if self._ready and ov is not None:
                pv = self._encode_passage_cached(_partner_text(p))
                raw = float(pv @ ov)
                adequation = max(0.0, min(1.0, (raw - 0.15) / 0.40))
                base = "sémantique"
            else:
                hits = [t for t in p_terms if t and t in objn]
                adequation = len(hits) / (len(p_terms) or 1)
                base = "recouvrement"

            complement = min(1.0, len(comble) / 3.0)
            # 55 % adéquation à l'objet + 45 % apport complémentaire (comblement des lacunes).
            fit = round(0.55 * adequation + 0.45 * complement, 4)
            domaines_match = [d for d in (p.get("domaines") or []) if _na(str(d)) in objn]
            scored.append((fit, adequation, base, comble, domaines_match, p))

        # On ne garde que les partenaires qui apportent quelque chose.
        scored = [s for s in scored if s[0] > 0]
        # Tri : ceux qui comblent une lacune d'abord, puis par adéquation globale.
        scored.sort(key=lambda t: (len(t[3]) > 0, t[0]), reverse=True)

        res = []
        for fit, adequation, base, comble, domaines_match, p in scored[:top_n]:
            res.append({
                "id": p.get("id"),
                "company_name": p.get("company_name"),
                "fit": fit,
                "adequation": round(float(adequation), 4),
                "base": base,
                "comble": comble,
                "domaines_match": domaines_match,
            })
        return res


_instance: Optional[SemanticRelevanceFilter] = None
_instance_lock = threading.Lock()


def get_filter() -> SemanticRelevanceFilter:
    global _instance
    if _instance is None:
        with _instance_lock:
            if _instance is None:
                _instance = SemanticRelevanceFilter()
    return _instance
