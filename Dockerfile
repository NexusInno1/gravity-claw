FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for tsx)
RUN npm ci

# Copy source code and config files
COPY src/ ./src/
COPY tsconfig.json ./
COPY soul.md ./
COPY models.json ./

# Start the bot
CMD ["npx", "tsx", "src/index.ts"]
