# syntax=docker/dockerfile:1

ARG NODE_VERSION=26.5.0
ARG PNPM_VERSION=11.17.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION
WORKDIR /app
RUN npm install --global "pnpm@${PNPM_VERSION}"

FROM base AS production-dependencies
RUN apt-get update \
  && apt-get install --yes --no-install-recommends build-essential python3 \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ai/package.json packages/ai/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/pipeline/package.json packages/pipeline/package.json
COPY packages/rules/package.json packages/rules/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
RUN pnpm install --prod --frozen-lockfile

FROM base AS builder
RUN apt-get update \
  && apt-get install --yes --no-install-recommends build-essential python3 \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ai/package.json packages/ai/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/pipeline/package.json packages/pipeline/package.json
COPY packages/rules/package.json packages/rules/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=production-dependencies /app ./
COPY --from=builder /app/packages/ai/dist packages/ai/dist
COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/packages/rules/dist packages/rules/dist
COPY --from=builder /app/packages/server/dist packages/server/dist
COPY --from=builder /app/packages/web/dist packages/web/dist
EXPOSE 8080
CMD ["node", "packages/server/dist/bin.js"]
