# Frontend KIAMA — build Vite puis service statique nginx.

# ── Étape 1 : build ────────────────────────────────────────────────────────────
FROM node:20-slim AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000

COPY . .

# URL du backend, FIGÉE au build (le navigateur appelle le backend directement).
# Défaut : localhost:3004 (accès depuis la même machine). Pour un serveur, builder
# avec : --build-arg VITE_API_URL=http://IP_DU_SERVEUR:3004
ARG VITE_API_URL=http://localhost:3004
ARG VITE_API_KEY=
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_API_KEY=$VITE_API_KEY
RUN npm run build

# ── Étape 2 : service statique ─────────────────────────────────────────────────
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
