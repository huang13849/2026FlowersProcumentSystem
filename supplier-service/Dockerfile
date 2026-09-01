# The Jenkins build agent is amd64.  Use the mirrored amd64 image so Docker
# never resolves a cached arm64 manifest when the image is built for k3s.
FROM 100.76.15.64:5001/library/node:20-alpine-amd64 AS frontend-build
WORKDIR /app
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci && cd ..
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

FROM 100.76.15.64:5001/library/node:20-alpine-amd64
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm install minio@8.0.7 && npm cache clean --force
COPY . .
COPY --from=frontend-build /app/frontend/dist ./frontend/dist
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 CMD ["node", "-e", "var h=require('http');h.get({host:'localhost',port:3002,path:'/api/health',timeout:5000},function(r){process.exit(r.statusCode===200?0:1)}).on('error',function(){process.exit(1)})"]
CMD ["node", "server.js"]
