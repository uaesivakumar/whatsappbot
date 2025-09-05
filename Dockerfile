FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm --prefix console ci && npm --prefix console run build
ENV PORT=10000 NODE_ENV=production
EXPOSE 10000
CMD ["node","server.js"]
