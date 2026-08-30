FROM 100.76.15.64:5001/library/node:20-alpine-amd64
WORKDIR /app

# Copy everything (product-service content)
COPY . .

# Install backend dependencies
RUN cd backend && npm ci --only=production && npm cache clean --force && cd ..

# Build frontend
RUN cd frontend && npm install && npm run build

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "require('http').get({host:'localhost',port:3000,path:'/api/health',timeout:5000},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "backend/server.js"]
