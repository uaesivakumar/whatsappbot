FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN sh -c 'if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi'
COPY . .
ENV NODE_ENV=production
EXPOSE 10000
CMD ["node","server.js"]
