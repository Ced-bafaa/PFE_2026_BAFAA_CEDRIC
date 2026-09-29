"""
debug.py — Lance ce script pour diagnostiquer pourquoi l'extraction échoue.
Usage : python debug.py
"""
import os
import sys
import pytesseract

# Chemin Tesseract Windows
pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")

# ── 1. Liste les PDFs trouvés ──────────────────────────────────────────────
print("=" * 60)
print("1) PDFs dans le dossier data/")
print("=" * 60)
pdfs = [f for f in os.listdir(DATA_DIR) if f.lower().endswith(".pdf")]
for f in pdfs:
    print(f"   • {f}")
if not pdfs:
    print("   ⚠️  Aucun PDF trouvé !")
    sys.exit(1)

pdf_path = os.path.join(DATA_DIR, pdfs[0])
print(f"\n→ Test sur : {pdf_path}\n")

# ── 2. pdfplumber ──────────────────────────────────────────────────────────
print("=" * 60)
print("2) Extraction texte via pdfplumber")
print("=" * 60)
try:
    import pdfplumber
    with pdfplumber.open(pdf_path) as pdf:
        texts = [p.extract_text() for p in pdf.pages if p.extract_text()]
        full = "\n".join(texts)
    print(f"   Nb pages avec texte : {len(texts)}")
    print(f"   Longueur texte extrait : {len(full)} caractères")
    if full.strip():
        print(f"   Aperçu : {full[:300]!r}")
    else:
        print("   ⚠️  Aucun texte extrait (PDF image/scanné)")
except Exception as e:
    print(f"   ❌ Erreur pdfplumber : {e}")
    full = ""

# ── 3. pdf2image ───────────────────────────────────────────────────────────
print("\n" + "=" * 60)
print("3) Conversion PDF → image via pdf2image")
print("=" * 60)
images = []
try:
    from pdf2image import convert_from_path
    images = convert_from_path(pdf_path, dpi=200, first_page=1, last_page=1)
    print(f"   ✅ {len(images)} image(s) générée(s)")
    print(f"   Taille image : {images[0].size}")
except Exception as e:
    print(f"   ❌ Erreur pdf2image : {e}")
    print()
    print("   → Vérifie que Poppler est installé et dans le PATH Windows.")
    print("   → Télécharge : https://github.com/oschwartz10612/poppler-windows/releases")
    print("   → Extrais dans C:\\poppler\\ et ajoute C:\\poppler\\Library\\bin au PATH.")

# ── 4. pytesseract ─────────────────────────────────────────────────────────
print("\n" + "=" * 60)
print("4) OCR via pytesseract")
print("=" * 60)
if images:
    try:
        version = pytesseract.get_tesseract_version()
        print(f"   ✅ Tesseract version : {version}")

        text = pytesseract.image_to_string(images[0], lang="fra")
        print(f"   Longueur texte OCR page 1 : {len(text)} caractères")
        if text.strip():
            print(f"   Aperçu OCR :\n{text[:400]}")
        else:
            print("   ⚠️  OCR a retourné un texte vide")
    except pytesseract.TesseractNotFoundError:
        print("   ❌ Tesseract introuvable !")
        print("   → Vérifie que le fichier existe :")
        print(f"      {pytesseract.pytesseract.tesseract_cmd}")
    except Exception as e:
        print(f"   ❌ Erreur pytesseract : {e}")
else:
    print("   ⏭️  Sauté (pdf2image a échoué)")

print("\n" + "=" * 60)
print("Diagnostic terminé.")
print("=" * 60)
