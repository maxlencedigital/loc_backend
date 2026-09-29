# ---- Build ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Production ----
FROM node:24-alpine AS production
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# The generated Prisma client. `npm ci --omit=dev` above installs
# @prisma/client but NOT the code generated into it — the prisma CLI is a
# devDependency and its postinstall hook is blocked, so without this copy
# every query fails at runtime with "did you forget to run prisma generate".
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=build /app/dist ./dist
USER node
EXPOSE 5001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5001/health || exit 1
CMD ["node", "dist/Commerce.Server.js"]
