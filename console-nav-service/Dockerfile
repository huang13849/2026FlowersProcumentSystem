FROM node:18-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server.js ./
COPY public ./public
EXPOSE 3020
CMD ["node","server.js"]
