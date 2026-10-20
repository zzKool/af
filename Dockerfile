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
RUN npx prisma generate
RUN npm run build

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
CMD ["node", "server.js"]
