# Backend NestJS (port 3004).
# Base node:20-slim (déjà en cache via le front) + Chromium installé par Playwright.
# On évite l'image officielle Playwright (couche unique de 736 Mo, fragile sur
# connexion instable) au profit de téléchargements plus petits.
FROM node:20-slim

WORKDIR /app

# En Docker on désactive Playwright (pas de Chromium ~500 Mo) : le backend
# utilise le fallback Axios pour les PDFs (ARMP_PDF_PLAYWRIGHT_FIRST=false).
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Dépendances (package-lock présent → npm ci). fetch-retries : tolérance réseau.
COPY package*.json ./
RUN npm ci --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000

# Code + build NestJS (dist/)
COPY . .
RUN npm run build

ENV NODE_ENV=production \
    PORT=3004
EXPOSE 3004
CMD ["node", "dist/main"]
