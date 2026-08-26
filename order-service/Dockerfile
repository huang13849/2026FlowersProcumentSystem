FROM 100.76.15.64:5001/library/node:20-alpine-amd64
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3008
CMD ["node", "server.js"]
