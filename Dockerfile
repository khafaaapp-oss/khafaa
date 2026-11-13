# ── Stage 1: Dependencies ─────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

# ── Stage 2: Runtime ──────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy production node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source
COPY package*.json ./
COPY src ./src

# Create uploads directory (Koyeb's filesystem is ephemeral — see notes)
RUN mkdir -p uploads

# Expose the port Koyeb expects (Koyeb injects PORT env var)
EXPOSE 8000

# Healthcheck (optional; Koyeb uses its own)
# HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
#   CMD wget -qO- http://localhost:${PORT}/health || exit 1

CMD ["node", "src/index.js"]
