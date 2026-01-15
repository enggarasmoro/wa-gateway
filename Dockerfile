# =============================================
# Stage 1: Build
# =============================================
FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# =============================================
# Stage 2: Production
# =============================================
FROM node:20-bullseye-slim

# Install dependencies for Puppeteer/Chrome
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libxss1 \
    libxtst6 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Set Puppeteer cache directory BEFORE installation
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

# Create directories with proper permissions
RUN mkdir -p /app/.cache/puppeteer /app/auth \
    && chmod -R 777 /app/.cache /app/auth

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Install Chrome explicitly with correct cache path
RUN npx puppeteer browsers install chrome

# Verify Chrome was installed
RUN ls -la /app/.cache/puppeteer/

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist

# Copy public static files
COPY public/ ./public/

# Create non-root user and set permissions
RUN groupadd -r pptruser && useradd -r -g pptruser -G audio,video pptruser \
    && mkdir -p /home/pptruser \
    && chown -R pptruser:pptruser /home/pptruser \
    && chown -R pptruser:pptruser /app

USER pptruser

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

CMD ["node", "dist/index.js"]
