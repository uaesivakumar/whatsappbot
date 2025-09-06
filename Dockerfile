FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY server.js ./server.js
COPY src ./src
COPY console/dist ./console/dist
ENV NODE_ENV=production
EXPOSE 10000
CMD ["node","server.js"]
