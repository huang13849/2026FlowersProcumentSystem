FROM 100.76.15.64:5001/library/node:20-alpine-amd64
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
EXPOSE 3017
CMD ["node", "server.js"]
