import os
import re
import unicodedata
from dataclasses import dataclass
from datetime import date

import pdfplumber
import pytesseract
from pdf2image import convert_from_path

from core.utils import clean_amount, clean_text

# Chemin vers Tesseract. Surchargé par la variable d'environnement TESSERACT_CMD.
# Par défaut : emplacement Windows habituel. S'il n'existe pas (ex. Linux/Docker),
# on ne force rien → pytesseract utilise le binaire `tesseract` du PATH.
_TESSERACT_CMD = os.environ.get(
    "TESSERACT_CMD", r"C:\Program Files\Tesseract-OCR\tesseract.exe"
)
if os.path.isfile(_TESSERACT_CMD):
    pytesseract.pytesseract.tesseract_cmd = _TESSERACT_CMD

_CURRENCY_RE = re.compile(r"\b(?:FCFA|CFAF|XAF|F\s*CFA|francs?\s*CFA)\b", re.IGNORECASE)


_MONTHS_FR = {
    "janvier": 1,
    "janv": 1,
    "février": 2,
    "fevrier": 2,
    "févr": 2,
    "fevr": 2,
    "mars": 3,
    "avril": 4,
    "avr": 4,
    "mai": 5,
    "juin": 6,
    "juillet": 7,
    "juil": 7,
    "août": 8,
    "aout": 8,
    "septembre": 9,
    "sept": 9,
    "octobre": 10,
    "oct": 10,
    "novembre": 11,
    "nov": 11,
    "décembre": 12,
    "decembre": 12,
    "déc": 12,
    "dec": 12,
}




# ══════════════════════════════════════════════════════════════════════════════
# Exigences de personnel : extraction structurée
# ------------------------------------------------------------------------------
# Produit, pour chaque rôle exigé par le DAO :
#   { poste, effectif_min, experience_min_annees, diplome,
#     certifications: [[alternatives OU], ...], snippet }
# Dédoublonné par poste (critère le plus strict conservé). Consommé par la
# qualification déterministe du decision engine (core_logic.qualify_personnel).
# ══════════════════════════════════════════════════════════════════════════════

_PERSONNEL_ROLES = [
    "Chef de projet",
    "Project manager",
    "Architecte",
    "Ingénieur",
    "Ingenieur",
    "Développeur",
    "Developpeur",
    "Expert sécurité",
    "Expert securite",
    "Administrateur",
    "DBA",
    "DevOps",
    "Analyste",
    "Consultant",
]

# (clé de recherche, libellé canonique) — clés longues en premier
_CERT_CANON = [
    ("iso 27001", "ISO 27001"),
    ("iso27001", "ISO 27001"),
    ("iso 9001", "ISO 9001"),
    ("scrum master", "Scrum Master"),
    ("aws certified", "AWS Certified"),
    ("prince 2", "Prince2"),
    ("prince2", "Prince2"),
    ("comptia", "CompTIA"),
    ("cissp", "CISSP"),
    ("togaf", "TOGAF"),
    ("cobit", "COBIT"),
    ("itil", "ITIL"),
    ("cisa", "CISA"),
    ("cism", "CISM"),
    ("ccnp", "CCNP"),
    ("ccna", "CCNA"),
    ("pmp", "PMP"),
    ("ceh", "CEH"),
    ("psm", "PSM"),
]

_NUM_WORDS_FR = {
    "un": 1, "une": 1, "deux": 2, "trois": 3, "quatre": 4, "cinq": 5,
    "six": 6, "sept": 7, "huit": 8, "neuf": 9, "dix": 10,
}


def _pc_norm(s: str) -> str:
    out = "".join(c for c in unicodedata.normalize("NFD", str(s or "")) if unicodedata.category(c) != "Mn")
    return out.lower().strip()


def _pc_degree_rank(label: str) -> int:
    n = _pc_norm(label)
    if not n:
        return 0
    m = re.search(r"bac\s*\+\s*(\d)", n)
    if m:
        v = int(m.group(1))
        return 5 if v >= 5 else max(v, 1)
    for keys, rank in (
        (("doctorat", "phd"), 6),
        (("master", "ingenieur", "dess", "dea", "mba"), 5),
        (("maitrise",), 4),
        (("licence", "bachelor"), 3),
        (("bts", "dut"), 2),
    ):
        if any(k in n for k in keys):
            return rank
    return 0


def _pc_headcount(left_context: str) -> int:
    """Effectif exigé, lu juste avant le rôle : « Deux (02) Ingénieurs », « Trois développeurs »."""
    tail = _pc_norm(left_context)[-30:]
    m = re.search(r"\((\d{1,2})\)\s*$", tail)
    if m:
        v = int(m.group(1))
        if 1 <= v <= 20:
            return v
    m = re.search(r"\b([a-z]+)\s*$", tail)
    if m and m.group(1) in _NUM_WORDS_FR:
        return _NUM_WORDS_FR[m.group(1)]
    m = re.search(r"\b(\d{1,2})\s*$", tail)
    if m:
        v = int(m.group(1))
        if 1 <= v <= 20:
            return v
    return 1


