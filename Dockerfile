FROM node:26.13.1-alpine AS builder
WORKDIR /app
# Node 25+ images ship without corepack, so pnpm comes from npm. Pinned to the
# packageManager version, never @latest: an unpinned pnpm drifting ahead of the
# lockfile fails the install, and Coolify keeps serving the last good image, so
# the app reports healthy while the deploy silently never lands.
RUN npm install -g pnpm@10.32.1
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

FROM node:26.13.1-alpine AS runner
WORKDIR /app
RUN npm install -g pnpm@10.32.1
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=builder /app/dist ./dist
EXPOSE 3300
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3300/health || exit 1
CMD ["node", "dist/index.js"]
