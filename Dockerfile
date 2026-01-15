FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Install dependencies for native modules
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# ========================================
# Production Stage
# ========================================
FROM node:20-alpine

LABEL org.opencontainers.image.title="WA Gateway Service" \
    org.opencontainers.image.description="Self-hosted WhatsApp Gateway using Baileys" \
    org.opencontainers.image.source="https://github.com/enggarasmoro/wa-gateway-service" \
    org.opencontainers.image.licenses="MIT"

WORKDIR /app

# Copy package files for production
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production && npm cache clean --force

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Create auth directory for session storage
RUN mkdir -p auth && chown -R node:node /app

# Use non-root user
USER node

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Start the server
CMD ["npm", "start"]
