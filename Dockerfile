# FairShift container for Google Cloud Run.
# Build stage: install all dependencies and build the client (Vite) and server (esbuild) bundles.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts ./
COPY src ./src
RUN npm run build:client && npm run build:server && npm prune --omit=dev

# Runtime stage: production dependencies and built output only, running as a non-root user.
FROM node:24-slim
ENV NODE_ENV=production \
    PORT=8080 \
    DATABASE_PATH=/data/fairshift.db
WORKDIR /app
RUN mkdir -p /data && chown -R node:node /data
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "dist/server/main.js"]
