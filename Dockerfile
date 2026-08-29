FROM node:20-alpine

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Install dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy application code
COPY --chown=nodejs:nodejs . .

# Data lives on the Coolify volume
VOLUME ["/app/data"]

USER nodejs

ENV NODE_ENV=production
ENV PORT=3847

EXPOSE 3847

# Healthcheck for Coolify
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3847/health || exit 1

CMD ["node", "src/server.js"]