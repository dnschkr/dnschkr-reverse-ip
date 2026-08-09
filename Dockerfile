FROM node:20-alpine AS builder
WORKDIR /app
# Pinned, not @latest: pnpm 11 requires Node >= 22.13, so on this node:20 base
# `corepack prepare pnpm@latest` installs a pnpm that refuses to run and every
# build fails on `pnpm install`. Coolify keeps serving the last good image, so
# the app reports healthy while the deploy silently never lands.
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

FROM node:20-alpine AS runner
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=builder /app/dist ./dist
EXPOSE 3300
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3300/health || exit 1
CMD ["node", "dist/index.js"]
