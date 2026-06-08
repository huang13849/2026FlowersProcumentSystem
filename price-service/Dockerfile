FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
COPY routes ./routes
COPY services ./services
COPY frontend/dist ./frontend/dist
EXPOSE 3009
CMD ["node", "server.js"]
