# ── Token Guard Agent — Cloud Run Dockerfile ──────────────────────────────────
FROM node:20-alpine AS base

WORKDIR /app

# Install dependencies first (layer-cached)
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY agent.js   .
COPY index.html .

# Cloud Run injects PORT; default to 3000
EXPOSE 3000
ENV NODE_ENV=production

# Health check (Cloud Run expects a responsive HTTP server)
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-3000}/ || exit 1

CMD ["node", "agent.js"]
