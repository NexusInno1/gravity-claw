FROM node:20-slim

# ─── Chromium system libraries required by Puppeteer ─────────────────────────
# node:20-slim ships without the host OS libraries that the Chromium binary
# bundled by Puppeteer depends on. Installing the minimal required set here
# so browse_page works in production on Railway / Docker environments.
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    libgconf-2-4 \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libxshmfence1 \
    libxcomposite1 \
    libxrandr2 \
    libxdamage1 \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use the system Chromium instead of downloading its own.
# Also enable no-sandbox mode — Railway containers use kernel namespace
# isolation (user namespaces + seccomp) as the equivalent security boundary.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_NO_SANDBOX=true

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for tsx)
RUN npm ci

# Copy source code and config files
COPY src/ ./src/
COPY tsconfig.json ./
COPY soul.md ./
COPY mcp.json ./
COPY skills/ ./skills/
# Create logs directory
RUN mkdir -p logs

# Run directly with tsx — Railway handles restarts via container restarts
CMD ["npx", "tsx", "src/index.ts"]

