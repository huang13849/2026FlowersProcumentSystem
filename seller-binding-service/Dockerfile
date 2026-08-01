FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY schema.sql server.js nacosResolver.js ./
EXPOSE 3013
CMD ["node", "server.js"]
