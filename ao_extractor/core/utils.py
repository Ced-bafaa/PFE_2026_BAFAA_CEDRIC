import re


_CURRENCY_HINT_RE = re.compile(r"\b(?:F\s*CFA|FCFA|CFAF|XAF|francs?\s*CFA)\b", re.IGNORECASE)
_BUDGET_LINE_HINT_RE = re.compile(r"\b(?:ligne\s+budg[eé]taire|budget\s+line|imputation)\b", re.IGNORECASE)


def clean_amount(text, *, prefer_currency=False, pick="first"):
    """
    Extrait un montant numérique plausible d'un texte.

    - prefer_currency=True : privilégie les montants proches d'un indice de devise (FCFA/CFAF/XAF...).
    - pick="first" (défaut) : premier montant plausible ; pick="max" : plus grand montant plausible.
    """
    if not text or text == "Non trouvé":
        return 0

    s = str(text)

    # Trouve des nombres "longs" (au moins 6 chiffres une fois les espaces retirés).
    # Exemple : "150 000 000" ou "3 000 000"
    candidates = []
    for m in re.finditer(r"\b(\d[\d\s]{5,})\b", s):
        raw = m.group(1)
        digits = re.sub(r"\s", "", raw)
        if not digits.isdigit():
            continue
        val = int(digits)
        if val <= 0 or val > 100_000_000_000:
            continue

        # Contexte local pour repérer devise / ligne budgétaire
        left = max(0, m.start() - 40)
        right = min(len(s), m.end() + 40)
        ctx = s[left:right]

        has_currency = bool(_CURRENCY_HINT_RE.search(ctx))
        looks_like_budget_line = bool(_BUDGET_LINE_HINT_RE.search(ctx))

        candidates.append(
            {
                "val": val,
                "has_currency": has_currency,
                "looks_like_budget_line": looks_like_budget_line,
                "start": m.start(),
            }
        )

    if not candidates:
        return 0

    # Si on veut éviter les lignes budgétaires, on les dépriorise fortement.
    def score(c):
        sc = 0
        if c["has_currency"]:
            sc += 10
        if c["looks_like_budget_line"]:
            sc -= 8
        # Légère préférence aux montants "plus gros" (souvent plus informatifs) sans dominer la devise.
        sc += min(5, len(str(c["val"])) - 6)
        return sc

    ordered = sorted(candidates, key=lambda c: (-score(c), c["start"]))

    if prefer_currency:
        currency_first = [c for c in ordered if c["has_currency"] and not c["looks_like_budget_line"]]
        if currency_first:
            ordered = currency_first + [c for c in ordered if c not in currency_first]

    if pick == "max":
        return max(c["val"] for c in ordered)

    return ordered[0]["val"]


def clean_text(text):
    """Nettoie les sauts de ligne et espaces superflus."""
    if not text:
        return ""
    return " ".join(text.split())
