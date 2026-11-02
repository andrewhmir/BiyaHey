# BiyaHey! BFF (services/api) — production-ish image, spec §7.
#
# Build context is the repository root (see docker-compose.yml) because the
# workspace `@biyahey/shared` sources are consumed as source in v1 (ruling R19).
# `tsx` is a runtime dependency (not a devDependency), so `npm ci --omit=dev`
# produces an image that can actually start the server (final-review item 2).
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Workspace manifests only first, so the dependency layer caches.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY services/api/package.json services/api/
RUN npm ci --omit=dev

# Source needed at runtime: the shared barrel/loader and the API TS sources.
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY services/api/tsconfig.json services/api/
COPY services/api/src services/api/src

EXPOSE 8787

# `npx --no-install` resolves the hoisted tsx binary; no network access.
CMD ["npx", "--no-install", "tsx", "services/api/src/server.ts"]
