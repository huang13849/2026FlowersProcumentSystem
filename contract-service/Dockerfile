FROM node:22-alpine
WORKDIR /app
COPY backend/package.json ./
RUN npm install
COPY backend/ ./
RUN mkdir -p /app/frontend-dist
COPY frontend/index.html /app/frontend-dist/index.html
RUN sed -i "s|\.\./frontend/index\.html|\./frontend-dist/index.html|g" /app/server.js
EXPOSE 3006
CMD ["node", "server.js"]
