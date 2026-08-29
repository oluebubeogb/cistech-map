FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Data will live on a Coolify volume
VOLUME ["/app/data"]

ENV NODE_ENV=production
ENV PORT=3847

EXPOSE 3847

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3847/health || exit 1

CMD ["node", "src/server.js"]