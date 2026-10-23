# Single-service image (Render): the Express API also serves the built React app.
# docker-compose (infra/) still uses the separate apps/api and apps/frontend images.

FROM node:22-alpine AS web
WORKDIR /web
COPY apps/frontend/package.json apps/frontend/package-lock.json ./
RUN npm ci
COPY apps/frontend ./
RUN npm run build

FROM node:22-alpine AS api
WORKDIR /api
COPY apps/api/package.json apps/api/package-lock.json ./
RUN npm ci
COPY apps/api/tsconfig.json ./
COPY apps/api/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 KNOWLEDGE_STORAGE_DIR=/data/knowledge WEB_DIST_DIR=/app/public
COPY --from=api /api/node_modules ./node_modules
COPY --from=api /api/dist ./dist
COPY apps/api/package.json ./
COPY apps/api/seed ./seed
COPY --from=web /web/dist ./public
RUN mkdir -p /data/knowledge && chown -R node:node /data
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
