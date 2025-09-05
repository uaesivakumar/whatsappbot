FROM node:20-alpine AS console_builder
WORKDIR /app/console
COPY console/package*.json ./
COPY console/postcss.config.js ./postcss.config.js
COPY console/tailwind.config.js ./tailwind.config.js
COPY console/vite.config.js ./vite.config.js
RUN npm ci
COPY console/ ./
RUN npm run build

FROM node:20-alpine AS server_builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . ./
COPY --from=console_builder /app/console/dist ./console/dist

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=server_builder /app ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node","server.js"]
