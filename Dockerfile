# ── Gravity Claw — Production Dockerfile ──────────────────
FROM node:20-slim

# Playwright system dependencies for Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libdbus-1-3 libxkbcommon0 libatspi2.0-0 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2 libx11-xcb1 fonts-liberation \
    ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install
COPY package*.json ./
RUN npm ci --include=dev

# Install Playwright Chromium
RUN npx playwright install chromium

# Copy source code + static assets
COPY src/ ./src/
COPY tsconfig.json ./
COPY soul.md ./
COPY skills/ ./skills/

# Create data directory for persistence
RUN mkdir -p data

# No PORT needed — bot uses long-polling
ENV NODE_ENV=production

CMD ["npx", "tsx", "src/index.ts"]
