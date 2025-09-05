FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS console_deps
WORKDIR /app/console
COPY console/package*.json ./
RUN npm ci

FROM node:20-alpine AS console_build
WORKDIR /app
COPY --from=console_deps /app/console/node_modules ./console/node_modules
COPY console ./console
RUN npm --prefix console run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
COPY --from=console_build /app/console/dist ./console/dist
RUN rm -rf console/node_modules console/src console/public
EXPOSE 10000
CMD ["npm","start"]
