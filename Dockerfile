# syntax=docker/dockerfile:1

# Build stage: install the full toolchain and bundle the editor frontend
# (vanilla JS + Yjs) into public/js/editor.bundle.js. The server
# itself needs no build step — Node 24 runs the TypeScript sources directly.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --silent
COPY frontend/ frontend/
COPY src/space-label.ts src/space-label.ts
COPY src/locale.ts src/locale.ts
COPY src/translations.ts src/translations.ts
RUN npm run build

# Runtime stage: production dependencies, the sources and the freshly built
# bundle — no dev tools, no build leftovers. The container runs as the image's
# non-root user (node, UID 1000); the data directory must be owned by that UID
# when a host directory is mounted (see README, "Data volume ownership").
FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --silent && npm cache clean --force
COPY --from=build /app/public/js/editor.bundle.js public/js/editor.bundle.js
COPY src/ src/
# Pre-create the data directory with the runtime user's ownership so an
# anonymous volume starts out writable without a root step.
RUN mkdir -p /app/data && chown node:node /app/data
ARG DROPNOTE_RELEASE_TAG=dev
ENV DROPNOTE_RELEASE_TAG=${DROPNOTE_RELEASE_TAG}
USER node
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "src/main.ts"]
