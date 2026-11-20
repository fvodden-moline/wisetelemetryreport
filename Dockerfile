# Production image (moline-platform templates/HOSTING.md). Settings come from environment variables
# only (.env.schema); .dockerignore keeps .env files, data and the xml folder out of the image.
# Volumes: /data (data.db, read-write) and the RADAN "Laser Report" share at /xml (read-only).

# Build stage has the compilers sqlite3 falls back to if its prebuilt binary is unavailable.
FROM node:22-bookworm AS build
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund --foreground-scripts

FROM node:22-bookworm-slim
# chromium: the WISE Telemetry portal login (Puppeteer). curl: the health check. tini: passes
# SIGTERM to node so a deploy stops it cleanly.
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-liberation curl tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/data.db \
    XML_MONITOR_DIRECTORY=/xml \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY package.json server.js ./
COPY includes ./includes
COPY views ./views
# runs as `node` (uid 1000, matches the share mount); /data must be writable by it
RUN mkdir -p /data /xml && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
