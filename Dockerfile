FROM node:20-alpine AS console
WORKDIR /build/console
COPY console/package*.json ./
RUN npm ci || npm install
COPY console .
RUN npm run build

FROM node:20-alpine AS server
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY server.js ./server.js
COPY src ./src
COPY intents.json ./ 2>/dev/null || true
COPY --from=console /build/console/dist ./console/dist
ENV NODE_ENV=production
EXPOSE 10000
CMD ["node","server.js"]