def _pc_certifications(segment: str) -> list[list[str]]:
    """Certifications du segment ; « X ou Y » rapprochés → groupe d'alternatives (OU)."""
    low = _pc_norm(segment)
    found = []  # (start, end, canon)
    seen = set()
    for key, canon in _CERT_CANON:
        if canon in seen:
            continue
        m = re.search(rf"\b{re.escape(key)}\b", low)
        if m:
            found.append((m.start(), m.end(), canon))
            seen.add(canon)
    found.sort()

    groups: list[list[str]] = []
    last_end = None
    for start, end, canon in found:
        if groups and last_end is not None:
            between = low[last_end:start]
            if len(between) <= 30 and (" ou " in f" {between} " or "/" in between):
                groups[-1].append(canon)
                last_end = end
                continue
        groups.append([canon])
        last_end = end
    return groups


def extract_personnel_cle_struct(text) -> list[dict]:
    """
    Extrait les exigences de personnel d'un bloc « Personnel clé ».
    Le segment d'analyse d'un rôle s'arrête au rôle suivant pour éviter
    qu'un critère ne contamine le voisin.
    """
    if not text:
        return []

    # Rôles les plus longs d'abord, dédoublonnés par position
    matches: dict[int, str] = {}
    for role in sorted(_PERSONNEL_ROLES, key=len, reverse=True):
        for m in re.finditer(re.escape(role), text, flags=re.IGNORECASE):
            matches.setdefault(m.start(), role)
    if not matches:
        return []

    positions = sorted(matches.items())
    raw: list[dict] = []
    for idx, (pos, role) in enumerate(positions):
        next_pos = positions[idx + 1][0] if idx + 1 < len(positions) else len(text)
        left = text[max(0, pos - 40):pos]
        seg = text[pos:min(len(text), pos + 260, max(next_pos, pos + 1))]

        exp = 0
        m_exp = re.search(r"\b(\d{1,2})\s*(?:ans?|ann[eé]es?)\b", seg, flags=re.IGNORECASE)
        if m_exp:
            try:
                exp = int(m_exp.group(1))
            except Exception:
                exp = 0

        diplome = ""
        m_dip = re.search(
            r"\b(Bac\+?\s*\d|Licence|Master|Ing[eé]nieur|Doctorat|PhD|DESS|DEA)\b",
            seg,
            flags=re.IGNORECASE,
        )
        if m_dip:
            diplome = clean_text(m_dip.group(0))

        raw.append({
            "poste": role,
            "effectif_min": _pc_headcount(left),
            "experience_min_annees": exp,
            "diplome": diplome,
            "certifications": _pc_certifications(seg),
            "snippet": clean_text(text[max(0, pos - 40):pos + 260])[:240],
        })

    # Dédoublonnage par poste : critère le plus strict conservé
    merged: dict[str, dict] = {}
    for r in raw:
        key = _pc_norm(r["poste"])
        cur = merged.get(key)
        if cur is None:
            merged[key] = r
            continue
        cur["experience_min_annees"] = max(cur["experience_min_annees"], r["experience_min_annees"])
        if _pc_degree_rank(r["diplome"]) > _pc_degree_rank(cur["diplome"]):
            cur["diplome"] = r["diplome"]
        for grp in r["certifications"]:
            if grp not in cur["certifications"]:
                cur["certifications"].append(grp)
        cur["effectif_min"] = max(cur["effectif_min"], r["effectif_min"])

    return list(merged.values())[:40]


