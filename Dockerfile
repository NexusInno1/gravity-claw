FROM node:20-slim

WORKDIR /app

# Install PM2 globally
RUN npm install -g pm2

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for tsx)
RUN npm ci

# Copy source code and config files
COPY src/ ./src/
COPY tsconfig.json ./
COPY soul.md ./
COPY skills/ ./skills/
COPY mcp.json ./
COPY ecosystem.config.cjs ./

# Create logs directory
RUN mkdir -p logs

# Default: start with PM2 (use CMD ["npx","tsx","src/index.ts"] for direct mode)
CMD ["pm2-runtime", "ecosystem.config.cjs", "--only", "gravity-claw"]
