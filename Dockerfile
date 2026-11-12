# HT07 — Imagen única: compila el frontend (Vite) y lo sirve desde el backend (Express) en el mismo dominio.
# Construir:  docker build -t bodega-sneakers .
# Ejecutar:   docker run -p 8080:8080 --env-file backend/.env.production bodega-sneakers

# ---- 1. Build del frontend ----
FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- 2. Backend de producción ----
FROM node:20-alpine
# Cliente MySQL para los respaldos (mysqldump / mysql)
RUN apk add --no-cache mysql-client
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ ./
COPY --from=frontend /app/frontend/dist /app/frontend/dist

ENV NODE_ENV=production \
    PORT=8080 \
    FRONTEND_DIST=/app/frontend/dist \
    BACKUP_DIR=/data/backups
RUN mkdir -p /data/backups && chown -R node:node /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD wget -qO- http://localhost:${PORT}/api/salud || exit 1
CMD ["node", "server.js"]
