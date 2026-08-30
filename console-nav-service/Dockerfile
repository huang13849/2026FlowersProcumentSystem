FROM 100.76.15.64:5001/library/node:18-alpine-amd64
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server.js ./
COPY public ./public
EXPOSE 3020
CMD ["node","server.js"]
