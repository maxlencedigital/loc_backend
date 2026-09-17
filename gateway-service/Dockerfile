# Build context for this Dockerfile is the REPO ROOT, not gateway-service/
# (see docker-compose.yml and .github/workflows/ci.yml) — the aggregated
# Swagger spec is generated here, once, while every sibling service's
# source is actually available on disk. The other 4 services build from
# their own directory and don't need this.

# ---- Build ----
FROM node:24-alpine AS build
WORKDIR /repo/gateway-service
COPY gateway-service/package.json gateway-service/package-lock.json ./
RUN npm ci
WORKDIR /repo
COPY . .
WORKDIR /repo/gateway-service
RUN npm run build
RUN npm run generate:openapi

# ---- Production ----
FROM node:24-alpine AS production
ENV NODE_ENV=production
WORKDIR /app
COPY gateway-service/package.json gateway-service/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /repo/gateway-service/dist ./dist
COPY --from=build /repo/gateway-service/openapi.generated.json ./openapi.generated.json
USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5000/health || exit 1
CMD ["node", "dist/Gateway.Server.js"]
