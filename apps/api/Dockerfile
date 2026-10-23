# ShopSmart API: Express + TypeScript on Node 22.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 KNOWLEDGE_STORAGE_DIR=/data/knowledge
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY seed ./seed
RUN mkdir -p /data/knowledge && chown -R node:node /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD wget -qO- "http://127.0.0.1:${PORT:-8080}/api/health" > /dev/null || exit 1
CMD ["node", "dist/server.js"]
