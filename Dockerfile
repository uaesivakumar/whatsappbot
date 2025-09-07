FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
ENV HOST=0.0.0.0
EXPOSE 10000
CMD ["node","server.js"]
