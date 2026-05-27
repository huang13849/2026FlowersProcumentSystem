FROM node:20-alpine AS frontend-build
WORKDIR /app
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci && cd ..
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

FROM node:20-alpine
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --omit=dev && npm install minio@8.0.7 && npm cache clean --force
COPY backend/ .
COPY --from=frontend-build /app/frontend/dist ./frontend/dist
EXPOSE 3004
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD ["node", "-e", "var h=require('http');h.get({host:'localhost',port:3004,path:'/api/health',timeout:5000},function(r){process.exit(r.statusCode===200?0:1)}).on('error',function(){process.exit(1)})"]
CMD ["node", "server.js"]