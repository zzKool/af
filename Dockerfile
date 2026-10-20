# Stage 1: Install dependencies
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Stage 2: Build application
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `npm ci --ignore-scripts` skipped the postinstall: the pdf.js worker into public/ and the Prisma client
RUN node scripts/copy-pdf-worker.mjs
RUN npx prisma generate
RUN npm run build

# Stage 2b: Migrations — a one-shot image with the Prisma CLI and the migrations, nothing else (docs/deployment.md).
# Runs `prisma migrate deploy` as the migration role before the app starts; the app image never carries the CLI.
FROM node:22-alpine AS migrate
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json prisma.config.ts ./
COPY prisma ./prisma
# the schema engine is fetched on first use (`npm ci --ignore-scripts` skipped it) — fetch it now, with network
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma version > /dev/null
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
USER nextjs
CMD ["npx", "prisma", "migrate", "deploy"]

# Stage 3: Production runtime — the one image: Next.js + pg-boss worker + Chromium (constitution §1.9, §3.6)
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Chromium for kernel/pdf (invoices, statements, package summary). Fonts: DejaVu + Noto for sv/fr/de glyphs.
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-dejavu font-noto \
    && rm -rf /var/cache/apk/*
ENV CHROMIUM_PATH=/usr/bin/chromium-browser
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
# the build's version, shown by /api/health (set by the publish workflow: the git sha or the tag)
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