def _clean_block_keep_lines(s: str) -> str:
    """
    Nettoyage "NLP ready" : conserve les retours ligne (structure),
    réduit les espaces, supprime les lignes vides redondantes.
    """
    if not s:
        return ""
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def _parse_date_to_iso(text: str) -> str:
    """
    Extrait une date et la normalise en ISO (YYYY-MM-DD).
    Retourne "" si non détectée.
    """
    if not text:
        return ""
    s = " ".join(str(text).split())

    # 1) dd/mm/yyyy ou dd-mm-yyyy
    m = re.search(r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b", s)
    if m:
        try:
            d = date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
            return d.isoformat()
        except Exception:
            return ""

    # 2) "04 Octobre 2021"
    m = re.search(r"\b(\d{1,2})\s+([A-Za-zéèêëàâîïôùûüç\.]+)\s+(\d{4})\b", s)
    if m:
        day = int(m.group(1))
        mon_raw = m.group(2).lower().strip(".")
        year = int(m.group(3))
        mon = _MONTHS_FR.get(mon_raw)
        if mon:
            try:
                return date(year, mon, day).isoformat()
            except Exception:
                return ""
    return ""


def _extract_all_dates_iso(text: str, limit: int = 10) -> list[str]:
    if not text:
        return []
    s = str(text)
    dates = []
    for m in re.finditer(r"\b(\d{1,2}[/-]\d{1,2}[/-]\d{4})\b", s):
        iso = _parse_date_to_iso(m.group(1))
        if iso:
            dates.append(iso)
        if len(dates) >= limit:
            break
    if len(dates) < limit:
        for m in re.finditer(r"\b(\d{1,2}\s+[A-Za-zéèêëàâîïôùûüç\.]+\s+\d{4})\b", s):
            iso = _parse_date_to_iso(m.group(1))
            if iso:
                dates.append(iso)
            if len(dates) >= limit:
                break
    # uniq, stable
    out = []
    seen = set()
    for d in dates:
        if d not in seen:
            out.append(d)
            seen.add(d)
    return out


def _noise_ratio(text: str) -> float:
    """
    Heuristique de bruit OCR/extraction : proportion de caractères "anormaux".
    Objectif: forcer l'OCR si le texte extrait est peu fiable.
    """
    if not text:
        return 1.0
    s = str(text)
    allowed_punct = set(".,;:?!'’\"()[]{}<>-–—/\\|_+=*&%$#@°º \t\n")
    noisy = 0
    total = 0
    for ch in s:
        total += 1
        if ch == "�":
            noisy += 1
            continue
        if ch.isalnum() or ch.isspace() or ch in allowed_punct:
            continue
        # Accepter la plupart des lettres accentuées via isalpha
        if ch.isalpha():
            continue
        noisy += 1
    return noisy / max(1, total)


def _currency_amount_candidates(
    text: str,
    *,
    min_digits: int = 6,
    ctx_window: int = 50,
    limit: int = 80,
) -> list[int]:
    """
    Extrait des montants (int) UNIQUEMENT si un indice de devise (FCFA/CFAF/XAF/...)
    apparaît dans une fenêtre locale autour du nombre.

    Objectif: éliminer les faux positifs (téléphones, codes, numéros divers) lors de l'extraction
    de budget/caution.
    """
    if not text:
        return []
    s = str(text)
    out: list[int] = []
    for m in re.finditer(r"\b(\d[\d\s]{4,})\b", s):
        raw = m.group(1)
        digits = re.sub(r"\s", "", raw)
        if not digits.isdigit():
            continue
        if len(digits) < min_digits:
            continue
        val = int(digits)
        if val <= 0 or val > 100_000_000_000:
            continue
        left = max(0, m.start() - ctx_window)
        right = min(len(s), m.end() + ctx_window)
        ctx = s[left:right]
        if not _CURRENCY_RE.search(ctx):
            continue
        out.append(val)
        if len(out) >= limit:
            break
    return out


# ══════════════════════════════════════════════════════════════════════════════
# C1 — Extraction financière robuste (caution, CA min, ligne de crédit)
# ------------------------------------------------------------------------------
# Fonctions module-level (pures, testables unitairement) délivrant les montants
# RÉELLEMENT exigés par le DAO. Elles alimentent les features du decision engine
# (ratio_ca, ratio_credit, poids_caution) — sans elles, tout retombe sur les
# valeurs par défaut et le score se fige.
# ══════════════════════════════════════════════════════════════════════════════

_CAUTION_KEYWORD_RE = re.compile(
    r"(?:cautionnement|caution|garantie)\s+"
    r"(?:provisoire|de\s+soumission|de\s+l['’]offre|d['’]offre)",
    re.IGNORECASE,
)

_VALIDITE_RE = re.compile(
    r"valable\s+(?:pendant|jusqu['’][aà])\s+([^\n]{3,120})", re.IGNORECASE
)


def extract_caution_global_struct(raw_text: str) -> dict:
    """
    Montant de la caution / cautionnement de soumission.

    Robuste aux libellés multiples ('cautionnement provisoire', 'caution de
    soumission', 'garantie de soumission') : on scanne TOUTES les occurrences,
    on récolte les montants en devise (>= 6 chiffres — ce qui exclut
    naturellement les frais d'achat du DAO libellés '(25 000)'), et on retient
    le minimum (la caution est petite face au budget).
    """
    raw = raw_text or ""
    if not raw:
        return {"text": "", "valeur": 0, "validite": ""}

    cands: list[int] = []
    best_text = ""
    for m in _CAUTION_KEYWORD_RE.finditer(raw):
        seg = _clean_block_keep_lines(raw[m.start() : m.start() + 1500])
        local = _currency_amount_candidates(seg, min_digits=6)
        if local:
            cands.extend(local)
            if not best_text:
                best_text = seg[:1200]

    if not cands:
        return {"text": "", "valeur": 0, "validite": ""}

    vm = _VALIDITE_RE.search(best_text)
    return {
        "text": best_text,
        "valeur": min(cands),
        "validite": clean_text(vm.group(1)) if vm else "",
    }


_CA_MIN_KEYWORD_RE = re.compile(
    r"(?:chiffre\s+d['’]affaires|CA\s+(?:minimum|minimal|annuel)|"
    r"capacit[eé]\s+financi[eè]re|surface\s+financi[eè]re).{0,250}",
    re.IGNORECASE | re.DOTALL,
)

_CREDIT_MIN_KEYWORD_RE = re.compile(
    r"(?:ligne\s+de\s+cr[eé]dit|cr[eé]dit\s+disponible|"
    r"attestation\s+de\s+(?:ligne\s+de\s+)?cr[eé]dit|"
    r"capacit[eé]\s+de\s+financement).{0,250}",
    re.IGNORECASE | re.DOTALL,
)

_CERT_PATTERNS = [
    r"\bISO\s*27001\b",
    r"\bISO\s*9001\b",
    r"\bISO\s*20000\b",
    r"\bITIL\b",
    r"\bPMP\b",
    r"\bPRINCE2\b",
    r"\bCOBIT\b",
    r"\bCISSP\b",
    r"\bCISA\b",
]

_AUTRES_RE = re.compile(
    r"\b(?:crit[eè]re[s]?\s+[eé]liminatoires?|sous\s+peine\s+de\s+rejet|"
    r"irrecevable|rejet\s+pur\s+et\s+simple)\b.{0,220}",
    re.IGNORECASE | re.DOTALL,
)


def extract_hard_filters_struct(text: str) -> dict:
    """
    Critères éliminatoires « go/no-go » du DAO : certifications, CA minimum
    (y compris 'surface financière'), ligne de crédit minimum. Les montants sont
    extraits avec contrainte de devise via clean_amount.
    """
    if not text:
        return {
            "certifications": [],
            "chiffre_affaires_min": [],
            "ligne_credit_min": [],
            "autres": [],
        }

    s = text

    certifications = []
    for pat in _CERT_PATTERNS:
        mm = re.search(pat, s, re.IGNORECASE)
        if mm:
            certifications.append(mm.group(0).upper().replace(" ", ""))
    certifications = sorted(set(certifications))

    ca_min = []
    for m in _CA_MIN_KEYWORD_RE.finditer(s):
        seg = m.group(0)
        val = clean_amount(seg, prefer_currency=True, pick="max")
        ca_min.append({"valeur": val, "snippet": clean_text(seg)[:220]})
        if len(ca_min) >= 10:
            break

    credit_min = []
    for m in _CREDIT_MIN_KEYWORD_RE.finditer(s):
        seg = m.group(0)
        val = clean_amount(seg, prefer_currency=True, pick="max")
        credit_min.append({"valeur": val, "snippet": clean_text(seg)[:220]})
        if len(credit_min) >= 10:
            break

    autres = []
    for m in _AUTRES_RE.finditer(s):
        autres.append({"snippet": clean_text(m.group(0))[:240]})
        if len(autres) >= 10:
            break

    return {
        "certifications": certifications,
        "chiffre_affaires_min": ca_min,
        "ligne_credit_min": credit_min,
        "autres": autres,
    }


@dataclass(frozen=True)
class _SectionSpec:
    name: str
    keywords: list[str]


class MarchesPublicsExtractor:
    """
    Extracteur "dataset ML" : features structurées + blocs sémantiques (NLP ready).

    Sortie parse():
      {
        "meta": {...},
        "administratif": {...},
        "technique": {...},
        "financier": {...}
      }
    """

    def __init__(self, pdf_path: str):
        self.pdf_path = pdf_path
        self.raw_text = ""
        self.full_text = ""  # version compressée (sans retours ligne) utile aux regex globales

        self.ocr_used = False
        self.ocr_error = ""
        self.page_count = 0
        self.ocr_page_limit = 8  # OCR complet = cher; à ajuster selon besoins

    # ------------------------------------------------------------------
    # Chargement du texte (pdfplumber d'abord, OCR en fallback / bruit)
    # ------------------------------------------------------------------

    def load_pdf(self):
        with pdfplumber.open(self.pdf_path) as pdf:
            self.page_count = len(pdf.pages)
            pages = []
            for page in pdf.pages:
                t = page.extract_text()
                if t:
                    pages.append(t)
            self.raw_text = "\n\n".join(pages)

        extracted = self.raw_text.strip()
        extracted_noise = _noise_ratio(extracted)
        if len(extracted) < 200 or extracted_noise > 0.10:
            self.ocr_used = True
            self.raw_text = self.perform_ocr()

        # "full_text" pour regex : on compacte mais on garde la substance
        self.full_text = clean_text(self.raw_text)

    def perform_ocr(self) -> str:
        try:
            last_page = self.page_count if self.page_count else self.ocr_page_limit
            last_page = min(last_page, self.ocr_page_limit)
            images = convert_from_path(
                self.pdf_path,
                dpi=250,
                first_page=1,
                last_page=last_page,
            )
            ocr_text = ""
            for img in images:
                text = pytesseract.image_to_string(img, lang="fra")
                ocr_text += text + "\n"
            return ocr_text
        except Exception as e:
            self.ocr_error = str(e)
            return ""

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _search(self, pattern: str, *, source: str | None = None, flags=re.IGNORECASE | re.DOTALL):
        return re.search(pattern, source if source is not None else self.full_text, flags)

    def _findall(self, pattern: str, *, source: str | None = None, flags=re.IGNORECASE | re.DOTALL, limit=100):
        return re.findall(pattern, source if source is not None else self.full_text, flags)[:limit]

    def _emails(self):
        return sorted(
            set(
                self._findall(
                    r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b",
                    flags=re.IGNORECASE,
                    limit=50,
                )
            )
        )

    def _phones(self):
        raw = self._findall(
            r"(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,3}\)?[\s.-]?)?\d{2,3}[\s.-]?\d{2,3}[\s.-]?\d{2,3}[\s.-]?\d{2,3}",
            flags=re.IGNORECASE,
            limit=80,
        )
        cleaned = []
        for r in raw:
            s = clean_text(r)
            digits = re.sub(r"\D", "", s)
            if 8 <= len(digits) <= 15:
                cleaned.append(s)
        return sorted(set(cleaned))[:20]

    # ------------------------------------------------------------------
    # Extraction par blocs sémantiques (NLP ready)
    # ------------------------------------------------------------------

    def extract_section_block(self, section_name: str, keywords: list[str], *, window_chars: int = 1000) -> dict:
        """
        Retourne un bloc textuel large (~1000 chars) à partir du 1er match d'un des keywords.
        Conçu pour feeding ultérieur (BERT/RoBERTa).
        """
        raw = self.raw_text or ""
        if not raw:
            return {"section": section_name, "found": False, "keyword": "", "text": ""}

        # Cherche sur le texte "raw" (avec retours ligne) pour préserver la structure
        for kw in keywords:
            m = re.search(re.escape(kw), raw, re.IGNORECASE)
            if not m:
                continue

            start = max(0, m.start())
            end = min(len(raw), start + window_chars)
            block = raw[start:end]
            return {
                "section": section_name,
                "found": True,
                "keyword": kw,
                "text": _clean_block_keep_lines(block),
            }

        return {"section": section_name, "found": False, "keyword": "", "text": ""}

    def _build_standard_sections(self) -> list[_SectionSpec]:
        # Inspiré des pièces ARMP (RPAO / TdR / CCTP / Grilles d’évaluation)
        return [
            _SectionSpec(
                "criteres_evaluation",
                [
                    "Critères d'évaluation",
                    "Critères d’evaluation",
                    "Evaluation des offres",
                    "Grille d'évaluation",
                    "Grilles d’évaluation",
                    "Notation",
                    "Barème",
                ],
            ),
            _SectionSpec(
                "criteres_qualification",
                [
                    "Critères de qualification",
                    "Critères de qualification des candidats",
                    "Qualification des candidats",
                ],
            ),
            _SectionSpec(
                "pieces_administratives",
                [
                    "Pièces administratives",
                    "Pieces administratives",
                    "Dossier administratif",
                ],
            ),
            _SectionSpec(
                "capacites_financieres",
                [
                    "Capacités financières",
                    "Capacite financiere",
                    "Capacité financière",
                    "Chiffre d'affaires",
                    "Chiffre d’affaires",
                    "ligne de crédit",
                    "ligne de credit",
                ],
            ),
            _SectionSpec(
                "personnel_cle",
                [
                    "Personnel clé",
                    "Personnel cle",
                    "Profil du Personnel",
                    "Profils du personnel",
                    "Experts clés",
                    "Experts cle",
                ],
            ),
            _SectionSpec(
                "exigences_techniques",
                [
                    "Descriptif",
                    "Descriptif de la fourniture",
                    "Spécifications techniques",
                    "Specifications techniques",
                    "Termes de référence",
                    "Termes de reference",
                    "CCTP",
                    "Cahier des Clauses Techniques",
                ],
            ),
            _SectionSpec(
                "penalites_garanties",
                [
                    "Pénalités",
                    "Penalites",
                    "Retenue de garantie",
                    "Cautionnement définitif",
                    "Avance de démarrage",
                ],
            ),
        ]

    # ------------------------------------------------------------------
    # Extraction structurée (admin / tech / financier)
    # ------------------------------------------------------------------

    def extract_reference(self) -> str:
        patterns = [
            r"N[°º$o]\s*[\d]{1,6}\s*(?:[./-]\s*)?[\w]+(?:[/\w.\-]+)+",
            r"\b\d{2,4}/AONO/[A-Z/]+/\d{4}\b",
            r"(?:AVIS D'APPEL D'OFFRES|DOSSIER D'APPEL D'OFFRES)[^\n]*N[°º$o\s][\d./\w\-]+",
        ]
        for pat in patterns:
            m = self._search(pat)
            if m:
                return clean_text(m.group(0))
        return "Inconnue"

    def extract_procedure_type(self) -> str:
        s = self.full_text or ""
        mapping = [
            (r"\bAONO\b|\bAAONO\b|\bAppel d['’]Offres National Ouvert\b", "AON (national ouvert)"),
            (r"\bAONR\b|\bAONR\b|\bAppel d['’]Offres National Restreint\b", "AON (national restreint)"),
            (r"\bAOIO\b|\bAOI\b|\bAppel d['’]Offres International Ouvert\b", "AOI (international ouvert)"),
            (r"\bAOIR\b|\bAppel d['’]Offres International Restreint\b", "AOI (international restreint)"),
            (r"\bAONOC\b|\bAOIOC\b|\bconcours\b", "AO avec concours"),
            (r"\bDC\b|\bDemande de Cotation\b", "DC (demande de cotation)"),
            (r"\bconsultation\b", "Consultation"),
            (r"proc[eé]dure\s+simplifi[eé]e|\bPSL\b", "PSL (procédure simplifiée)"),
        ]
        for pat, label in mapping:
            if re.search(pat, s, re.IGNORECASE):
                return label
        return "Non trouvé"

    def extract_maitre_ouvrage(self) -> str:
        # DAO réels: "MAITRE D’OUVRAGE : DG/ANTIC"
        m = self._search(r"MA[IÎ]TRE\s+D['’]OUVRAGE\s*[:\-–]\s*([^\n]{3,120})", source=self.raw_text)
        if m:
            return clean_text(m.group(1))

        m = self._search(r"Autorit[eé]\s+Contractante\s*[:\-–]\s*([^\n]{3,120})", source=self.raw_text)
        if m:
            return clean_text(m.group(1))

        m = self._search(r"([A-Z][A-Z0-9 &,'’\-]{3,80})\s*,\s*Autorit[eé]\s+Contractante")
        if m:
            return clean_text(m.group(1))

        return "Non trouvé"

    def extract_objet(self) -> str:
        # ARMP AAO: "1. Objet de l'Appel d'Offres"
        m = self._search(r"\bObjet\s+de\s+l['’]Appel\s+d['’]Offres\b.{0,600}", source=self.raw_text)
        if m:
            return clean_text(m.group(0)[:600])

        m = self._search(r"\bPour\s+\[?Objet\b.{0,260}", source=self.raw_text)
        if m:
            return clean_text(m.group(0)[:260])

        m = self._search(r"(?:Objet\s*[:\-–]|POUR\s+LE|POUR\s+L['’]).{0,350}")
        if m:
            return clean_text(m.group(0)[:350])
        return "Non trouvé"

    def extract_allotissement_count(self) -> int:
        m = self._search(r"\bAllotissement\b.{0,250}?\ben\s+(\d{1,2})\s+lots?\b", source=self.raw_text)
        if m:
            try:
                return int(m.group(1))
            except Exception:
                return 0
        m = self._search(r"\bsubdivis(?:ée|e)es?\s+en\s+(\d{1,2})\s+lots?\b", source=self.raw_text)
        if m:
            try:
                return int(m.group(1))
            except Exception:
                return 0
        return 0

    def extract_lot_blocks(self) -> list[dict]:
        """
        Détecte des blocs "Lot X" et retourne une liste de lots (NLP+features).
        Important: même en absence de budget/caution explicitement par lot, on garde le bloc.
        """
        raw = self.raw_text or ""
        if not raw:
            return []

        # Heuristique: repère tous les "Lot n°1" / "Lot 1" / "Lot No.1"
        lot_iter = list(
            re.finditer(
                r"\bLot\s*(?:n[°o]|N°|No\.?)?\s*(\d{1,2})\b",
                raw,
                flags=re.IGNORECASE,
            )
        )
        if not lot_iter:
            return []

        lots = []
        for idx, m in enumerate(lot_iter):
            lot_num = int(m.group(1))
            start = m.start()
            end = lot_iter[idx + 1].start() if idx + 1 < len(lot_iter) else min(len(raw), start + 5000)
            block = raw[start:end]

            # budget/caution "dans le lot" (contraints devise + mots-clés pour éviter faux positifs)
            budget_val = self._extract_budget_for_lot_block(block)
            caution_val = self._extract_caution_for_lot_block(block, budget_hint=budget_val)

            # délai "par lot le cas échéant" -> on tente dans le bloc
            delai_days = self._extract_delai_jours(block)

            lots.append(
                {
                    "lot_num": lot_num,
                    "lot_label": f"Lot {lot_num}",
                    "lot_text_block": _clean_block_keep_lines(block[:1200]),
                    "budget": budget_val,
                    "caution": caution_val,
                    "delai_jours": delai_days,
                }
            )
        # dédoublonnage Lot X répétés (table des matières, etc.) : garder les plus "riches"
        best_by_num: dict[int, dict] = {}
        for l in lots:
            n = l["lot_num"]
            cur = best_by_num.get(n)
            if cur is None:
                best_by_num[n] = l
                continue
            cur_score = len(cur.get("lot_text_block", "")) + (1 if cur.get("budget") else 0) * 500 + (1 if cur.get("caution") else 0) * 300
            new_score = len(l.get("lot_text_block", "")) + (1 if l.get("budget") else 0) * 500 + (1 if l.get("caution") else 0) * 300
            if new_score > cur_score:
                best_by_num[n] = l
        return [best_by_num[k] for k in sorted(best_by_num)]

    def _extract_budget_for_lot_block(self, lot_block: str) -> int:
        """
        Budget par lot, contraint à un contexte devise (FCFA/CFAF/XAF...) + indices "coût prévisionnel/enveloppe".
        Si aucun montant avec devise n'est trouvé, retourne 0 (plutôt qu'un faux positif).
        """
        if not lot_block:
            return 0

        # 1) Priorité aux segments typés "coût prévisionnel / enveloppe / estimated cost"
        m = re.search(
            r"(?:Co[uû]t\s+pr[eé]visionnel|Estimated\s+cost|enveloppe\s+(?:estimative|pr[eé]visionnelle)).{0,900}",
            lot_block,
            flags=re.IGNORECASE | re.DOTALL,
        )
        if m:
            cands = _currency_amount_candidates(m.group(0), min_digits=6)
            if cands:
                return max(cands)

        # 2) Fallback: dans un bloc de lot, accepter uniquement les montants accompagnés d'une devise
        cands = _currency_amount_candidates(lot_block, min_digits=6)
        return max(cands) if cands else 0

    def _extract_caution_for_lot_block(self, lot_block: str, *, budget_hint: int = 0) -> int:
        """
        Caution par lot, contrainte à mots-clés cautionnement + devise.
        Heuristique: si un budget est connu, privilégier un montant <= 10% du budget (souvent ~2%).
        """
        if not lot_block:
            return 0

        m = re.search(
            r"(?:cautionnement\s+provisoire|caution\s+de\s+soumission|garantie\s+provisoire).{0,1400}",
            lot_block,
            flags=re.IGNORECASE | re.DOTALL,
        )
        if not m:
            return 0

        seg = m.group(0)
        cands = _currency_amount_candidates(seg, min_digits=6)
        if not cands:
            return 0

        if budget_hint > 0:
            under = [v for v in cands if v <= int(0.10 * budget_hint)]
            if under:
                target = 0.02 * budget_hint
                return min(under, key=lambda v: abs(v - target))

        # Sans budget: la caution est généralement "petite" vs budget -> prendre le minimum avec devise
        return min(cands)

    def extract_caution_global(self) -> dict:
        # C1 — délègue à la fonction module-level testée (libellés multiples).
        return extract_caution_global_struct(self.raw_text or "")

    def extract_budget_global(self) -> dict:
        raw = self.raw_text or ""
        # ARMP: "Coût prévisionnel"
        m = self._search(r"\bCo[uû]t\s+pr[eé]visionnel\b.{0,1200}", source=raw)
        text = _clean_block_keep_lines(m.group(0)) if m else ""
        if not text:
            m = self._search(r"\benveloppe\s+(?:estimative|pr[eé]visionnelle)\b.{0,1200}", source=raw)
            text = _clean_block_keep_lines(m.group(0)) if m else ""
        cands = _currency_amount_candidates(text, min_digits=6) if text else []
        return {
            "text": text[:1200] if text else "",
            "valeur": max(cands) if cands else 0,
            "devise": "FCFA" if re.search(r"\b(?:FCFA|CFAF|F\s*CFA|XAF|francs?\s*CFA)\b", text, re.IGNORECASE) else "",
        }

    def extract_financement(self) -> str:
        raw = self.raw_text or ""
        m = self._search(r"\bFinancement\b\s*[:\-–]\s*([^\n]{3,250})", source=raw)
        if m:
            return clean_text(m.group(0))
        m = self._search(r"\bfinanc[eé]\s+par\b.{0,220}", source=raw)
        if m:
            return clean_text(m.group(0)[:220])
        return "Non trouvé"

    def _extract_delai_jours(self, text: str) -> int:
        if not text:
            return 0
        m = re.search(r"\b(\d{1,4})\s*jours?\b", text, flags=re.IGNORECASE)
        if m:
            try:
                return int(m.group(1))
            except Exception:
                return 0
        m = re.search(r"\b(\d{1,3})\s*mois?\b", text, flags=re.IGNORECASE)
        if m:
            try:
                return int(m.group(1)) * 30
            except Exception:
                return 0
        return 0

    def extract_delai(self) -> dict:
        raw = self.raw_text or ""
        m = self._search(r"\bD[eé]lais?\s+d['’](?:ex[eé]cution|exécution)\b.{0,800}", source=raw)
        if not m:
            m = self._search(r"\bD[eé]lai\s+maximum\b.{0,800}", source=raw)
        text = _clean_block_keep_lines(m.group(0)) if m else ""
        return {"text": text[:1000] if text else "", "jours": self._extract_delai_jours(text)}

    def extract_dates_cles(self) -> dict:
        raw = self.raw_text or ""

        # date limite / remise des offres
        m_lim = self._search(r"\b(?:remise|d[eé]p[oô]t)\s+des\s+offres\b.{0,1200}", source=raw)
        lim_block = _clean_block_keep_lines(m_lim.group(0)) if m_lim else ""
        lim_dates = _extract_all_dates_iso(lim_block) if lim_block else []

        # ouverture des plis/offres
        m_ouv = self._search(r"\bOuverture\s+des\s+(?:plis|offres)\b.{0,1200}", source=raw)
        ouv_block = _clean_block_keep_lines(m_ouv.group(0)) if m_ouv else ""
        ouv_dates = _extract_all_dates_iso(ouv_block) if ouv_block else []

        return {
            "remise_offres_block": lim_block[:1000] if lim_block else "",
            "remise_offres_dates_iso": lim_dates,
            "ouverture_plis_block": ouv_block[:1000] if ouv_block else "",
            "ouverture_plis_dates_iso": ouv_dates,
        }

    # ------------------------------------------------------------------
    # Features ML (hard filters / points / personnel / stack)
    # ------------------------------------------------------------------

    def extract_points_bareme(self, text: str) -> list[dict]:
        if not text:
            return []
        out = []
        for m in re.finditer(r"\b(\d{1,3})\s*(?:pts?|points?)\b", text, flags=re.IGNORECASE):
            pts = int(m.group(1))
            left = max(0, m.start() - 80)
            right = min(len(text), m.end() + 120)
            snippet = clean_text(text[left:right])
            out.append({"points": pts, "snippet": snippet})
            if len(out) >= 50:
                break
        return out

    def extract_hard_filters(self, text: str) -> dict:
        """Critères éliminatoires / exigences "go-no-go"."""
        # C1 — délègue à la fonction module-level testée ('surface financière' incluse).
        return extract_hard_filters_struct(text)

    def extract_personnel_cle(self, text: str) -> list[dict]:
        """
        Exigences de personnel structurées (poste, effectif, expérience,
        diplôme, certifications avec alternatives). Délègue à la fonction
        module-level testée unitairement.
        """
        return extract_personnel_cle_struct(text)

    def extract_tech_stack_keywords(self) -> list[str]:
        """
        Complexité technique: mots-clés de stack / infra / sécurité.
        """
        low = (self.full_text or "").lower()
        stack = [
            "java",
            "python",
            "php",
            "javascript",
            "typescript",
            "node",
            "react",
            "angular",
            "spring",
            "django",
            "flask",
            "dotnet",
            ".net",
            "postgres",
            "mysql",
            "oracle",
            "mongodb",
            "api",
            "microservices",
            "kubernetes",
            "docker",
            "cloud",
            "aws",
            "azure",
            "gcp",
            "datacenter",
            "réseau",
            "reseau",
            "firewall",
            "vpn",
            "iam",
            "sso",
            "oauth",
            "saml",
            "pentest",
            "siem",
            "soc",
            "backup",
            "pca",
            "pra",
            "cybersécurité",
            "cybersecurite",
        ]
        found = []
        for kw in stack:
            if kw.lower() in low:
                found.append(kw)
        return sorted(set(found))

    # ------------------------------------------------------------------
    # Parse principal : 3 piliers + multi-lots
    # ------------------------------------------------------------------

    def parse(self) -> dict:
        self.load_pdf()

        sections = {}
        for spec in self._build_standard_sections():
            sections[spec.name] = self.extract_section_block(spec.name, spec.keywords, window_chars=1100)

        # Blocs spécifiques ARMP (RPAO/TdR) pour enrichir dataset
        block_eval = sections.get("criteres_evaluation", {}).get("text", "")
        block_fin = sections.get("capacites_financieres", {}).get("text", "")
        block_staff = sections.get("personnel_cle", {}).get("text", "")
        block_tech = sections.get("exigences_techniques", {}).get("text", "")

        lots = self.extract_lot_blocks()
        allot_count = self.extract_allotissement_count()
        dates_cles = self.extract_dates_cles()

        caution_global = self.extract_caution_global()
        budget_global = self.extract_budget_global()

        administratif = {
            "reference": self.extract_reference(),
            "procedure_type": self.extract_procedure_type(),
            "maitre_ouvrage": self.extract_maitre_ouvrage(),
            "objet": self.extract_objet(),
            "financement": self.extract_financement(),
            "contacts": {"emails": self._emails(), "phones": self._phones()},
            "dates": dates_cles,
            "sections": {
                # blocs NLP
                "pieces_administratives": sections.get("pieces_administratives", {}),
                "penalites_garanties": sections.get("penalites_garanties", {}),
            },
        }

        technique = {
            "tech_stack_keywords": self.extract_tech_stack_keywords(),
            "sections": {
                "exigences_techniques": sections.get("exigences_techniques", {}),
                "criteres_evaluation": sections.get("criteres_evaluation", {}),
                "personnel_cle": sections.get("personnel_cle", {}),
            },
            "bareme_points": self.extract_points_bareme(block_eval),
            "hard_filters": self.extract_hard_filters(block_fin + "\n" + block_eval),
            "personnel_cle_struct": self.extract_personnel_cle(block_staff),
        }

        financier = {
            "allotissement_count": allot_count,
            "lots_detectes": len(lots),
            "lots": lots,  # 1 dict / lot (budget + caution + délai + bloc)
            "budget_global": budget_global,
            "caution_global": caution_global,
            "delai_global": self.extract_delai(),
        }

        meta = {
            "pages": self.page_count,
            "ocr_used": self.ocr_used,
            "ocr_error": self.ocr_error if self.ocr_used and self.ocr_error else "",
            "text_length_raw": len(self.raw_text or ""),
            "text_length": len(self.full_text or ""),
            "noise_ratio": round(_noise_ratio(self.raw_text or ""), 4),
            "sections_found": {k: bool(v.get("found")) for k, v in sections.items()},
        }

        return {"meta": meta, "administratif": administratif, "technique": technique, "financier": financier}
