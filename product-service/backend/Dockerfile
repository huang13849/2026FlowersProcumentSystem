FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm install minio@8.0.7 && npm cache clean --force
COPY . .
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 CMD ["node", "-e", "require('http').get({host:'localhost',port:3000,path:'/api/health',timeout:5000},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
CMD ["node", "server.js"]
