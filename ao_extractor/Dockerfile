# Extracteur DAO — API HTTP (FastAPI, port 8770)
FROM python:3.11-slim

# Dépendances système :
#  - tesseract-ocr (+ français) pour l'OCR
#  - poppler-utils pour pdf2image
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-fra \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dépendances Python : requirements + fastapi/uvicorn (requis par api_extractor.py,
# absents du requirements.txt d'origine prévu pour le watcher).
COPY requirements.txt .
# --retries/--timeout : résistance aux coupures/lenteurs réseau (évite les
# téléchargements tronqués → erreurs de hash).
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir --retries 10 --timeout 180 \
       -r requirements.txt fastapi "uvicorn[standard]"

COPY . .

ENV PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    TESSERACT_CMD=/usr/bin/tesseract

EXPOSE 8770

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8770/health').status==200 else 1)" || exit 1

CMD ["python", "-m", "uvicorn", "api_extractor:app", "--host", "0.0.0.0", "--port", "8770"]
