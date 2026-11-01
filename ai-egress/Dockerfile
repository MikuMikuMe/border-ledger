FROM node:22-alpine AS dependencies
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=dependencies /build/node_modules/ipaddr.js ./node_modules/ipaddr.js
COPY ai-egress ./ai-egress
COPY package.json ./package.json
USER node
EXPOSE 8080
CMD ["node", "ai-egress/main.js"]
